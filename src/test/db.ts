import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/database";

/**
 * The database for `*.db.test.ts` files: TEST_DATABASE_URL, or the file in
 * DATABASE_URL with "_test" added to its name, before its extension. Refuses
 * any file whose name doesn't end in "_test", so tests can never wipe
 * development data.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base) {
    throw new Error("Database tests need DATABASE_URL or TEST_DATABASE_URL.");
  }
  const url = explicit ?? base!.replace(/(\.\w+)?$/, "_test$1");
  if (!/_test(\.\w+)?$/.test(url)) throw new Error(`Refusing to run database tests against "${url}": its name must end in "_test".`);
  return url;
}

export function createTestClient(): PrismaClient {
  return createPrismaClient(testDatabaseUrl());
}

/** Empties every table, so each test starts from a blank database. */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  const tables = await db.$queryRaw<{ name: string }[]>`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'`;
  // No TRUNCATE … CASCADE: the order doesn't matter with the checks off.
  await db.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  // Built-in themes can't be deleted (see the init migration's trigger).
  await db.$executeRawUnsafe(`UPDATE "Theme" SET "builtIn" = false`);
  for (const { name } of tables) await db.$executeRawUnsafe(`DELETE FROM "${name}"`);
  await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");
}
