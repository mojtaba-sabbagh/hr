-- حکم: issuance is no longer the last word. کارگزینی issues a paper, its head
-- approves it, the head of the company signs it, and only then is it notified.
--
-- Papers that were already issued under the old one-step flow start again at
-- PENDING_APPROVAL: they carry a typed signer, not a captured signature, so
-- there is nothing to preserve as an approval.

ALTER TABLE "HrDecree" ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL';
UPDATE "HrDecree" SET "status" = 'PENDING_APPROVAL' WHERE "status" = 'ISSUED';

CREATE TABLE "HrDecreeSignature" (
    "id" TEXT NOT NULL,
    "decreeId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrDecreeSignature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrDecreeSignature_decreeId_stage_key" ON "HrDecreeSignature"("decreeId", "stage");
CREATE INDEX "HrDecreeSignature_userId_signedAt_idx" ON "HrDecreeSignature"("userId", "signedAt");

ALTER TABLE "HrDecreeSignature" ADD CONSTRAINT "HrDecreeSignature_decreeId_fkey" FOREIGN KEY ("decreeId") REFERENCES "HrDecree"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrDecreeSignature" ADD CONSTRAINT "HrDecreeSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
