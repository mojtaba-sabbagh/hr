import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/auth";
import CompanyWorkspace from "@/app/components/workflow/workspace";
export default async function HsePage() {const session = await getSession(); if (!session) redirect("/login"); return <CompanyWorkspace session={session} initialCategory="hse"/>;}
