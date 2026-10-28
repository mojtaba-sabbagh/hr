import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/auth";
import { requireHr } from "@/app/lib/hr-policy";
import { AccessError } from "@/app/lib/access-policy";
import HrPortal from "@/app/components/hr-portal";

export const dynamic = "force-dynamic";
export default async function HrPage({searchParams}: {searchParams: {view?: string}}) {
  const session = await getSession();
  if (!session) redirect("/login");
  try { await requireHr(session); }
  catch (error) {
    if (!(error instanceof AccessError)) throw error;
    return <main className="access-denied"><img src="/brand/itfco-logo.webp" alt="هوشمند فناوران برتر ایرانیان" width={172}/><h1>دسترسی به منابع انسانی</h1><p>{error.message}</p><Link href="/" className="primary-button">بازگشت به پرتال</Link></main>;
  }
  return <HrPortal session={session} requestedView={searchParams.view || "dashboard"}/>;
}
