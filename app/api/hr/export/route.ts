export const dynamic = "force-dynamic";
import { getSession } from "@/app/lib/auth";
import { exportHrReport } from "@/app/lib/hr-service";
import { apiResponse } from "@/app/lib/api-response";
export async function GET(request: Request) {
  let csv: string | undefined;
  const error = await apiResponse(async () => {csv = await exportHrReport(await getSession(), new URL(request.url).searchParams); return {};});
  if (csv === undefined) return error;
  return new Response(csv, {headers: {"Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="hr-report.csv"', "Cache-Control": "no-store"}});
}
