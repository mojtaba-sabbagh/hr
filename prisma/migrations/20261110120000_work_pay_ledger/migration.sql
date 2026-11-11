BEGIN;
-- CreateTable
CREATE TABLE "ClockEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "workerCode" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL,

    CONSTRAINT "ClockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClockMap" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "workerCode" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,

    CONSTRAINT "ClockMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClockCursor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClockCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "start" DATE NOT NULL,
    "end" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,

    CONSTRAINT "WorkPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkMember" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "snapshot" JSONB,

    CONSTRAINT "WorkMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkFix" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "regular" INTEGER NOT NULL,
    "overtime" INTEGER NOT NULL,
    "leave" INTEGER NOT NULL,
    "mission" INTEGER NOT NULL,
    "scheduled" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "WorkFix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "effective" DATE NOT NULL,
    "monthlyMinutes" INTEGER NOT NULL,
    "overtimePercent" INTEGER NOT NULL,
    "insuranceBP" INTEGER NOT NULL,
    "employerBP" INTEGER NOT NULL,
    "taxBands" JSONB NOT NULL,

    CONSTRAINT "PayPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRun" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "policy" JSONB NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "finalizedBy" TEXT,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaySlip" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "gross" BIGINT NOT NULL,
    "deductions" BIGINT NOT NULL,
    "net" BIGINT NOT NULL,

    CONSTRAINT "PaySlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayAdjustment" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "taxable" BOOLEAN NOT NULL,
    "insurable" BOOLEAN NOT NULL,

    CONSTRAINT "PayAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "start" DATE NOT NULL,
    "end" DATE NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "posting" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPostingMap" (
    "companyId" TEXT NOT NULL,
    "accounts" JSONB NOT NULL,

    CONSTRAINT "PayrollPostingMap_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "Journal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "number" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" BIGINT NOT NULL,
    "credit" BIGINT NOT NULL,
    "center" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClockEvent_companyId_occurredAt_idx" ON "ClockEvent"("companyId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClockEvent_companyId_source_externalId_key" ON "ClockEvent"("companyId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ClockMap_companyId_source_workerCode_key" ON "ClockMap"("companyId", "source", "workerCode");

