import type { Tx } from "../company-service";
import { receiveJournal } from "./accounting";
import { day } from "./shared";

export async function journalForOperation(
  tx: Tx,
  companyId: string,
  operation: "expense" | "receipt",
  id: string,
) {
  const source = operation === "expense" ? "finance" : "warehouse";
  const rule = await tx.ledgerRule.findUnique({
    where: { companyId_source_event: { companyId, source, event: operation } },
  });
  if (!rule || !(await tx.subsystem.findUnique({ where: { key: "accounting" } }))?.enabled) return;
  if (operation === "expense") {
    const row = await tx.opsExpense.findUniqueOrThrow({ where: { id }, include: { budget: true } });
    await receiveJournal(
      tx,
      companyId,
      {
        source,
        event: operation,
        reference: id,
        date: day(row.createdAt),
        description: row.description,
        center: row.budget.center,
        amount: String(row.amount),
      },
      true,
    );
  } else {
    const row = await tx.opsMove.findUniqueOrThrow({
      where: { id },
      include: { purchase: { include: { selectedQuote: true, budget: true } } },
    });
    const purchase = row.purchase!;
    await receiveJournal(
      tx,
      companyId,
      {
        source,
        event: operation,
        reference: id,
        date: day(row.createdAt),
        description: "رسید خرید " + row.reference,
        center: purchase.budget?.center,
        amount: String(purchase.selectedQuote!.unitPrice * BigInt(row.delta)),
      },
      true,
    );
  }
}
