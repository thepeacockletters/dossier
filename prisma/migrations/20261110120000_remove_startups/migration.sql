-- Startups is removed: its tables, and the settings it kept.

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Startup";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "StartupBlock";
PRAGMA foreign_keys=on;

DELETE FROM "Setting" WHERE "key" IN ('startupsViewedAt', 'startupsLastRefresh');
