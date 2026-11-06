-- دستیار هوشمند — مرحلهٔ ۱ (AI-05).
--
-- سه منبع جدا: بخش‌های کتاب فرایندها، پاسخ‌های متداول دست‌چین، و سقف‌های
-- اختیار مالی. آیین‌نامه‌ها کپی نمی‌شوند؛ همان ردیف‌های HrRegulation خوانده
-- می‌شوند تا ویرایش آیین‌نامه بی‌درنگ در پاسخ‌ها دیده شود.

CREATE TABLE "HrKnowledgeArticle" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'process-book',
  "page" INTEGER,
  "ord" INTEGER NOT NULL DEFAULT 0,
  "published" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HrKnowledgeArticle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrKnowledgeArticle_slug_key" ON "HrKnowledgeArticle"("slug");
CREATE INDEX "HrKnowledgeArticle_category_ord_idx" ON "HrKnowledgeArticle"("category", "ord");
CREATE INDEX "HrKnowledgeArticle_published_idx" ON "HrKnowledgeArticle"("published");

CREATE TABLE "HrFaq" (
  "id" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "audienceKeys" JSONB NOT NULL DEFAULT '[]',
  "published" BOOLEAN NOT NULL DEFAULT false,
  "hits" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HrFaq_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrFaq_published_idx" ON "HrFaq"("published");

CREATE TABLE "HrAuthorityLimit" (
  "id" TEXT NOT NULL,
  "roleKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "ceilingRial" BIGINT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HrAuthorityLimit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrAuthorityLimit_roleKey_key" ON "HrAuthorityLimit"("roleKey");

CREATE TABLE "HrAssistantQuestion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeId" TEXT,
  "question" TEXT NOT NULL,
  "intent" TEXT NOT NULL DEFAULT '',
  "matchKind" TEXT NOT NULL DEFAULT '',
  "matchId" TEXT,
  "score" INTEGER NOT NULL DEFAULT 0,
  "answered" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrAssistantQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrAssistantQuestion_createdAt_idx" ON "HrAssistantQuestion"("createdAt");
CREATE INDEX "HrAssistantQuestion_answered_createdAt_idx" ON "HrAssistantQuestion"("answered", "createdAt");
