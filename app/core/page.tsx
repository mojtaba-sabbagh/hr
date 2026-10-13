import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/auth";
import { requireCore } from "@/app/lib/core-service";
import { AccessError } from "@/app/lib/access-policy";
import CorePortal from "@/app/components/core-portal";

export const dynamic = "force-dynamic";
export default async function CorePage({searchParams}: {searchParams: {view?: string}}) {
  const session = await getSession();
  if (!session) redirect("/login");
  try { await requireCore(session); }
  catch (error) {
    if (!(error instanceof AccessError)) throw error;
    return <main className="access-denied"><img src="/brand/itfco-logo.webp" alt="هوشمند فناوران برتر ایرانیان" width={172}/><h1>دسترسی به هسته پرتال</h1><p>{error.message}</p><Link href="/" className="primary-button">بازگشت به پرتال</Link></main>;
  }
  return <CorePortal session={session} requestedView={searchParams.view || "dashboard"}/>;
}
