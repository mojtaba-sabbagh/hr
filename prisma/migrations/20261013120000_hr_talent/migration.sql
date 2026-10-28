-- CreateTable
CREATE TABLE "HrEmployeeFeature" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "previousValue" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "recordedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrEmployeeFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTalentReview" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "performance" INTEGER NOT NULL DEFAULT 60,
    "potential" INTEGER NOT NULL DEFAULT 1,
    "promoReady" BOOLEAN NOT NULL DEFAULT false,
    "targetRole" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "careerPath" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrTalentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrOkr" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "keyResult" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrOkr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrShiftPlan" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metrics" JSONB NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrShiftPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployeeFeature_employeeId_category_item_key" ON "HrEmployeeFeature"("employeeId", "category", "item");

-- CreateIndex
CREATE INDEX "HrEmployeeFeature_category_item_idx" ON "HrEmployeeFeature"("category", "item");

-- CreateIndex
CREATE UNIQUE INDEX "HrTalentReview_employeeId_key" ON "HrTalentReview"("employeeId");

-- CreateIndex
CREATE INDEX "HrTalentReview_status_idx" ON "HrTalentReview"("status");

-- CreateIndex
CREATE INDEX "HrOkr_period_status_idx" ON "HrOkr"("period", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HrShiftPlan_period_key" ON "HrShiftPlan"("period");

-- CreateIndex
CREATE INDEX "HrShiftPlan_status_idx" ON "HrShiftPlan"("status");

-- AddForeignKey
ALTER TABLE "HrEmployeeFeature" ADD CONSTRAINT "HrEmployeeFeature_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTalentReview" ADD CONSTRAINT "HrTalentReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
