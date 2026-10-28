-- کارگزینی: contracts, decrees, the ten mandatory documents, and the contractor
-- companies whose crew works on site.
--
-- These are the first HR tables besides `HrEmployee` that carry `companyId` as a
-- required column: a contract without a tenant could never be read by anyone, so
-- the service derives it from the personnel file and refuses when there is none.
--
-- `HrEmployee` gains the profile facts the pessimistic audit reads (national ID,
-- birth date, military and veteran status, employment state). All of them are
-- NOT NULL with a neutral default, so an upgrade never fails on existing rows.
-- `HrEmployee.contractType` is *not* touched: it describes the arrangement
-- (full-time / part-time), which is a different axis from the contract kind.

-- CreateTable
CREATE TABLE "HrContractorCompany" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL DEFAULT '',
    "startDate" DATE,
    "endDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrContractorCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrContract" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "baseSalary" INTEGER NOT NULL DEFAULT 0,
    "renewals" INTEGER NOT NULL DEFAULT 0,
    "contractorCompanyId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDecree" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "contractId" TEXT,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" DATE NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "signer" TEXT NOT NULL DEFAULT '',
    "cosigner" TEXT NOT NULL DEFAULT '',
    "baseSalary" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrDecree_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'MISSING',
    "reference" TEXT NOT NULL DEFAULT '',
    "verifiedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrDocument_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "HrEmployee" ADD COLUMN "nationalId" TEXT NOT NULL DEFAULT '',
ADD COLUMN "birthDate" DATE,
ADD COLUMN "militaryStatus" TEXT NOT NULL DEFAULT 'NOT_SUBJECT',
ADD COLUMN "veteranStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN "veteranVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "employmentState" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "stateSince" DATE;

-- CreateIndex
CREATE UNIQUE INDEX "HrContractorCompany_companyId_name_key" ON "HrContractorCompany"("companyId", "name");

-- CreateIndex
CREATE INDEX "HrContractorCompany_companyId_active_idx" ON "HrContractorCompany"("companyId", "active");

-- CreateIndex
CREATE INDEX "HrContract_companyId_status_endDate_idx" ON "HrContract"("companyId", "status", "endDate");

-- CreateIndex
CREATE INDEX "HrContract_employeeId_status_idx" ON "HrContract"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HrDecree_companyId_number_key" ON "HrDecree"("companyId", "number");

-- CreateIndex
CREATE INDEX "HrDecree_companyId_status_issuedAt_idx" ON "HrDecree"("companyId", "status", "issuedAt");

-- CreateIndex
CREATE INDEX "HrDecree_employeeId_issuedAt_idx" ON "HrDecree"("employeeId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrDocument_employeeId_kind_key" ON "HrDocument"("employeeId", "kind");

-- CreateIndex
CREATE INDEX "HrDocument_companyId_status_idx" ON "HrDocument"("companyId", "status");

-- AddForeignKey
ALTER TABLE "HrContractorCompany" ADD CONSTRAINT "HrContractorCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrContract" ADD CONSTRAINT "HrContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrContract" ADD CONSTRAINT "HrContract_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrContract" ADD CONSTRAINT "HrContract_contractorCompanyId_fkey" FOREIGN KEY ("contractorCompanyId") REFERENCES "HrContractorCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDecree" ADD CONSTRAINT "HrDecree_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDecree" ADD CONSTRAINT "HrDecree_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDecree" ADD CONSTRAINT "HrDecree_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "HrContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocument" ADD CONSTRAINT "HrDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDocument" ADD CONSTRAINT "HrDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
