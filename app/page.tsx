import { redirect } from "next/navigation"; import { getSession } from "@/app/lib/auth"; import Portal from "@/app/components/portal";
export default async function Home(){const session=await getSession();if(!session)redirect("/login");return <Portal session={session}/>}