-- CreateIndex
CREATE UNIQUE INDEX "ClockCursor_companyId_source_key" ON "ClockCursor"("companyId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPeriod_companyId_start_key" ON "WorkPeriod"("companyId", "start");

-- CreateIndex
CREATE UNIQUE INDEX "WorkMember_periodId_employeeId_key" ON "WorkMember"("periodId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkFix_memberId_date_key" ON "WorkFix"("memberId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PayPolicy_companyId_effective_key" ON "PayPolicy"("companyId", "effective");

-- CreateIndex
CREATE UNIQUE INDEX "PayRun_periodId_key" ON "PayRun"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "PaySlip_runId_employeeId_key" ON "PaySlip"("runId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_companyId_start_key" ON "FiscalYear"("companyId", "start");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_companyId_code_key" ON "LedgerAccount"("companyId", "code");

-- CreateIndex
CREATE INDEX "Journal_companyId_date_idx" ON "Journal"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_companyId_source_reference_event_key" ON "Journal"("companyId", "source", "reference", "event");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_yearId_number_key" ON "Journal"("yearId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "JournalLine_journalId_position_key" ON "JournalLine"("journalId", "position");

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockMap" ADD CONSTRAINT "ClockMap_companyId_employeeId_fkey" FOREIGN KEY ("companyId", "employeeId") REFERENCES "HrEmployee"("companyId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ClockCursor" ADD CONSTRAINT "ClockCursor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPeriod" ADD CONSTRAINT "WorkPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkMember" ADD CONSTRAINT "WorkMember_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "WorkPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkMember" ADD CONSTRAINT "WorkMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkFix" ADD CONSTRAINT "WorkFix_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "WorkMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPolicy" ADD CONSTRAINT "PayPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "WorkPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaySlip" ADD CONSTRAINT "PaySlip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaySlip" ADD CONSTRAINT "PaySlip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayAdjustment" ADD CONSTRAINT "PayAdjustment_periodId_employeeId_fkey" FOREIGN KEY ("periodId", "employeeId") REFERENCES "WorkMember"("periodId", "employeeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPostingMap" ADD CONSTRAINT "PayrollPostingMap_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Subsystem" (id,key,title,enabled,"sortOrder",dependencies,"updatedAt") VALUES ('office-attendance','attendance','حضور و غیاب',true,13,'["core","hr"]',now());
INSERT INTO "Group" (id,name,"subsystemId") VALUES ('office-attendance-manager','مدیر حضور و غیاب','office-attendance');
INSERT INTO "Group" (id,name,"subsystemId") VALUES ('office-attendance-viewer','مشاهده‌گر حضور و غیاب','office-attendance');
INSERT INTO "Group" (id,name,"subsystemId") VALUES ('office-attendance-employee','کارکرد من','office-attendance');
INSERT INTO "Permission" (id,key,title) VALUES ('attendance:records:view','attendance:records:view','مشاهده کارکرد و تردد');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-attendance-manager','attendance:records:view');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-attendance-viewer','attendance:records:view');
INSERT INTO "Permission" (id,key,title) VALUES ('attendance:records:manage','attendance:records:manage','ثبت و ویرایش کارکرد و تردد');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-attendance-manager','attendance:records:manage');
INSERT INTO "Permission" (id,key,title) VALUES ('attendance:records:approve','attendance:records:approve','تأیید کارکرد و تردد');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-attendance-manager','attendance:records:approve');
INSERT INTO "Permission" (id,key,title) VALUES ('attendance:records:self','attendance:records:self','مشاهده شخصی کارکرد و تردد');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-attendance-manager','attendance:records:self');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-attendance-employee','attendance:records:self');
INSERT INTO "UserGroup" ("userId","groupId") SELECT ug."userId",'office-attendance-manager' FROM "UserGroup" ug JOIN "Group" g ON g.id=ug."groupId" JOIN "Subsystem" s ON s.id=g."subsystemId" WHERE s.key='hr' AND g.name='نمونه پرتال · معاون توسعه و پشتیبانی';
INSERT INTO "Subsystem" (id,key,title,enabled,"sortOrder",dependencies,"updatedAt") VALUES ('office-payroll','payroll','حقوق و دستمزد',true,14,'["hr","attendance"]',now());
INSERT INTO "Group" (id,name,"subsystemId") VALUES ('office-payroll-manager','مدیر حقوق و دستمزد','office-payroll');
INSERT INTO "Group" (id,name,"subsystemId") VALUES ('office-payroll-viewer','مشاهده‌گر حقوق و دستمزد','office-payroll');
INSERT INTO "Group" (id,name,"subsystemId") VALUES ('office-payroll-employee','فیش حقوق من','office-payroll');
INSERT INTO "Permission" (id,key,title) VALUES ('payroll:runs:view','payroll:runs:view','مشاهده لیست حقوق');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-payroll-manager','payroll:runs:view');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-payroll-viewer','payroll:runs:view');
INSERT INTO "Permission" (id,key,title) VALUES ('payroll:runs:manage','payroll:runs:manage','ثبت و ویرایش لیست حقوق');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-payroll-manager','payroll:runs:manage');
INSERT INTO "Permission" (id,key,title) VALUES ('payroll:runs:approve','payroll:runs:approve','تأیید لیست حقوق');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-payroll-manager','payroll:runs:approve');
INSERT INTO "Permission" (id,key,title) VALUES ('payroll:runs:self','payroll:runs:self','مشاهده شخصی لیست حقوق');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-payroll-manager','payroll:runs:self');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-payroll-employee','payroll:runs:self');
INSERT INTO "UserGroup" ("userId","groupId") SELECT ug."userId",'office-payroll-manager' FROM "UserGroup" ug JOIN "Group" g ON g.id=ug."groupId" JOIN "Subsystem" s ON s.id=g."subsystemId" WHERE s.key='hr' AND g.name='نمونه پرتال · معاون توسعه و پشتیبانی';
INSERT INTO "Subsystem" (id,key,title,enabled,"sortOrder",dependencies,"updatedAt") VALUES ('office-accounting','accounting','حسابداری',true,15,'["core"]',now());
INSERT INTO "Group" (id,name,"subsystemId") VALUES ('office-accounting-manager','مدیر حسابداری','office-accounting');
INSERT INTO "Group" (id,name,"subsystemId") VALUES ('office-accounting-viewer','مشاهده‌گر حسابداری','office-accounting');
INSERT INTO "Permission" (id,key,title) VALUES ('accounting:ledger:view','accounting:ledger:view','مشاهده اسناد حسابداری');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-accounting-manager','accounting:ledger:view');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-accounting-viewer','accounting:ledger:view');
INSERT INTO "Permission" (id,key,title) VALUES ('accounting:ledger:manage','accounting:ledger:manage','ثبت و ویرایش اسناد حسابداری');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-accounting-manager','accounting:ledger:manage');
INSERT INTO "Permission" (id,key,title) VALUES ('accounting:ledger:approve','accounting:ledger:approve','تأیید اسناد حسابداری');
INSERT INTO "GroupPermission" ("groupId","permissionId") VALUES ('office-accounting-manager','accounting:ledger:approve');
INSERT INTO "UserGroup" ("userId","groupId") SELECT ug."userId",'office-accounting-manager' FROM "UserGroup" ug JOIN "Group" g ON g.id=ug."groupId" JOIN "Subsystem" s ON s.id=g."subsystemId" WHERE s.key='hr' AND g.name='نمونه پرتال · معاون توسعه و پشتیبانی';
COMMIT;
