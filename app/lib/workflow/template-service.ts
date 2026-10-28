import type { SessionUser } from "../session-types";
import { AccessError } from "../access-policy";
import { audit, companyAccess, json, serial } from "../company-service";
import { PROCESS_TEMPLATES, templateConfig } from "./templates";
import { validateSchema, validateWorkflow } from "./validation";
import { PROTOTYPE_WORKFLOW_ROLE_ALIASES } from "../prototype-policy";

export async function installTemplate(actor: SessionUser, companyId: string, templateId: string) {
  const template = PROCESS_TEMPLATES.find(t => t.id === templateId);
  if (!template) throw new AccessError(404, "الگوی فرایند یافت نشد");
  return serial(async tx => {
    await companyAccess(actor, companyId, "forms:manage", tx);
    await companyAccess(actor, companyId, "workflows:manage", tx);
    // Templates introduce business roles, so role-administration permission is required.
    await companyAccess(actor, companyId, "members:manage", tx);
    const code = `TPL-${template.id.toUpperCase()}`;
    if (await tx.builderForm.findUnique({where: {companyId_code: {companyId, code}}})) throw new AccessError(409, "این الگو قبلاً به شرکت اضافه شده است");
    const roles: Record<string, string> = {};
    for (const name of [...new Set(template.steps.map(s => s.role))]) {
      const canonical = PROTOTYPE_WORKFLOW_ROLE_ALIASES[name];
      const existing = canonical ? await tx.companyRole.findUnique({where: {companyId_name: {companyId, name: canonical}}}) : null;
      const role = existing || await tx.companyRole.upsert({where: {companyId_name: {companyId, name}}, create: {companyId, name, permissions: []}, update: {}});
      roles[name] = role.id;
    }
    const schema = validateSchema({fields: template.fields, sections: template.sections ?? []});
    const config = validateWorkflow(templateConfig(template, roles), schema, true);
    const form = await tx.builderForm.create({data: {companyId, code, title: template.title, description: template.description, category: template.category, schema: json(schema), submitRoleIds: [], workflow: {create: {companyId, name: template.title, config: json(config)}}}});
    await audit(tx, actor, companyId, "template.install", form.id, `${template.title} — ${template.source}`);
    return {id: form.id};
  });
}
