ALTER TABLE "Journal" ADD COLUMN "sourceHash" TEXT;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_single_side"
  CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0));
ALTER TABLE "PaySlip" ADD CONSTRAINT "PaySlip_totals"
  CHECK ("gross" >= 0 AND "deductions" >= 0 AND "net" >= 0 AND "net" = "gross" - "deductions");
