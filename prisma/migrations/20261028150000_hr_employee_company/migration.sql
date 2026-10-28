-- Link personnel files to the tenant that owns them.
-- The column is nullable so an upgrade never fails on existing rows; run
-- `npm run backfill:hr-company` once to fill it from the user's membership.
-- The person's seat stays in PositionAssignment: no position column is copied.

-- AlterTable
ALTER TABLE "HrEmployee" ADD COLUMN "companyId" TEXT;

-- CreateIndex
CREATE INDEX "HrEmployee_companyId_active_idx" ON "HrEmployee"("companyId", "active");

-- AddForeignKey
ALTER TABLE "HrEmployee" ADD CONSTRAINT "HrEmployee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
