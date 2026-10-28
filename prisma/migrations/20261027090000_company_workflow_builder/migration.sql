-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMember" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyRole" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMemberRole" (
    "memberId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "CompanyMemberRole_pkey" PRIMARY KEY ("memberId","roleId")
);

-- CreateTable
CREATE TABLE "BuilderForm" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'core',
    "schema" JSONB NOT NULL,
    "submitRoleIds" JSONB NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuilderWorkflow" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "publishedVersion" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "formSchema" JSONB NOT NULL,
    "formTitle" TEXT NOT NULL,
    "formCode" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowInstance" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "companyId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submitterName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "parameters" JSONB NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'running',
    "currentNodeId" TEXT,
    "returnNodeId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "round" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTask" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "assignedTo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowAction" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeLabel" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowNotice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAudit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE INDEX "CompanyMember_companyId_active_idx" ON "CompanyMember"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMember_companyId_userId_key" ON "CompanyMember"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRole_companyId_name_key" ON "CompanyRole"("companyId", "name");

-- CreateIndex
CREATE INDEX "BuilderForm_companyId_category_idx" ON "BuilderForm"("companyId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "BuilderForm_companyId_code_key" ON "BuilderForm"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BuilderWorkflow_formId_key" ON "BuilderWorkflow"("formId");

-- CreateIndex
CREATE INDEX "BuilderWorkflow_companyId_idx" ON "BuilderWorkflow"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowInstance_number_key" ON "WorkflowInstance"("number");

-- CreateIndex
CREATE INDEX "WorkflowInstance_companyId_submittedBy_createdAt_idx" ON "WorkflowInstance"("companyId", "submittedBy", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowInstance_companyId_status_idx" ON "WorkflowInstance"("companyId", "status");

-- CreateIndex
CREATE INDEX "WorkflowTask_assignedTo_status_dueAt_idx" ON "WorkflowTask"("assignedTo", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTask_instanceId_round_assignedTo_key" ON "WorkflowTask"("instanceId", "round", "assignedTo");

-- CreateIndex
CREATE INDEX "WorkflowAction_instanceId_createdAt_idx" ON "WorkflowAction"("instanceId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowNotice_companyId_recipientId_readAt_idx" ON "WorkflowNotice"("companyId", "recipientId", "readAt");

-- CreateIndex
CREATE INDEX "CompanyAudit_companyId_createdAt_idx" ON "CompanyAudit"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRole" ADD CONSTRAINT "CompanyRole_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMemberRole" ADD CONSTRAINT "CompanyMemberRole_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CompanyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMemberRole" ADD CONSTRAINT "CompanyMemberRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CompanyRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuilderForm" ADD CONSTRAINT "BuilderForm_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuilderWorkflow" ADD CONSTRAINT "BuilderWorkflow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuilderWorkflow" ADD CONSTRAINT "BuilderWorkflow_formId_fkey" FOREIGN KEY ("formId") REFERENCES "BuilderForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "BuilderWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "WorkflowVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAction" ADD CONSTRAINT "WorkflowAction_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowNotice" ADD CONSTRAINT "WorkflowNotice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAudit" ADD CONSTRAINT "CompanyAudit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
