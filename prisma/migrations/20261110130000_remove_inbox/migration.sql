-- The inbox is removed: the mail read from Gmail, the inbox check's state on the
-- Google account, the settings for reading mail and offering free times, and
-- reply drafts still waiting as jobs.

-- DropIndex
DROP INDEX "EmailMessage_sentAt_idx";

-- DropIndex
DROP INDEX "EmailMessage_applicationId_sentAt_idx";

-- DropIndex
DROP INDEX "EmailMessage_threadId_idx";

-- DropIndex
DROP INDEX "EmailMessage_gmailId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "EmailMessage";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GoogleAccount" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'google',
    "email" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GoogleAccount" ("createdAt", "email", "id", "refreshTokenEnc", "scopes", "updatedAt") SELECT "createdAt", "email", "id", "refreshTokenEnc", "scopes", "updatedAt" FROM "GoogleAccount";
DROP TABLE "GoogleAccount";
ALTER TABLE "new_GoogleAccount" RENAME TO "GoogleAccount";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


DELETE FROM "Setting" WHERE "key" IN ('gmailRead', 'gmailScope', 'gmailInterval', 'calendarAvailability', 'workDays', 'workStart', 'workEnd', 'bufferMinutes');
DELETE FROM "Job" WHERE "type" = 'draft-reply';
