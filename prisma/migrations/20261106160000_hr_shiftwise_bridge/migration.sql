-- مرز منابع انسانی و شیفت‌یار.
--
-- HrShift دیگر برنامهٔ دوم قابل ویرایش نیست: ستون source نشان می‌دهد ردیف از
-- کجا آمده و syncedAt می‌گوید آخرین بار چه زمانی از شیفت‌یار خوانده شده است.
-- ردیف‌های قدیمی HR باقی می‌مانند تا چیزی پاک نشود؛ فقط نوشتن دستی بسته می‌شود.
ALTER TABLE "HrShift" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'HR';
ALTER TABLE "HrShift" ADD COLUMN "syncedAt" TIMESTAMP(3);
CREATE INDEX "HrShift_source_workDate_idx" ON "HrShift"("source", "workDate");

-- هر همگام‌سازی یک ردیف می‌گذارد تا «چرا برنامهٔ هفته قدیمی است» پاسخ داشته باشد.
CREATE TABLE "HrShiftSync" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'ROSTER',
  "status" TEXT NOT NULL DEFAULT 'OK',
  "weekStart" DATE NOT NULL,
  "pushedWorkers" INTEGER NOT NULL DEFAULT 0,
  "pushedLeaves" INTEGER NOT NULL DEFAULT 0,
  "importedShifts" INTEGER NOT NULL DEFAULT 0,
  "uncovered" INTEGER NOT NULL DEFAULT 0,
  "skipped" JSONB NOT NULL DEFAULT '[]',
  "message" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrShiftSync_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrShiftSync_createdAt_idx" ON "HrShiftSync"("createdAt");
