-- CreateEnum
CREATE TYPE "CoreRequestKind" AS ENUM ('GENERAL', 'ACCESS', 'SERVICE', 'IDEA');

-- CreateEnum
CREATE TYPE "CoreRequestStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CoreRequest" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "kind" "CoreRequestKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" "CoreRequestStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoreRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoreRequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "status" "CoreRequestStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoreRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoreNotification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "requestId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoreNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoreAnnouncement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoreAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoreIdeaVote" (
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoreIdeaVote_pkey" PRIMARY KEY ("requestId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoreRequest_number_key" ON "CoreRequest"("number");

-- CreateIndex
CREATE INDEX "CoreRequest_ownerId_createdAt_idx" ON "CoreRequest"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "CoreRequest_kind_status_createdAt_idx" ON "CoreRequest"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CoreRequestEvent_requestId_createdAt_idx" ON "CoreRequestEvent"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "CoreNotification_recipientId_readAt_createdAt_idx" ON "CoreNotification"("recipientId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "CoreAnnouncement_archivedAt_createdAt_idx" ON "CoreAnnouncement"("archivedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "CoreRequestEvent" ADD CONSTRAINT "CoreRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CoreRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoreIdeaVote" ADD CONSTRAINT "CoreIdeaVote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CoreRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

