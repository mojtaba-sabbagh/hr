-- زیرساخت موتورهای هوش مصنوعی: دفتر رویداد (برای «دوباره هشدار نده»)،
-- اضافه‌کاری ثبت‌شده (خط ۴۰ ساعت باید قابل دفاع باشد)، ضریب‌های پلن روی خود
-- پلن، و محل فرود «نیاز آموزشی» که AI-10 امروز و AI-03 بعداً از آن استفاده می‌کند.

ALTER TABLE "HrAttendance" ADD COLUMN "overtimeMinutes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "HrShiftPlan" ADD COLUMN "factors" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "HrShiftPlan" ADD COLUMN "effects" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "HrShiftPlan" ADD COLUMN "fromDate" DATE;
ALTER TABLE "HrShiftPlan" ADD COLUMN "toDate" DATE;
ALTER TABLE "HrShiftPlan" ADD COLUMN "confirmedBy" TEXT;
ALTER TABLE "HrShiftPlan" ADD COLUMN "confirmedAt" TIMESTAMP(3);

CREATE TABLE "HrAiEvent" (
    "id" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "subjectId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'warn',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrAiEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrAiEvent_engine_dedupeKey_createdAt_key" ON "HrAiEvent"("engine", "dedupeKey", "createdAt");
CREATE INDEX "HrAiEvent_engine_subjectId_createdAt_idx" ON "HrAiEvent"("engine", "subjectId", "createdAt");

CREATE TABLE "HrTrainingNeed" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "course" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrTrainingNeed_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrTrainingNeed_employeeId_course_source_key" ON "HrTrainingNeed"("employeeId", "course", "source");
CREATE INDEX "HrTrainingNeed_status_course_idx" ON "HrTrainingNeed"("status", "course");
