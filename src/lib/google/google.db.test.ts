import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

// Send with Gmail (E15-2) against a test database, with Google's APIs
// answered by a fake fetch.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({
  env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_GOOGLE_CLIENT_ID: "client", DOSSIER_GOOGLE_CLIENT_SECRET: "secret", DOSSIER_DATA_DIR: "/tmp" },
}));
vi.mock("@/lib/pdf/render", () => ({ renderPdf: async () => new Uint8Array([37, 80, 68, 70]) }));
vi.mock("@/lib/time-zone", () => ({ userTimeZone: async () => "Europe/Berlin", lastKnownTimeZone: async () => "Europe/Berlin" }));

import { encryptSecret, GOOGLE_TOKEN } from "@/lib/secrets";

import { googleConnection, saveGoogleAccount } from "./account";
import { sendApplicationEmail } from "./send";

const prisma = () => db.client!;

let sent: { raw: string }[] = [];

function fakeGoogle(url: string, init?: RequestInit): Response {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "access", expires_in: 3600, scope: "" });
  if (new URL(url).pathname.endsWith("/messages/send")) {
    sent.push(JSON.parse(String(init?.body)) as { raw: string });
    return json({ id: `sent-${sent.length}`, threadId: "thread-new" });
  }
  return new Response("not found", { status: 404 });
}

/** Earlier tests leave an hour-long access token in memory; without it, the refresh token is asked for. */
const forgetAccessTokens = () => (globalThis as { googleTokens?: Map<string, unknown> }).googleTokens?.clear();

const scopes = "openid email https://www.googleapis.com/auth/gmail.send";

beforeEach(async () => {
  await resetDatabase(prisma());
  sent = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => fakeGoogle(String(url), init)));
  await prisma().googleAccount.create({ data: { email: "jane@gmail.com", refreshTokenEnc: encryptSecret(GOOGLE_TOKEN, "refresh", "s".repeat(40)), scopes } });
  await prisma().profileField.create({ data: { key: "name", value: "Jane Doe" } });
  await prisma().application.create({
    data: {
      id: "nw",
      company: "Northwind Logistics",
      role: "Product Designer",
      status: "DRAFT",
      postingText: "Apply to careers@northwind.example.",
      documents: {
        create: [
          { kind: "EMAIL", units: [{ id: "to", label: "Recipient", text: "careers@northwind.example" }, { id: "subject", label: "Subject", text: "Application: Product Designer" }, { id: "body", label: "Message", text: "Dear team,\n\nI'm applying.\n\nJane" }] },
          { kind: "RESUME", units: [] },
        ],
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => prisma().$disconnect());

describe("Send with Gmail (E15-2)", () => {
  it("sends with the PDFs, notes that it went out and moves the draft to Sent", async () => {
    const result = await sendApplicationEmail("nw");
    expect(result.eventId).not.toBeNull();
    expect(result.attachments).toHaveLength(1);
    const raw = Buffer.from(sent[0].raw, "base64url").toString("utf8");
    expect(raw).toContain("From: Jane Doe <jane@gmail.com>");
    expect(raw).toContain("To: careers@northwind.example");
    expect(raw).toContain("application/pdf");
    const application = await prisma().application.findUniqueOrThrow({ where: { id: "nw" } });
    expect(application).toMatchObject({ status: "SENT", emailThreadId: "thread-new" });
  });
});

describe("saved access Google refuses (#136)", () => {
  it("stops asking Google once it refuses the saved access, until the account is connected again", async () => {
    forgetAccessTokens();
    let tokenCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (!String(url).startsWith("https://oauth2.googleapis.com/token")) return fakeGoogle(String(url), init);
        tokenCalls += 1;
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }),
    );
    await expect(sendApplicationEmail("nw")).rejects.toThrow("Google no longer accepts Dossier's access.");
    expect(await googleConnection()).toMatchObject({ status: "connected", signInProblem: expect.stringContaining("Connect your Google account again") });
    await expect(sendApplicationEmail("nw")).rejects.toThrow("Google no longer accepts Dossier's access.");
    expect(tokenCalls).toBe(1);
    expect(sent).toHaveLength(0);

    await saveGoogleAccount({ email: "jane@gmail.com", refreshToken: "new-refresh", scopes });
    expect(await googleConnection()).toMatchObject({ signInProblem: null });
  });

  it("pauses, but keeps, saved access it can't read, since the old DOSSIER_SECRET reads it again", async () => {
    forgetAccessTokens();
    const other = encryptSecret(GOOGLE_TOKEN, "refresh", "o".repeat(40));
    await prisma().googleAccount.update({ where: { id: "google" }, data: { refreshTokenEnc: other } });
    expect(await googleConnection()).toMatchObject({ signInProblem: expect.stringContaining("DOSSIER_SECRET changed") });
    await expect(sendApplicationEmail("nw")).rejects.toThrow("can't be read");
    expect(await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } })).toMatchObject({ refreshTokenEnc: other });
  });
});
