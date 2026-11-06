import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/auth";
import CompanyWorkspace from "@/app/components/workflow/workspace";
// The builder workspace that used to be /hse. The typed hazard/incident/CAPA
// screens took the landing page; every other HSE resource still submits a form
// through here, so the entry point stays one link away.
export const dynamic = "force-dynamic";
export default async function HseFormsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <CompanyWorkspace session={session} initialCategory="hse"/>;
}
