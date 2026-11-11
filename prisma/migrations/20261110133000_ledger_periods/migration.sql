CREATE TABLE "LedgerPeriod" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "yearId" TEXT NOT NULL REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "label" TEXT NOT NULL,
  "start" DATE NOT NULL,
  "end" DATE NOT NULL,
  "closed" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "LedgerPeriod_dates" CHECK ("start" <= "end")
);
CREATE UNIQUE INDEX "LedgerPeriod_yearId_start_key" ON "LedgerPeriod"("yearId","start");
ALTER TABLE "WorkFix" ADD COLUMN "unpaidLeave" INTEGER NOT NULL DEFAULT 0;
