import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

// The Google actions (E15) against the test database, signed in, with
// Google's APIs answered by a fake fetch.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/env", () => ({
  env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_GOOGLE_CLIENT_ID: "client", DOSSIER_GOOGLE_CLIENT_SECRET: "secret", DOSSIER_DATA_DIR: "/tmp" },
}));

import { encryptSecret, GOOGLE_TOKEN } from "@/lib/secrets";

import { googleConnection } from "./account";
import { disconnectGoogleAccount, saveGoogleClient, saveGoogleSettings } from "./actions";

const prisma = () => db.client!;
const scopes = "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events";
let calls: { url: string; body: unknown }[] = [];

beforeEach(async () => {
  await resetDatabase(prisma());
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, body: init?.body ? (String(init.body).startsWith("{") ? JSON.parse(String(init.body)) : String(init.body)) : undefined });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (href.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "access", expires_in: 3600 });
      if (href.startsWith("https://oauth2.googleapis.com/revoke")) return json({});
      return new Response("", { status: 404 });
    }),
  );
  await prisma().googleAccount.create({ data: { email: "jane@gmail.com", refreshTokenEnc: encryptSecret(GOOGLE_TOKEN, "refresh", "s".repeat(40)), scopes } });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => prisma().$disconnect());

describe("Settings → Google (E15-1)", () => {
  it("saves the settings, refusing a made-up zone", async () => {
    expect(await saveGoogleSettings({ workTimeZone: "America/New_York", slotMinutes: 60, calendarEvents: false })).toMatchObject({ ok: true });
    const rows = Object.fromEntries((await prisma().setting.findMany()).map((row) => [row.key, row.value]));
    expect(rows).toMatchObject({ workTimeZone: "America/New_York", slotMinutes: "60", calendarEvents: "false" });
    expect(await saveGoogleSettings({ workTimeZone: "Mars/Olympus" })).toMatchObject({ ok: false });
  });

  it("saves the OAuth client, the secret encrypted and never sent back", async () => {
    expect(await saveGoogleClient({ id: "client", secret: { action: "set", value: "new-secret" } })).toEqual({
      ok: true,
      data: { id: "client", idState: "set", secretState: "set" },
    });
    const stored = await prisma().setting.findUnique({ where: { key: "googleClientSecretEnc" } });
    expect(stored?.value).toMatch(/^v1\./);
    expect(stored?.value).not.toContain("new-secret");
    // Same client ID, new secret: the account stays connected.
    expect(await googleConnection()).toMatchObject({ status: "connected" });

    expect(await saveGoogleClient({ secret: { action: "clear" } })).toMatchObject({ ok: true, data: { secretState: "env" } });
    expect(await prisma().setting.count({ where: { key: "googleClientSecretEnc" } })).toBe(0);
  });

  it("disconnects when the client ID changes, since Google's grant belongs to it", async () => {
    expect(await saveGoogleClient({ id: "other-client" })).toMatchObject({ ok: true, data: { id: "other-client", idState: "set" } });
    expect(calls.find((call) => call.url.includes("/revoke"))).toBeDefined();
    expect(await googleConnection()).toEqual({ status: "disconnected" });
  });

  it("disconnects, revoking the token at Google", async () => {
    expect(await googleConnection()).toMatchObject({ status: "connected", email: "jane@gmail.com", canSend: true, canUseCalendar: true });
    expect(await disconnectGoogleAccount({})).toMatchObject({ ok: true, toast: "Disconnected from Google." });
    expect(calls.find((call) => call.url.includes("/revoke"))?.body).toBe("token=refresh");
    expect(await googleConnection()).toEqual({ status: "disconnected" });
  });
});
