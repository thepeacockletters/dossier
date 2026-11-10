import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("the migrations", () => {
  it("make exactly prisma/schema.prisma (make a migration after changing the schema, see DEVELOPMENT.md)", () => {
    // `migrate diff --exit-code` exits with 2, and lists the difference, when there is one.
    const diff = spawnSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema", "prisma/schema.prisma", "--exit-code"],
      { encoding: "utf8" },
    );
    expect(diff.status, diff.stdout + diff.stderr).toBe(0);
  }, 30_000);
});
