-- HSE تایپ‌شده — AI-09، قاعدهٔ ۱۵ ممیزی و دو وزن آموزشی حادثه‌محور.
--
-- تا امروز HSE فقط فرم‌ساز عمومی بود. موتور ریسک باید روی ستون‌های عددی و
-- شمارشی اجرا شود، نه روی JSON یک فرم، وگرنه اولین ویرایش فرم قاعده را می‌شکند.

CREATE TABLE "HrAiSetting" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL DEFAULT '',
  "updatedBy" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HrAiSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "HseHazard" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL,
  "area" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT 'GENERAL',
  "description" TEXT NOT NULL DEFAULT '',
  "probability" INTEGER NOT NULL DEFAULT 1,
  "severity" INTEGER NOT NULL DEFAULT 1,
  "score" INTEGER NOT NULL DEFAULT 1,
  "level" TEXT NOT NULL DEFAULT 'LOW',
  "controls" TEXT NOT NULL DEFAULT '',
  "ownerName" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "reviewAt" TIMESTAMP(3),
  "companyId" TEXT,
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HseHazard_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HseHazard_companyId_status_idx" ON "HseHazard"("companyId", "status");
CREATE INDEX "HseHazard_level_idx" ON "HseHazard"("level");

CREATE TABLE "HseIncident" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'INCIDENT',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "area" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "outcome" TEXT NOT NULL DEFAULT 'NONE',
  "potential" INTEGER NOT NULL DEFAULT 1,
  "score" INTEGER NOT NULL DEFAULT 3,
  "level" TEXT NOT NULL DEFAULT 'LOW',
  "rootCause" TEXT NOT NULL DEFAULT 'OTHER',
  "actionsTaken" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "reporterId" TEXT NOT NULL DEFAULT '',
  "reporterName" TEXT NOT NULL DEFAULT '',
  "companyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HseIncident_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HseIncident_companyId_occurredAt_idx" ON "HseIncident"("companyId", "occurredAt");
CREATE INDEX "HseIncident_level_idx" ON "HseIncident"("level");

CREATE TABLE "HseIncidentPerson" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'INVOLVED',
  CONSTRAINT "HseIncidentPerson_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HseIncidentPerson_incidentId_employeeId_key" ON "HseIncidentPerson"("incidentId", "employeeId");
CREATE INDEX "HseIncidentPerson_employeeId_idx" ON "HseIncidentPerson"("employeeId");

CREATE TABLE "HseCapa" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "incidentId" TEXT,
  "hazardId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'AWAITING_PROPOSAL',
  "proposal" TEXT NOT NULL DEFAULT '',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "ownerId" TEXT NOT NULL DEFAULT '',
  "ownerName" TEXT NOT NULL DEFAULT '',
  "closedAt" TIMESTAMP(3),
  "companyId" TEXT,
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HseCapa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HseCapa_companyId_status_dueAt_idx" ON "HseCapa"("companyId", "status", "dueAt");
CREATE INDEX "HseCapa_incidentId_idx" ON "HseCapa"("incidentId");

ALTER TABLE "HseIncidentPerson" ADD CONSTRAINT "HseIncidentPerson_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "HseIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HseIncidentPerson" ADD CONSTRAINT "HseIncidentPerson_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HseCapa" ADD CONSTRAINT "HseCapa_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "HseIncident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HseCapa" ADD CONSTRAINT "HseCapa_hazardId_fkey" FOREIGN KEY ("hazardId") REFERENCES "HseHazard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
