-- حکم و صورت‌جلسه: the signature a paper is signed with, the organization's
-- decree layout, and the meeting module ported from the Django/Vue application.
--
-- Three things are deliberately data rather than code:
--   * the decree item catalogue (`HrDecreeItemRule`), because each organization
--     issues its own item set;
--   * the amounts on an issued decree (`HrDecreeItem`), copied at issue time so
--     editing the catalogue later cannot restyle a paper that was already signed;
--   * a signature on a minute (`HrMinuteSignature.image`), snapshotted, because
--     the paper must keep the mark that was put on it even if the person later
--     draws a new one.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "signatureImage" TEXT,
ADD COLUMN "signatureAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "HrDecree" ADD COLUMN "templateId" TEXT,
ADD COLUMN "signerTitle" TEXT NOT NULL DEFAULT '',
ADD COLUMN "signerUserId" TEXT;

-- CreateTable
CREATE TABLE "HrDecreeTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'حکم کارگزینی',
    "ministryLine" TEXT NOT NULL DEFAULT '',
    "unitLine" TEXT NOT NULL DEFAULT '',
    "intro" TEXT NOT NULL DEFAULT '',
    "footer" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrDecreeTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDecreeItemRule" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'EARNING',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultAmount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HrDecreeItemRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDecreeItem" (
    "id" TEXT NOT NULL,
    "decreeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "letter" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'EARNING',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HrDecreeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrHokmProfile" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fatherName" TEXT NOT NULL DEFAULT '',
    "idBookNo" TEXT NOT NULL DEFAULT '',
    "birthPlace" TEXT NOT NULL DEFAULT '',
    "birthProvince" TEXT NOT NULL DEFAULT '',
    "degree" TEXT NOT NULL DEFAULT '',
    "major" TEXT NOT NULL DEFAULT '',
    "orientation" TEXT NOT NULL DEFAULT '',
    "university" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "degreeDate" DATE,
    "orgPosition" TEXT NOT NULL DEFAULT '',
    "positionNo" TEXT NOT NULL DEFAULT '',
    "positionUniqueId" TEXT NOT NULL DEFAULT '',
    "employmentStatus" TEXT NOT NULL DEFAULT '',
    "employmentCase" TEXT NOT NULL DEFAULT 'شاغل',
    "serviceYears" INTEGER NOT NULL DEFAULT 0,
    "serviceMonths" INTEGER NOT NULL DEFAULT 0,
    "serviceDays" INTEGER NOT NULL DEFAULT 0,
    "maritalStatus" TEXT NOT NULL DEFAULT '',
    "children" INTEGER NOT NULL DEFAULT 0,
    "rank" TEXT NOT NULL DEFAULT '',
    "basePoint" INTEGER NOT NULL DEFAULT 0,
    "veteranPoint" INTEGER NOT NULL DEFAULT 0,
    "licenseNo" TEXT NOT NULL DEFAULT '',
    "licenseDate" DATE,
    "executivePosition" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrHokmProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrMeeting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrMeetingMember" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrMeetingMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrMeetingMinute" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrMeetingMinute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrMinuteAttendee" (
    "id" TEXT NOT NULL,
    "minuteId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "HrMinuteAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrMinuteResolution" (
    "id" TEXT NOT NULL,
    "minuteId" TEXT NOT NULL,
    "itemNo" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "result" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "dueDate" DATE,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HrMinuteResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrMinuteSignature" (
    "id" TEXT NOT NULL,
    "minuteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerTitle" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrMinuteSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrDecreeTemplate_companyId_name_key" ON "HrDecreeTemplate"("companyId", "name");

-- CreateIndex
CREATE INDEX "HrDecreeTemplate_companyId_active_idx" ON "HrDecreeTemplate"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "HrDecreeItemRule_templateId_key_key" ON "HrDecreeItemRule"("templateId", "key");

-- CreateIndex
CREATE INDEX "HrDecreeItemRule_templateId_sortOrder_idx" ON "HrDecreeItemRule"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "HrDecreeItem_decreeId_key_key" ON "HrDecreeItem"("decreeId", "key");

-- CreateIndex
CREATE INDEX "HrDecreeItem_decreeId_sortOrder_idx" ON "HrDecreeItem"("decreeId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "HrHokmProfile_employeeId_key" ON "HrHokmProfile"("employeeId");

-- CreateIndex
CREATE INDEX "HrMeeting_companyId_active_idx" ON "HrMeeting"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "HrMeetingMember_meetingId_employeeId_key" ON "HrMeetingMember"("meetingId", "employeeId");

-- CreateIndex
CREATE INDEX "HrMeetingMember_employeeId_active_idx" ON "HrMeetingMember"("employeeId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "HrMeetingMinute_companyId_number_key" ON "HrMeetingMinute"("companyId", "number");

-- CreateIndex
CREATE INDEX "HrMeetingMinute_companyId_status_date_idx" ON "HrMeetingMinute"("companyId", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HrMinuteAttendee_minuteId_employeeId_key" ON "HrMinuteAttendee"("minuteId", "employeeId");

-- CreateIndex
CREATE INDEX "HrMinuteResolution_minuteId_sortOrder_idx" ON "HrMinuteResolution"("minuteId", "sortOrder");

-- CreateIndex
CREATE INDEX "HrMinuteResolution_ownerId_idx" ON "HrMinuteResolution"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "HrMinuteSignature_minuteId_userId_key" ON "HrMinuteSignature"("minuteId", "userId");

-- CreateIndex
CREATE INDEX "HrMinuteSignature_userId_signedAt_idx" ON "HrMinuteSignature"("userId", "signedAt");

-- AddForeignKey
ALTER TABLE "HrDecree" ADD CONSTRAINT "HrDecree_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "HrDecreeTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDecreeTemplate" ADD CONSTRAINT "HrDecreeTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDecreeItemRule" ADD CONSTRAINT "HrDecreeItemRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "HrDecreeTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDecreeItem" ADD CONSTRAINT "HrDecreeItem_decreeId_fkey" FOREIGN KEY ("decreeId") REFERENCES "HrDecree"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrHokmProfile" ADD CONSTRAINT "HrHokmProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrMeeting" ADD CONSTRAINT "HrMeeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrMeetingMember" ADD CONSTRAINT "HrMeetingMember_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "HrMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrMeetingMember" ADD CONSTRAINT "HrMeetingMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrMeetingMinute" ADD CONSTRAINT "HrMeetingMinute_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrMeetingMinute" ADD CONSTRAINT "HrMeetingMinute_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "HrMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrMinuteAttendee" ADD CONSTRAINT "HrMinuteAttendee_minuteId_fkey" FOREIGN KEY ("minuteId") REFERENCES "HrMeetingMinute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrMinuteAttendee" ADD CONSTRAINT "HrMinuteAttendee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrMinuteResolution" ADD CONSTRAINT "HrMinuteResolution_minuteId_fkey" FOREIGN KEY ("minuteId") REFERENCES "HrMeetingMinute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrMinuteResolution" ADD CONSTRAINT "HrMinuteResolution_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "HrEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrMinuteSignature" ADD CONSTRAINT "HrMinuteSignature_minuteId_fkey" FOREIGN KEY ("minuteId") REFERENCES "HrMeetingMinute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrMinuteSignature" ADD CONSTRAINT "HrMinuteSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
