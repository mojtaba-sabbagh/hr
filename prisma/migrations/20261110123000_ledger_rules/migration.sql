CREATE TABLE "LedgerRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "source" TEXT NOT NULL, "event" TEXT NOT NULL, "debitCode" TEXT NOT NULL, "creditCode" TEXT NOT NULL
);
CREATE UNIQUE INDEX "LedgerRule_companyId_source_event_key" ON "LedgerRule" ("companyId","source","event");
