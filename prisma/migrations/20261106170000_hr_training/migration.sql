-- آموزش و توسعه — مدل‌های AI-03.
--
-- چرا جدا از HrTrainingNeed: آن جدول یک «نیاز» است و این‌ها چیزهایی که نیاز را
-- برطرف می‌کنند. دوره، مدرس، کلاس، ثبت‌نام و گواهی‌نامه هرکدام عمر جداگانه‌ای
-- دارند؛ گواهی به دوره گره می‌خورد نه به کلاس، چون تکرار کلاس اعتبار را تمدید
-- نمی‌کند و انقضای گواهی خودش یکی از وزن‌های نیازسنجی است.
ALTER TABLE "HrTrainingNeed" ADD COLUMN "courseId" TEXT;
ALTER TABLE "HrTrainingNeed" ADD COLUMN "reasons" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "HrTrainingNeed" ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "HrTrainingNeed_courseId_idx" ON "HrTrainingNeed"("courseId");

CREATE TABLE "HrCourse" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "mandatory" BOOLEAN NOT NULL DEFAULT false,
  "validityMonths" INTEGER NOT NULL DEFAULT 0,
  "passScore" INTEGER NOT NULL DEFAULT 60,
  "minAttendees" INTEGER NOT NULL DEFAULT 3,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HrCourse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrCourse_title_key" ON "HrCourse"("title");
CREATE INDEX "HrCourse_active_mandatory_idx" ON "HrCourse"("active", "mandatory");

CREATE TABLE "HrInstructor" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "employeeId" TEXT,
  "userId" TEXT,
  "email" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HrInstructor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrInstructor_active_idx" ON "HrInstructor"("active");

CREATE TABLE "HrInstructorSlot" (
  "id" TEXT NOT NULL,
  "instructorId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL DEFAULT 0,
  "slot" TEXT NOT NULL,
  "available" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "HrInstructorSlot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrInstructorSlot_instructorId_weekday_slot_key" ON "HrInstructorSlot"("instructorId", "weekday", "slot");
CREATE INDEX "HrInstructorSlot_instructorId_weekday_idx" ON "HrInstructorSlot"("instructorId", "weekday");
ALTER TABLE "HrInstructorSlot" ADD CONSTRAINT "HrInstructorSlot_instructorId_fkey"
  FOREIGN KEY ("instructorId") REFERENCES "HrInstructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrCourseInstructor" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "instructorId" TEXT NOT NULL,
  CONSTRAINT "HrCourseInstructor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrCourseInstructor_courseId_instructorId_key" ON "HrCourseInstructor"("courseId", "instructorId");
CREATE INDEX "HrCourseInstructor_instructorId_idx" ON "HrCourseInstructor"("instructorId");
ALTER TABLE "HrCourseInstructor" ADD CONSTRAINT "HrCourseInstructor_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "HrCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrCourseInstructor" ADD CONSTRAINT "HrCourseInstructor_instructorId_fkey"
  FOREIGN KEY ("instructorId") REFERENCES "HrInstructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrCourseSession" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "instructorId" TEXT,
  "date" DATE NOT NULL,
  "slot" TEXT NOT NULL,
  "room" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "minAttendees" INTEGER NOT NULL DEFAULT 3,
  "planHash" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "publishedBy" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HrCourseSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrCourseSession_courseId_date_slot_key" ON "HrCourseSession"("courseId", "date", "slot");
CREATE INDEX "HrCourseSession_date_status_idx" ON "HrCourseSession"("date", "status");
ALTER TABLE "HrCourseSession" ADD CONSTRAINT "HrCourseSession_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "HrCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HrCourseSession" ADD CONSTRAINT "HrCourseSession_instructorId_fkey"
  FOREIGN KEY ("instructorId") REFERENCES "HrInstructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "HrEnrollment" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'INVITED',
  "attended" BOOLEAN NOT NULL DEFAULT false,
  "score" INTEGER,
  "satisfaction" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HrEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrEnrollment_sessionId_employeeId_key" ON "HrEnrollment"("sessionId", "employeeId");
CREATE INDEX "HrEnrollment_employeeId_idx" ON "HrEnrollment"("employeeId");
ALTER TABLE "HrEnrollment" ADD CONSTRAINT "HrEnrollment_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "HrCourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrCertificate" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "enrollmentId" TEXT,
  "serial" TEXT NOT NULL,
  "issuedAt" DATE NOT NULL,
  "expiresAt" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrCertificate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrCertificate_enrollmentId_key" ON "HrCertificate"("enrollmentId");
CREATE UNIQUE INDEX "HrCertificate_serial_key" ON "HrCertificate"("serial");
CREATE INDEX "HrCertificate_employeeId_courseId_idx" ON "HrCertificate"("employeeId", "courseId");
CREATE INDEX "HrCertificate_expiresAt_idx" ON "HrCertificate"("expiresAt");
ALTER TABLE "HrCertificate" ADD CONSTRAINT "HrCertificate_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "HrCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HrCertificate" ADD CONSTRAINT "HrCertificate_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "HrEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HrTrainingNeed" ADD CONSTRAINT "HrTrainingNeed_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "HrCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
