import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { updateDocuments } from "./document-units";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const prisma = () => db.client!;
const where = { applicationId_kind: { applicationId: "app-1", kind: "RESUME" as const } };

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({
    data: {
      id: "app-1",
      documents: {
        create: [
          { kind: "RESUME", units: [{ id: "summary", label: "Summary", text: "One" }] },
          { kind: "COVER_LETTER", units: [{ id: "paragraph:1", label: "Opening", text: "Dear" }] },
        ],
      },
    },
  });
});
afterAll(() => prisma().$disconnect());

describe("updateDocuments", () => {
  it("saves the documents whose units changed", async () => {
    const letterBefore = await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "COVER_LETTER" } } });
    const result = await updateDocuments("app-1", async (documents) => {
      documents.RESUME![0].text = "Two";
      return "done";
    });
    expect(result).toBe("done");
    expect((await prisma().document.findUniqueOrThrow({ where })).units).toEqual([{ id: "summary", label: "Summary", text: "Two" }]);
    // The letter wasn't touched.
    const letterAfter = await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "COVER_LETTER" } } });
    expect(letterAfter.updatedAt).toEqual(letterBefore.updatedAt);
  });

  it("writes nothing when the change fails", async () => {
    await expect(
      updateDocuments("app-1", async (documents) => {
        documents.RESUME![0].text = "Two";
        throw new Error("No");
      }),
    ).rejects.toThrow("No");
    expect((await prisma().document.findUniqueOrThrow({ where })).units).toEqual([{ id: "summary", label: "Summary", text: "One" }]);
  });
});
