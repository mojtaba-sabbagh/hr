import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { AccessError } from "../lib/access-policy";
import { companyAccess, listCompanies } from "../lib/company-service";
import { requireModule } from "../lib/operations/common";
import { isOperationModule } from "../lib/operations/rules";
import { financeBoard } from "../lib/operations/finance-view";
import { procurementBoard } from "../lib/operations/procurement-view";
import { warehouseBoard } from "../lib/operations/warehouse-view";
import { maintenanceBoard } from "../lib/operations/maintenance-view";
import { View } from "../lib/operations/views";
import OperationsPortal from "../components/operations-portal";
import EmployeeAssets from "../components/employee-assets";
import { employeeAssetBoard } from "../lib/operations/employee-assets";
import { officeBoard } from "../lib/office/board";
import { isOffice, modules } from "../lib/office/shared";
import OfficePortal from "../components/office-portal";

export const dynamic = "force-dynamic";
export default async function OperationPage({
  params,
  searchParams,
}: {
  params: { module: string };
  searchParams: { company?: string; period?: string; section?:string; record?:string; q?:string };
}) {
  const mod = params.module;
  if (!isOperationModule(mod) && !isOffice(mod)) notFound();
  const actor = await getSession();
  if (!actor) redirect("/login");
  try {
    const companies = (await listCompanies(actor)).filter((c) => c.active);
    const companyId = searchParams.company ?? companies[0]?.id ?? "";
    if (companyId && !companies.some((c) => c.id === companyId)) throw new AccessError(403, "دسترسی به این شرکت ندارید");
    if (isOffice(mod)) {
      const company=companies.find(c=>c.id===companyId);
      const board=await officeBoard(actor,mod,company,searchParams.period||"");
      return <OfficePortal key={JSON.stringify([mod,companyId,board?.selected,searchParams.section,searchParams.record,searchParams.q])} actor={actor} module={mod} title={modules[mod]} companies={companies} companyId={companyId} board={board} initialSection={searchParams.section} initialRecord={searchParams.record} initialQuery={searchParams.q}/>;
    }
    if (mod === "assets") {
      const board = await employeeAssetBoard(prisma, actor, companyId);
      return <EmployeeAssets key={companyId+(searchParams.record||"")} session={actor} companies={companies} companyId={companyId} board={board} record={searchParams.record}/>;
    }
    await requireModule(prisma, actor, mod);
    const view = new View(actor, mod);
    if (companyId) {
      await companyAccess(actor, companyId);
      await {
        finance: financeBoard,
        warehouse: warehouseBoard,
        maintenance: maintenanceBoard,
        procurement: procurementBoard,
      }[mod](prisma, companyId, view);
    }
    return (
      <OperationsPortal
        key={mod + companyId}
        session={actor}
        mod={mod}
        companies={companies}
        companyId={companyId}
        board={view.board}
      />
    );
  } catch (e) {
    if (!(e instanceof AccessError)) throw e;
    return (
      <main className="access-denied">
        <h1>دسترسی به زیرسیستم</h1>
        <p>{e.message}</p>
        <Link href="/" className="primary-button">
          بازگشت به پرتال
        </Link>
      </main>
    );
  }
}
