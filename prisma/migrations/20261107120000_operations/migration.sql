-- DropIndex
DROP INDEX "HrShiftPlan_period_key";

-- AlterTable
ALTER TABLE "HrShiftPlan" ADD COLUMN     "companyId" TEXT;

-- CreateTable
CREATE TABLE "OpsBudget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "center" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "allocation" BIGINT NOT NULL,

    CONSTRAINT "OpsBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsExpense" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "minimum" INTEGER NOT NULL,
    "maximum" INTEGER NOT NULL,
    "unitCost" BIGINT NOT NULL,
    "leadDays" INTEGER NOT NULL,
    "reorder" INTEGER NOT NULL,
    "partClass" TEXT NOT NULL DEFAULT 'C',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsSupplier" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "onTime" INTEGER NOT NULL,

    CONSTRAINT "OpsSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsPurchase" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "budgetId" TEXT,
    "specification" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "quoteDeadline" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedBy" TEXT NOT NULL,
    "selectedQuoteId" TEXT,
    "approvedBy" TEXT,
    "authorizedBy" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "sourcePlanId" TEXT,
    "orderedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsQuote" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "leadDays" INTEGER NOT NULL,

    CONSTRAINT "OpsQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsMove" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "issueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsIssue" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "workId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "criticality" TEXT NOT NULL,
    "installedAt" DATE NOT NULL,
    "documents" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "serviceBase" DATE NOT NULL,

    CONSTRAINT "OpsAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsReading" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "indicator" TEXT NOT NULL,
    "measured" DOUBLE PRECISION NOT NULL,
    "normal" DOUBLE PRECISION NOT NULL,
    "failure" INTEGER NOT NULL,
    "health" INTEGER NOT NULL,
    "mttr" DOUBLE PRECISION NOT NULL,
    "mtbf" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsWorkOrder" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT '',
    "downtimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reportedBy" TEXT NOT NULL,
    "safety" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "sourcePlanId" TEXT,

    CONSTRAINT "OpsWorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsOvertime" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "OpsOvertime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsPosting" (
    "token" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "target" TEXT NOT NULL,

    CONSTRAINT "OpsPosting_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpsBudget_companyId_center_year_key" ON "OpsBudget"("companyId", "center", "year");

-- CreateIndex
CREATE UNIQUE INDEX "OpsItem_companyId_code_key" ON "OpsItem"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "OpsSupplier_companyId_name_key" ON "OpsSupplier"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "OpsPurchase_selectedQuoteId_key" ON "OpsPurchase"("selectedQuoteId");

-- CreateIndex
CREATE INDEX "OpsPurchase_companyId_status_idx" ON "OpsPurchase"("companyId", "status");

-- CreateIndex
CREATE INDEX "OpsPurchase_itemId_createdAt_idx" ON "OpsPurchase"("itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpsQuote_purchaseId_supplierId_key" ON "OpsQuote"("purchaseId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "OpsMove_issueId_key" ON "OpsMove"("issueId");

-- CreateIndex
CREATE INDEX "OpsMove_itemId_createdAt_idx" ON "OpsMove"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "OpsIssue_itemId_status_idx" ON "OpsIssue"("itemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OpsAsset_companyId_code_key" ON "OpsAsset"("companyId", "code");

-- CreateIndex
CREATE INDEX "OpsReading_assetId_createdAt_idx" ON "OpsReading"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "OpsWorkOrder_assetId_closedAt_idx" ON "OpsWorkOrder"("assetId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpsWorkOrder_sourcePlanId_assetId_key" ON "OpsWorkOrder"("sourcePlanId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "OpsOvertime_planId_key" ON "OpsOvertime"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "HrShiftPlan_companyId_period_key" ON "HrShiftPlan"("companyId", "period");

-- AddForeignKey
ALTER TABLE "HrShiftPlan" ADD CONSTRAINT "HrShiftPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsBudget" ADD CONSTRAINT "OpsBudget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsExpense" ADD CONSTRAINT "OpsExpense_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "OpsBudget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsItem" ADD CONSTRAINT "OpsItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsSupplier" ADD CONSTRAINT "OpsSupplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsPurchase" ADD CONSTRAINT "OpsPurchase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsPurchase" ADD CONSTRAINT "OpsPurchase_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OpsItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsPurchase" ADD CONSTRAINT "OpsPurchase_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "OpsBudget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsPurchase" ADD CONSTRAINT "OpsPurchase_selectedQuoteId_fkey" FOREIGN KEY ("selectedQuoteId") REFERENCES "OpsQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsQuote" ADD CONSTRAINT "OpsQuote_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "OpsPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsQuote" ADD CONSTRAINT "OpsQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "OpsSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsMove" ADD CONSTRAINT "OpsMove_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OpsItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsMove" ADD CONSTRAINT "OpsMove_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "OpsPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsMove" ADD CONSTRAINT "OpsMove_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "OpsIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsIssue" ADD CONSTRAINT "OpsIssue_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OpsItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsIssue" ADD CONSTRAINT "OpsIssue_workId_fkey" FOREIGN KEY ("workId") REFERENCES "OpsWorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsAsset" ADD CONSTRAINT "OpsAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsReading" ADD CONSTRAINT "OpsReading_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "OpsAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsWorkOrder" ADD CONSTRAINT "OpsWorkOrder_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "OpsAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsOvertime" ADD CONSTRAINT "OpsOvertime_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Older plans had a global period. Assign them only when their tenant is unambiguous.
UPDATE "HrShiftPlan" p SET "companyId" = c.id
FROM (SELECT min(id) AS id FROM "Company" HAVING count(*) = 1) c;
CREATE UNIQUE INDEX "HrShiftPlan_shared_period_key" ON "HrShiftPlan" ("period") WHERE "companyId" IS NULL;

-- The prototype's deputy is its designated over-limit signatory.
UPDATE "CompanyRole" SET permissions = permissions || '["purchases:authorize"]'::jsonb
WHERE name = 'معاون توسعه و پشتیبانی' AND NOT permissions ? 'purchases:authorize';

UPDATE "Subsystem" SET dependencies = '["core"]'::jsonb WHERE key = 'maintenance';
