import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { listCompanies } from "../lib/company-service";
import { AccessError } from "../lib/access-policy";
import { smartBoard } from "../lib/smart/inbox";
import SmartDesk from "../components/smart-desk";

export const dynamic = "force-dynamic";
export default async function SmartInbox({
  searchParams,
}: {
  searchParams: { company?: string; period?: string };
}) {
  const actor = await getSession();
  if (!actor) redirect("/login");
  try {
    const companies = (await listCompanies(actor)).filter((c) => c.active);
    const selected = searchParams.company ?? companies[0]?.id;
    const company = companies.find((c) => c.id === selected);
    if (!company) throw new AccessError(403, "برای مشاهدهٔ کارتابل، دسترسی به یک شرکت فعال لازم است.");
    const board = await smartBoard(actor, company.id, searchParams.period);
    return (
      <SmartDesk
        key={company.id + board.period}
        actor={actor}
        companyId={company.id}
        companies={companies}
        board={board}
      />
    );
  } catch (err) {
    if (!(err instanceof AccessError)) throw err;
    return (
      <main className="access-denied">
        <h1>کارتابل هوشمند</h1>
        <p>{err.message}</p>
        <Link href="/" className="primary-button">
          بازگشت به پرتال
        </Link>
      </main>
    );
  }
}
