-- CreateTable
CREATE TABLE "HrEmployee" (
    "id" TEXT NOT NULL,
    "personnelCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "department" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "worksite" TEXT NOT NULL,
    "managerId" TEXT,
    "startDate" DATE NOT NULL,
    "contractType" TEXT NOT NULL DEFAULT 'FULL_TIME',
    "phone" TEXT NOT NULL DEFAULT '',
    "education" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrRequest" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "minutes" INTEGER,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrRequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAttendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "clockIn" TEXT,
    "clockOut" TEXT,
    "endNextDay" BOOLEAN NOT NULL DEFAULT false,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "recordedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrShift" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "endNextDay" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEvaluation" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "developmentPlan" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrJob" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "worksite" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrCandidate" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "education" TEXT NOT NULL DEFAULT '',
    "experienceYears" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'APPLIED',
    "decisionNote" TEXT,
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTransfer" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromDepartment" TEXT NOT NULL,
    "fromJobTitle" TEXT NOT NULL,
    "fromWorksite" TEXT NOT NULL,
    "toDepartment" TEXT NOT NULL,
    "toJobTitle" TEXT NOT NULL,
    "toWorksite" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "proposedBy" TEXT NOT NULL,
    "proposedByName" TEXT NOT NULL,
    "decisionNote" TEXT,
    "decidedBy" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSurvey" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "department" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dueDate" DATE,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSurveyResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrSurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrFeedback" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "response" TEXT,
    "respondedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrRegulation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrRegulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAcknowledgement" (
    "regulationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrAcknowledgement_pkey" PRIMARY KEY ("regulationId","employeeId")
);

-- CreateTable
CREATE TABLE "HrNotification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "view" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployee_personnelCode_key" ON "HrEmployee"("personnelCode");

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployee_userId_key" ON "HrEmployee"("userId");

-- CreateIndex
CREATE INDEX "HrEmployee_managerId_active_idx" ON "HrEmployee"("managerId", "active");

-- CreateIndex
CREATE INDEX "HrEmployee_department_active_idx" ON "HrEmployee"("department", "active");

-- CreateIndex
CREATE UNIQUE INDEX "HrRequest_number_key" ON "HrRequest"("number");

-- CreateIndex
CREATE INDEX "HrRequest_employeeId_status_createdAt_idx" ON "HrRequest"("employeeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "HrRequestEvent_requestId_createdAt_idx" ON "HrRequestEvent"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrAttendance_employeeId_workDate_key" ON "HrAttendance"("employeeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "HrShift_employeeId_workDate_key" ON "HrShift"("employeeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "HrEvaluation_employeeId_period_key" ON "HrEvaluation"("employeeId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "HrCandidate_jobId_email_key" ON "HrCandidate"("jobId", "email");

-- CreateIndex
CREATE INDEX "HrTransfer_employeeId_status_idx" ON "HrTransfer"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HrSurveyResponse_surveyId_employeeId_key" ON "HrSurveyResponse"("surveyId", "employeeId");

-- CreateIndex
CREATE INDEX "HrNotification_recipientId_readAt_createdAt_idx" ON "HrNotification"("recipientId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "HrEmployee" ADD CONSTRAINT "HrEmployee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployee" ADD CONSTRAINT "HrEmployee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "HrEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrRequest" ADD CONSTRAINT "HrRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrRequestEvent" ADD CONSTRAINT "HrRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HrRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendance" ADD CONSTRAINT "HrAttendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrShift" ADD CONSTRAINT "HrShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEvaluation" ADD CONSTRAINT "HrEvaluation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrCandidate" ADD CONSTRAINT "HrCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HrJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTransfer" ADD CONSTRAINT "HrTransfer_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSurveyResponse" ADD CONSTRAINT "HrSurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "HrSurvey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSurveyResponse" ADD CONSTRAINT "HrSurveyResponse_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrFeedback" ADD CONSTRAINT "HrFeedback_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAcknowledgement" ADD CONSTRAINT "HrAcknowledgement_regulationId_fkey" FOREIGN KEY ("regulationId") REFERENCES "HrRegulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAcknowledgement" ADD CONSTRAINT "HrAcknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

