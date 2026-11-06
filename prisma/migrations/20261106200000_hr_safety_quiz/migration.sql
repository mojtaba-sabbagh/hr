-- آزمون روزانهٔ ایمنی (AI-11).
--
-- بانک سؤال، برگهٔ هر روز و پاسخ‌ها سه چیز جدا هستند: سؤال محتوایی است که HSE
-- ویرایش می‌کند، برگه ثبت می‌کند که امروز کدام سه سؤال به این شخص داده شد (تا
-- ویرایش بانک وسط روز، آزمون نیمه‌تمام را عوض نکند)، و پاسخ ردیف قابل حسابرسی
-- است با یکتایی (کارمند، روز، سؤال) که ارسال دوباره را در سطح پایگاه داده می‌بندد.

CREATE TABLE "HrSafetyQuestion" (
  "id" TEXT NOT NULL,
  "stem" TEXT NOT NULL,
  "options" JSONB NOT NULL DEFAULT '[]',
  "answerIndex" INTEGER NOT NULL,
  "explain" TEXT NOT NULL DEFAULT '',
  "riskKey" TEXT NOT NULL DEFAULT '',
  "jobTitles" JSONB NOT NULL DEFAULT '[]',
  "general" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL DEFAULT 'seed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HrSafetyQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrSafetyQuestion_active_general_idx" ON "HrSafetyQuestion"("active", "general");
CREATE INDEX "HrSafetyQuestion_riskKey_idx" ON "HrSafetyQuestion"("riskKey");

CREATE TABLE "HrSafetyAssignment" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "questionIds" JSONB NOT NULL DEFAULT '[]',
  "briefingId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrSafetyAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrSafetyAssignment_employeeId_workDate_key" ON "HrSafetyAssignment"("employeeId", "workDate");
CREATE INDEX "HrSafetyAssignment_workDate_idx" ON "HrSafetyAssignment"("workDate");

CREATE TABLE "HrSafetyAnswer" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "choice" INTEGER NOT NULL,
  "correct" BOOLEAN NOT NULL,
  "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrSafetyAnswer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrSafetyAnswer_employeeId_workDate_questionId_key" ON "HrSafetyAnswer"("employeeId", "workDate", "questionId");
CREATE INDEX "HrSafetyAnswer_employeeId_workDate_idx" ON "HrSafetyAnswer"("employeeId", "workDate");
CREATE INDEX "HrSafetyAnswer_questionId_workDate_idx" ON "HrSafetyAnswer"("questionId", "workDate");

CREATE TABLE "HrSafetyBriefing" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "ord" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HrSafetyBriefing_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrSafetyBriefing_active_ord_idx" ON "HrSafetyBriefing"("active", "ord");

ALTER TABLE "HrSafetyAssignment" ADD CONSTRAINT "HrSafetyAssignment_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrSafetyAnswer" ADD CONSTRAINT "HrSafetyAnswer_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrSafetyAnswer" ADD CONSTRAINT "HrSafetyAnswer_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "HrSafetyQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
