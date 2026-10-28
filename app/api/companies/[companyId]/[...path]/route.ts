import { getSession } from "@/app/lib/auth";
import { apiResponse } from "@/app/lib/api-response";
import { AccessError, bodyObject, readJson, textField } from "@/app/lib/access-policy";
import { administrationData, companyOverview, deleteDepartment, deletePosition, designData, endAssignment, getAudit, getOrgChart, getSettings, orgData, readNotices, saveAssignment, saveDepartment, saveForm, saveMember, savePosition, saveRole, saveSettings, saveWorkflow, signedIn } from "@/app/lib/company-service";
import { instanceDetail, listInstances, processAction, submitForm } from "@/app/lib/workflow/engine";
import { installTemplate } from "@/app/lib/workflow/template-service";
export const dynamic = "force-dynamic";
type Context = {params: {companyId: string; path: string[]}};
export async function GET(request: Request, {params: {companyId, path}}: Context) {
  return apiResponse(async () => {
    const actor = signedIn(await getSession()), [resource, id, extra] = path;
    if (extra) throw new AccessError(404, "مسیر یافت نشد");
    if (resource === "instances") return id ? instanceDetail(actor, companyId, id) : listInstances(actor, companyId, new URL(request.url).searchParams);
    if (id) throw new AccessError(404, "مسیر یافت نشد");
    if (resource === "overview") return companyOverview(actor, companyId);
    if (resource === "design") return designData(actor, companyId);
    if (resource === "administration") return administrationData(actor, companyId);
    if (resource === "org") return orgData(actor, companyId);
    if (resource === "org-chart") return getOrgChart(actor, companyId, new URL(request.url).searchParams.get("departmentId") || undefined);
    if (resource === "settings") return getSettings(actor, companyId);
    if (resource === "audit") return getAudit(actor, companyId);
    throw new AccessError(404, "مسیر یافت نشد");
  });
}
export async function POST(request: Request, {params: {companyId, path}}: Context) {
  return apiResponse(async () => {
    const actor = signedIn(await getSession()), [resource, id, extra] = path;
    if (extra) throw new AccessError(404, "مسیر یافت نشد");
    const body = await readJson(request);
    if (resource === "instances") return id ? processAction(actor, companyId, id, body) : submitForm(actor, companyId, body);
    if (id) throw new AccessError(404, "مسیر یافت نشد");
    if (resource === "forms") return saveForm(actor, companyId, body);
    if (resource === "roles") return saveRole(actor, companyId, body);
    if (resource === "members") return saveMember(actor, companyId, body);
    if (resource === "departments") return saveDepartment(actor, companyId, body);
    if (resource === "positions") return savePosition(actor, companyId, body);
    if (resource === "assignments") return saveAssignment(actor, companyId, body);
    if (resource === "templates") return installTemplate(actor, companyId, textField(bodyObject(body).templateId, "الگو"));
    if (resource === "notices") return readNotices(actor, companyId);
    throw new AccessError(404, "مسیر یافت نشد");
  }, 201);
}
export async function PATCH(request: Request, {params: {companyId, path}}: Context) {
  return apiResponse(async () => {
    const actor = signedIn(await getSession()), [resource, id, extra] = path;
    if (extra) throw new AccessError(404, "مسیر یافت نشد");
    const body = await readJson(request);
    if (resource === "settings" && !id) return saveSettings(actor, companyId, body);
    if (id) {
      if (resource === "forms") return saveForm(actor, companyId, body, id);
      if (resource === "workflows") return saveWorkflow(actor, companyId, id, body);
      if (resource === "roles") return saveRole(actor, companyId, body, id);
      if (resource === "members") return saveMember(actor, companyId, body, id);
      if (resource === "departments") return saveDepartment(actor, companyId, body, id);
      if (resource === "positions") return savePosition(actor, companyId, body, id);
      if (resource === "assignments") return endAssignment(actor, companyId, id);
    }
    throw new AccessError(404, "مسیر یافت نشد");
  });
}
export async function DELETE(_request: Request, {params: {companyId, path}}: Context) {
  return apiResponse(async () => {
    const actor = signedIn(await getSession()), [resource, id, extra] = path;
    if (extra || !id) throw new AccessError(404, "مسیر یافت نشد");
    if (resource === "departments") return deleteDepartment(actor, companyId, id);
    if (resource === "positions") return deletePosition(actor, companyId, id);
    throw new AccessError(404, "مسیر یافت نشد");
  });
}
