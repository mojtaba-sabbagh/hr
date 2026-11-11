BEGIN;
ALTER TABLE "EmployeeAsset" ALTER COLUMN "employeeId" DROP NOT NULL;
CREATE TABLE "SmartReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "scope" TEXT NOT NULL,
    "periodId" TEXT,
    "findingKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "useful" BOOLEAN NOT NULL,
    "actorId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "SmartReview_companyId_findingKey_fingerprint_key" ON "SmartReview"("companyId","findingKey","fingerprint");
CREATE INDEX "SmartReview_companyId_scope_periodId_idx" ON "SmartReview"("companyId","scope","periodId");
COMMIT;
