import { getSession } from "@/app/lib/auth";
import Portal from "@/app/components/portal";
import Landing from "@/app/components/landing";
export default async function Home() {const session = await getSession(); return session ? <Portal session={session}/> : <Landing/>;}
