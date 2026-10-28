// Runtime adapted from kosar-kavir/lib/workflow/{engine,resolver,notifier}.ts.
// Company scoping, immutable versions, structured conditions and serialized
// transitions replace the source app's form-entry/kardex-specific integration.
import { Prisma, type WorkflowInstance } from "@prisma/client";
import { prisma } from "../prisma";
import { AccessError, bodyObject, textField } from "../access-policy";
import { canSubmit, companyAccess, managedEntryScope, json, serial, type Tx } from "../company-service";
import { OrgHierarchyService } from "../org-chart";
import type { SessionUser } from "../session-types";
import { matches, validatePayload } from "./validation";
import type { AssigneeDef, CompanySettings, FormPayload, FormSchema, WorkflowDefConfig, WorkflowNode } from "./types";
import { hasEntryOversight } from "./types";

const nodeById = (config: WorkflowDefConfig, id: string) => {const n = config.nodes.find(n => n.id === id); if (!n) throw new AccessError(409, "مرحله گردش‌کار یافت نشد"); return n;};
function nextNode(node: WorkflowNode, payload: FormPayload, params: Record<string, number>): string {
  const transition = node.transitions.find(t => !t.condition || matches(t.condition, payload, params));
  if (!transition) throw new AccessError(409, "مسیر بعدی برای این درخواست تعریف نشده است");
  return transition.to;
}
async function resolveAssignees(tx: Tx, defs: AssigneeDef[], instance: WorkflowInstance, nodeId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const def of defs) {
    if (def.strategy === "submitter") ids.add(instance.submittedBy);
    if (def.strategy === "user" && def.userId) ids.add(def.userId);
    if (def.strategy === "role" && def.roleId) {
      const members = await tx.companyMember.findMany({where: {companyId: instance.companyId, active: true, roles: {some: {roleId: def.roleId, role: {companyId: instance.companyId}}}}, select: {userId: true}});
      members.forEach(m => ids.add(m.userId));
    }
    if (def.strategy === "manager") {
      // Reporting line first: the holder of the parent position. Companies that
      // have not built a chart yet keep the legacy member-to-member pointer.
      const hierarchy = new OrgHierarchyService(tx);
      const direct = await hierarchy.getDirectManager(instance.companyId, instance.submittedBy);
      if (direct) ids.add(direct.userId);
      else {
        const submitter = await tx.companyMember.findUnique({where: {companyId_userId: {companyId: instance.companyId, userId: instance.submittedBy}}});
        if (submitter?.managerId) {
          const manager = await tx.companyMember.findFirst({where: {id: submitter.managerId, companyId: instance.companyId, active: true}, select: {userId: true}});
          if (manager) ids.add(manager.userId);
        }
      }
    }
    if (def.strategy === "prev_actor") {
      // A return to a stage selects its previous completing actor first.
      const sameNode = await tx.workflowAction.findFirst({where: {instanceId: instance.id, nodeId, action: {in: ["approve", "forward"]}}, orderBy: {createdAt: "desc"}});
      const previous = sameNode ?? await tx.workflowAction.findFirst({where: {instanceId: instance.id, action: {in: ["approve", "forward"]}}, orderBy: {createdAt: "desc"}});
      if (previous) ids.add(previous.actorId);
    }
  }
  const active = await tx.companyMember.findMany({where: {companyId: instance.companyId, active: true, userId: {in: [...ids]}, user: {active: true}}, select: {userId: true}, orderBy: {createdAt: "asc"}});
  const result = active.map(m => m.userId);
  // The installation administrator is a real session, but not a database user.
  if (ids.has("env-super-admin") && instance.submittedBy === "env-super-admin") result.push("env-super-admin");
  return result;
}
async function notify(tx: Tx, instance: WorkflowInstance, recipients: string[], title: string, body: string) {
  if (recipients.length) await tx.workflowNotice.createMany({data: [...new Set(recipients)].map(recipientId => ({companyId: instance.companyId, instanceId: instance.id, recipientId, title, body}))});
}
async function event(tx: Tx, instance: WorkflowInstance, node: WorkflowNode, actor: Pick<SessionUser, "id" | "name">, action: string, comment = "") {
  await tx.workflowAction.create({data: {instanceId: instance.id, nodeId: node.id, nodeLabel: node.labelFa, actorId: actor.id, actorName: actor.name, action, comment}});
}
function dueAt(instance: WorkflowInstance, node: WorkflowNode): Date {
  const params = (instance.parameters as unknown as CompanySettings).parameters;
  const hours = node.slaParameter ? params[node.slaParameter] : node.slaHours ?? 24;
  const multiplier = instance.priority === "urgent" ? params.urgent_factor : instance.priority === "important" ? params.important_factor : 1;
  if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(multiplier) || multiplier <= 0) throw new AccessError(409, "مهلت مرحله معتبر نیست");
  return new Date(Date.now() + hours * multiplier * 3600000);
}
async function activate(tx: Tx, instance: WorkflowInstance, config: WorkflowDefConfig, id: string): Promise<void> {
  let current = id;
  for (let depth = 0; depth < 100; depth++) {
    const node = nodeById(config, current);
    if (node.type === "end") {
      await tx.workflowInstance.update({where: {id: instance.id}, data: {status: node.outcome ?? "completed", currentNodeId: node.id, completedAt: new Date(), returnNodeId: null}});
      await event(tx, instance, node, {id: "system", name: "سامانه"}, "complete");
      await notify(tx, instance, [instance.submittedBy], node.outcome === "rejected" ? "درخواست رد شد" : "درخواست تکمیل شد", instance.title);
      return;
    }
    if (["start", "condition", "notification"].includes(node.type)) {
      if (node.type === "notification") {
        const recipients = await resolveAssignees(tx, node.assignees || [], instance, node.id);
        if (!recipients.length) throw new AccessError(409, `برای «${node.labelFa}» گیرنده فعال تعریف نشده است`);
        await notify(tx, instance, recipients, node.labelFa, node.notificationTemplate || instance.title);
      }
      await event(tx, instance, node, {id: "system", name: "سامانه"}, node.type);
      current = nextNode(node, instance.payload as FormPayload, (instance.parameters as unknown as CompanySettings).parameters);
      continue;
    }
    let users = await resolveAssignees(tx, node.assignees || [], instance, node.id);
    if (["approval", "parallel"].includes(node.type)) users = users.filter(id => id !== instance.submittedBy);
    if (node.singleAssignee) users = users.slice(0, 1);
    if (!users.length) throw new AccessError(409, `مسئول فعال و مجاز برای «${node.labelFa}» یافت نشد؛ نقش یا مدیر مستقیم را تنظیم کنید`);
    if (node.type === "parallel" && (node.parallelQuorum ?? users.length) > users.length) throw new AccessError(409, "تعداد تأییدکنندگان فعال کمتر از حد نصاب است");
    const round = instance.round + 1;
    await tx.workflowInstance.update({where: {id: instance.id}, data: {currentNodeId: node.id, round, status: "running", returnNodeId: null}});
    await tx.workflowTask.createMany({data: users.map(assignedTo => ({instanceId: instance.id, nodeId: node.id, label: node.labelFa, assignedTo, round, dueAt: dueAt(instance, node)}))});
    await notify(tx, instance, users, "درخواست جدید در کارتابل", `${instance.title} — ${node.labelFa}`);
    return;
  }
  throw new AccessError(409, "تعداد مراحل خودکار از حد مجاز گذشت");
}
export async function submitForm(actor: SessionUser, companyId: string, value: unknown) {
  const body = bodyObject(value), formId = textField(body.formId, "فرم"), title = textField(body.title, "عنوان درخواست", 200);
  const priority = body.priority ?? "normal";
  if (!["normal", "important", "urgent"].includes(String(priority))) throw new AccessError(400, "اولویت معتبر نیست");
  return serial(async tx => {
    const access = await companyAccess(actor, companyId, undefined, tx);
    if (!access.company.active) throw new AccessError(403, "شرکت غیرفعال است");
    const form = await tx.builderForm.findFirst({where: {id: formId, companyId, archived: false}, include: {workflow: true}});
    if (!form?.workflow?.publishedVersion) throw new AccessError(404, "فرم منتشرشده یافت نشد");
    if (!canSubmit(access.roleIds, form.submitRoleIds, actor.role === "SUPER_ADMIN")) throw new AccessError(403, "اجازه ثبت این فرم را ندارید");
    const version = await tx.workflowVersion.findUniqueOrThrow({where: {workflowId_version: {workflowId: form.workflow.id, version: form.workflow.publishedVersion}}});
    if (body.versionId !== version.id) throw new AccessError(409, "نسخه فرم تغییر کرده است؛ فرم را دوباره باز کنید");
    const payload = validatePayload(version.formSchema as unknown as FormSchema, body.payload);
    const instance = await tx.workflowInstance.create({data: {companyId, versionId: version.id, title, category: form.category, submittedBy: actor.id, submitterName: actor.name, payload: json(payload), parameters: access.company.settings as Prisma.InputJsonValue, priority: String(priority)}});
    const config = version.config as unknown as WorkflowDefConfig;
    await event(tx, instance, nodeById(config, config.startNodeId), actor, "submit");
    await activate(tx, instance, config, config.startNodeId);
    return {id: instance.id, number: instance.number};
  });
}
export async function processAction(actor: SessionUser, companyId: string, id: string, value: unknown) {
  const body = bodyObject(value), action = textField(body.action, "اقدام"), comment = body.comment ? textField(body.comment, "توضیح", 3000) : "";
  if (!["approve", "forward", "return", "request_info", "resubmit", "save", "reject", "cancel", "reassign"].includes(action)) throw new AccessError(400, "اقدام معتبر نیست");
  if (["return", "request_info", "reject", "reassign"].includes(action) && !comment) throw new AccessError(400, "دلیل اقدام را وارد کنید");
  return serial(async tx => {
    await companyAccess(actor, companyId, action === "reassign" ? "workflows:manage" : undefined, tx);
    if (action === "reassign") await companyAccess(actor, companyId, "entries:view", tx);
    const instance = await tx.workflowInstance.findFirst({where: {id, companyId}, include: {version: true}});
    if (!instance) throw new AccessError(404, "درخواست یافت نشد");
    if (!["running", "returned"].includes(instance.status)) throw new AccessError(409, "درخواست بسته شده است");
    if (body.revision !== instance.revision) throw new AccessError(409, "درخواست تغییر کرده است؛ آخرین وضعیت را بارگذاری کنید");
    const config = instance.version.config as unknown as WorkflowDefConfig, schema = instance.version.formSchema as unknown as FormSchema;
    const node = nodeById(config, instance.currentNodeId!);
    const task = await tx.workflowTask.findFirst({where: {instanceId: id, round: instance.round, assignedTo: actor.id, status: "pending"}});
    if (action === "cancel") {if (actor.id !== instance.submittedBy) throw new AccessError(403, "فقط ثبت‌کننده می‌تواند درخواست را لغو کند");}
    else if (action !== "reassign" && !task) throw new AccessError(403, "این مرحله در کارتابل شما نیست");
    if (node.requireComment && action !== "save" && action !== "cancel" && !comment) throw new AccessError(400, "ثبت توضیح در این مرحله الزامی است");
    const changed = await tx.workflowInstance.updateMany({where: {id, companyId, revision: instance.revision}, data: {revision: {increment: 1}}});
    if (!changed.count) throw new AccessError(409, "اقدام همزمان ثبت شده است؛ وضعیت را تازه کنید");
    if (action === "reassign") {
      if (instance.status !== "running") throw new AccessError(400, "وظیفه اصلاح فقط به ثبت‌کننده تعلق دارد");
      const taskId = textField(body.taskId, "وظیفه"), userId = textField(body.userId, "مسئول جدید");
      const pending = await tx.workflowTask.findFirst({where: {id: taskId, instanceId: id, round: instance.round, status: "pending"}});
      const member = await tx.companyMember.findFirst({where: {companyId, userId, active: true, user: {active: true}}, include: {user: {select: {name: true}}}});
      if (!pending || !member) throw new AccessError(400, "وظیفه یا مسئول فعال در این شرکت یافت نشد");
      if (["approval", "parallel"].includes(node.type) && userId === instance.submittedBy) throw new AccessError(400, "درخواست‌کننده نمی‌تواند مسئول تأیید خودش شود");
      if (await tx.workflowTask.findUnique({where: {instanceId_round_assignedTo: {instanceId: id, round: instance.round, assignedTo: userId}}})) throw new AccessError(400, "این کاربر قبلاً در همین مرحله وظیفه دارد");
      await tx.workflowTask.update({where: {id: taskId}, data: {status: "skipped", completedAt: new Date()}});
      await tx.workflowTask.create({data: {instanceId: id, nodeId: node.id, label: node.labelFa, round: instance.round, assignedTo: userId, dueAt: pending.dueAt}});
      await event(tx, instance, node, actor, action, `${pending.assignedTo} → ${member.user.name}: ${comment}`);
      await notify(tx, instance, [userId], "وظیفه به شما واگذار شد", `${instance.title} — ${comment}`);
      return {id};
    }
    if (action === "cancel" || action === "reject") {
      if (action === "reject" && instance.status !== "running") throw new AccessError(400, "درخواست در انتظار اصلاح است");
      await tx.workflowTask.updateMany({where: {instanceId: id, status: "pending"}, data: {status: "cancelled", completedAt: new Date()}});
      await tx.workflowInstance.update({where: {id}, data: {status: action === "cancel" ? "cancelled" : "rejected", completedAt: new Date(), returnNodeId: null}});
      await event(tx, instance, node, actor, action, comment);
      await notify(tx, instance, [instance.submittedBy], action === "cancel" ? "درخواست لغو شد" : "درخواست رد شد", `${instance.title} — ${comment}`);
      return {id};
    }
    if (instance.status === "returned") {
      if (action !== "resubmit" || actor.id !== instance.submittedBy || !instance.returnNodeId) throw new AccessError(400, "درخواست باید توسط ثبت‌کننده اصلاح و ارسال شود");
      const patch = validatePayload(schema, body.payload, "", false, instance.payload as FormPayload);
      instance.payload = json({...instance.payload as FormPayload, ...patch}) as Prisma.JsonObject;
      await tx.workflowInstance.update({where: {id}, data: {payload: instance.payload}});
      await tx.workflowTask.updateMany({where: {instanceId: id, status: "pending"}, data: {status: "done", completedAt: new Date()}});
      await event(tx, instance, node, actor, action, comment);
      await activate(tx, instance, config, instance.returnNodeId);
      return {id};
    }
    if (action === "return" || action === "request_info") {
      await tx.workflowTask.updateMany({where: {instanceId: id, status: "pending"}, data: {status: "skipped", completedAt: new Date()}});
      const round = instance.round + 1;
      await tx.workflowInstance.update({where: {id}, data: {status: "returned", returnNodeId: node.id, round}});
      await tx.workflowTask.create({data: {instanceId: id, nodeId: node.id, label: "اصلاح و ارسال مجدد", round, assignedTo: instance.submittedBy, dueAt: dueAt(instance, node)}});
      await event(tx, instance, node, actor, action, comment);
      await notify(tx, instance, [instance.submittedBy], "درخواست نیازمند اصلاح است", `${instance.title} — ${comment}`);
      return {id};
    }
    if (node.type === "form_stage") {
      if (!["forward", "save"].includes(action)) throw new AccessError(400, "این مرحله باید تکمیل و ارجاع شود");
      const patch = validatePayload(schema, body.payload, node.fillSectionKey, action === "save", instance.payload as FormPayload);
      instance.payload = json({...instance.payload as FormPayload, ...patch}) as Prisma.JsonObject;
      await tx.workflowInstance.update({where: {id}, data: {payload: instance.payload}});
      if (action === "save") {await event(tx, instance, node, actor, action, comment); return {id};}
    } else if (action !== "approve" || !["approval", "parallel"].includes(node.type)) throw new AccessError(400, "اقدام با نوع مرحله سازگار نیست");
    if (["approval", "parallel"].includes(node.type) && actor.id === instance.submittedBy) throw new AccessError(403, "تأیید درخواست خودتان مجاز نیست");
    await tx.workflowTask.update({where: {id: task!.id}, data: {status: "done", completedAt: new Date()}});
    await event(tx, instance, node, actor, action, comment);
    if (node.type === "parallel") {
      const tasks = await tx.workflowTask.findMany({where: {instanceId: id, round: instance.round}});
      if (tasks.filter(t => t.status === "done").length < (node.parallelQuorum ?? tasks.filter(t => t.status !== "skipped").length)) return {id};
    }
    await tx.workflowTask.updateMany({where: {instanceId: id, round: instance.round, status: "pending"}, data: {status: "skipped", completedAt: new Date()}});
    await activate(tx, instance, config, nextNode(node, instance.payload as FormPayload, (instance.parameters as unknown as CompanySettings).parameters));
    return {id};
  });
}
export async function listInstances(actor: SessionUser, companyId: string, params: URLSearchParams) {
  const access = await companyAccess(actor, companyId);
  const mode = params.get("mode") || "mine", page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  const where: Prisma.WorkflowInstanceWhereInput = {companyId};
  if (mode === "inbox") where.tasks = {some: {assignedTo: actor.id, status: "pending"}};
  else if (mode === "all") {
    if (!hasEntryOversight(access.permissions)) throw new AccessError(403, "مجوز مشاهده درخواست‌های سازمانی را ندارید");
    // Keep the permission constraint in AND so a category filter cannot replace it.
    where.AND = [await managedEntryScope(companyId, access)];
  }
  else where.submittedBy = actor.id;
  if (params.get("category")) where.category = params.get("category")!;
  if (params.get("status")) where.status = params.get("status")!;
  if (params.get("q")) where.title = {contains: params.get("q")!.slice(0, 200), mode: "insensitive"};
  const [total, rows] = await Promise.all([
    prisma.workflowInstance.count({where}),
    prisma.workflowInstance.findMany({where, orderBy: {updatedAt: "desc"}, skip: (page - 1) * 25, take: 25, select: {id: true, number: true, title: true, submitterName: true, status: true, priority: true, createdAt: true, category: true, tasks: {where: {status: "pending"}, select: {label: true, dueAt: true}, take: 1, orderBy: {dueAt: "asc"}}}}),
  ]);
  return {rows, total, page, pages: Math.max(1, Math.ceil(total / 25))};
}
export async function instanceDetail(actor: SessionUser, companyId: string, id: string) {
  const access = await companyAccess(actor, companyId);
  const instance = await prisma.workflowInstance.findFirst({where: {id, companyId}, include: {version: true, tasks: {orderBy: {createdAt: "asc"}}, actions: {orderBy: [{createdAt: "asc"}, {id: "asc"}]}}});
  if (!instance) throw new AccessError(404, "درخواست یافت نشد");
  if (instance.submittedBy !== actor.id && !instance.tasks.some(t => t.assignedTo === actor.id)) {
    const allowed = hasEntryOversight(access.permissions) && await prisma.workflowInstance.count({where: {id, companyId, AND: [await managedEntryScope(companyId, access)]}});
    if (!allowed) throw new AccessError(404, "درخواست یافت نشد");
  }
  const ids = [...new Set(instance.tasks.map(t => t.assignedTo))];
  const members = await prisma.companyMember.findMany({where: {companyId, userId: {in: ids}}, select: {user: {select: {id: true, name: true}}}});
  const config = instance.version.config as unknown as WorkflowDefConfig, node = config.nodes.find(n => n.id === instance.currentNodeId);
  const assigned = instance.tasks.some(t => t.round === instance.round && t.assignedTo === actor.id && t.status === "pending");
  const actions: string[] = [];
  if (assigned && instance.status === "returned" && instance.submittedBy === actor.id) actions.push("resubmit");
  if (assigned && instance.status === "running") actions.push(...(node?.type === "form_stage" ? ["forward", "save"] : ["approve"]), "return", "request_info", "reject");
  if (["running", "returned"].includes(instance.status) && instance.submittedBy === actor.id) actions.push("cancel");
  const assigneeOptions = access.permissions.includes("workflows:manage") && access.permissions.includes("entries:view") && instance.status === "running" ? (await prisma.companyMember.findMany({where: {companyId, active: true, user: {active: true}}, select: {user: {select: {id: true, name: true}}}})).map(m => m.user) : [];
  return {...instance, assigneeOptions, tasks: instance.tasks.map(t => ({...t, assigneeName: members.find(m => m.user.id === t.assignedTo)?.user.name || (t.assignedTo === "env-super-admin" ? "ابرادمین" : "عضو پیشین")})), availableActions: actions, editableSection: assigned ? instance.status === "returned" ? "" : node?.type === "form_stage" ? node.fillSectionKey : null : null};
}
