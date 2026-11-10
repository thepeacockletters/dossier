-- Gmail and Google Calendar are removed: the Google account, the Gmail thread
-- and calendar event kept on applications, and the Google settings. A setup
-- guide left at its Google step goes on at the profile.

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "GoogleAccount";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "agentScore" INTEGER,
    "resumeFit" JSONB,
    "awaitingReview" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT '',
    "salary" TEXT NOT NULL DEFAULT '',
    "deadline" DATETIME,
    "postingUrl" TEXT NOT NULL DEFAULT '',
    "postingText" TEXT NOT NULL DEFAULT '',
    "extracted" JSONB,
    "extractedWith" TEXT,
    "match" JSONB,
    "matchedWith" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "boardSort" INTEGER,
    "furthestStage" TEXT,
    "sentAt" DATETIME,
    "nextInterviewAt" DATETIME,
    "tone" TEXT NOT NULL DEFAULT 'WARM',
    "language" TEXT NOT NULL DEFAULT '',
    "followThemeLayout" BOOLEAN NOT NULL DEFAULT false,
    "showPhoto" BOOLEAN,
    "sections" JSONB,
    "frozen" JSONB,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Application" ("agentScore", "archivedAt", "awaitingReview", "boardSort", "company", "createdAt", "deadline", "extracted", "extractedWith", "followThemeLayout", "frozen", "furthestStage", "id", "language", "location", "match", "matchedWith", "mode", "nextInterviewAt", "origin", "postingText", "postingUrl", "resumeFit", "role", "salary", "sections", "sentAt", "showPhoto", "status", "title", "tone", "updatedAt") SELECT "agentScore", "archivedAt", "awaitingReview", "boardSort", "company", "createdAt", "deadline", "extracted", "extractedWith", "followThemeLayout", "frozen", "furthestStage", "id", "language", "location", "match", "matchedWith", "mode", "nextInterviewAt", "origin", "postingText", "postingUrl", "resumeFit", "role", "salary", "sections", "sentAt", "showPhoto", "status", "title", "tone", "updatedAt" FROM "Application";
DROP TABLE "Application";
ALTER TABLE "new_Application" RENAME TO "Application";
CREATE INDEX "Application_status_idx" ON "Application"("status");
CREATE INDEX "Application_updatedAt_idx" ON "Application"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


DELETE FROM "Setting" WHERE "key" IN ('googleClientId', 'googleClientSecretEnc', 'calendarEvents', 'calendarId', 'workTimeZone', 'slotMinutes');
UPDATE "Setting" SET "value" = replace("value", '"step":"google"', '"step":"profile"') WHERE "key" = 'setupGuide';
