import { prisma } from "./prisma";
import { AccessError, bodyObject, hasPermission } from "./access-policy";
import type { SessionUser } from "./session-types";
import { canAny, dateField, employeeInclude, employeeScope, requireAny, requireHr, teamEmployeeIds, tenantWhere, today } from "./hr-policy";
import { listAttendance, listEvaluations, listPeople, listShifts, myProfile, saveAttendance, saveEmployee, saveEvaluation, saveShift, updateMyProfile } from "./hr-people";
import { createHrRequest, decideHrRequest, listHrRequests, listRecruitment, listTransfers, saveCandidate, saveJob, saveTransfer } from "./hr-workflows";
import { listFeedback, listRegulations, listSurveys, saveFeedback, saveRegulation, saveSurvey, submitSurvey, surveyResults } from "./hr-engagement";
import { listFeatures, listProductivity, listPromotion, myFeatures, saveFeature, saveProductivity, saveTalent } from "./hr-talent";
import { contractStats, fileAudit, listContractors, listContracts, listDecrees, listDocuments, notifyDecree, renewContract, saveContract, saveContractor, saveDecree, saveDocument, saveFileFacts, terminateContract } from "./hr-contracts";
import { listHokmProfiles, listTemplates, saveHokmProfile, saveTemplate, templateBoard } from "./hr-hokm";
import { listMeetings, listMinutes, saveMeeting, saveMinute, sendMinuteForSignature, signMinute, withdrawMinute } from "./hr-meetings";

async function dashboard(actor: SessionUser) {
  const profile = await prisma.hrEmployee.findUnique({where: {userId: actor.id}, include: employeeInclude});
  const stats: {label: string; value: number; view: string}[] = [];
  if (hasPermission(actor, "hr:dashboard:view")) stats.push({label: "پرسنل فعال سازمان", value: await prisma.hrEmployee.count({where: {active: true, ...await tenantWhere(actor)}}), view: "people"});
  // کارگزینی: the count that actually needs action — contracts already expired
  // (people working without one) plus the ones inside the 60-day window.
  if (hasPermission(actor, "hr:contracts:view") || hasPermission(actor, "hr:contracts:manage")) {
    const contracts = await contractStats(actor);
    stats.push({label: "قراردادهای منقضی یا در شرف پایان", value: contracts.expiring + contracts.expired, view: "contracts"});
  }
  // Same source as the team page: the reporting chart, with the legacy manager chain as fallback.
  if (hasPermission(actor, "hr:team:team")) stats.push({label: "اعضای فعال تیم من", value: await prisma.hrEmployee.count({where: {active: true, id: {in: await teamEmployeeIds(actor)}}}), view: "team"});
  if (hasPermission(actor, "hr:requests:self")) stats.push({label: "درخواست‌های باز من", value: await prisma.hrRequest.count({where: {employee: {userId: actor.id, active: true}, status: "PENDING"}}), view: "requests"});
  if (canAny(actor, ["hr:requests:view", "hr:requests:approve", "hr:team-requests:view", "hr:team-requests:approve"])) {
    const pendingScope = await employeeScope(actor, ["hr:requests:view", "hr:requests:approve"], ["hr:team-requests:view", "hr:team-requests:approve"]);
    stats.push({label: "درخواست‌های منتظر بررسی", value: await prisma.hrRequest.count({where: {status: "PENDING", employee: {...pendingScope, userId: {not: actor.id}}}}), view: "team-requests"});
  }
  if (hasPermission(actor, "hr:recruitment:view")) stats.push({label: "موقعیت‌های شغلی باز", value: await prisma.hrJob.count({where: {status: "OPEN"}}), view: "jobs"});
  if (hasPermission(actor, "hr:performance:approve")) stats.push({label: "ارزیابی‌های منتظر انتشار", value: await prisma.hrEvaluation.count({where: {status: "SUBMITTED", authorId: {not: actor.id}}}), view: "performance"});
  if (profile?.active && hasPermission(actor, "hr:results:self")) stats.push({label: "پرسشنامه‌های در انتظار پاسخ", value: await prisma.hrSurvey.count({where: {status: "PUBLISHED", AND: [{OR: [{department: null}, {department: profile.department}]}, {OR: [{dueDate: null}, {dueDate: {gte: dateField(today(), "امروز")}}]}], responses: {none: {employeeId: profile.id}}}}), view: "my-questionnaires"});
  const notifications = await prisma.hrNotification.findMany({where: {recipientId: actor.id}, orderBy: {createdAt: "desc"}, take: 8});
  return {rows: [], profile: profile?.active ? profile : null, stats, notifications};
}
export async function getHrReport(actor: SessionUser, team: boolean, query: URLSearchParams, exporting = false) {
  requireAny(actor, [team ? exporting ? "hr:team-reports:export" : "hr:team-reports:view" : exporting ? "hr:reports:export" : "hr:reports:view"]);
  const end = dateField(query.get("to") || today(), "پایان بازه");
  const start = dateField(query.get("from") || new Date(end.getTime() - 29 * 86400000).toISOString().slice(0, 10), "شروع بازه");
  if (end < start || end.getTime() - start.getTime() > 366 * 86400000) throw new AccessError(400, "بازه گزارش باید مثبت و حداکثر یک‌ساله باشد");
  const where = team ? await employeeScope(actor, [], ["hr:team-reports:view", "hr:team-reports:export"]) : await tenantWhere(actor);
  const people = await prisma.hrEmployee.findMany({where, select: {id: true, name: true, personnelCode: true, department: true, active: true,
    attendance: {where: {workDate: {gte: start, lte: end}}, select: {workedMinutes: true, status: true}},
    requests: {where: {startDate: {lte: end}, endDate: {gte: start}}, select: {status: true, kind: true}},
  }, orderBy: {name: "asc"}});
  return {rows: people.map(({attendance, requests, ...employee}) => ({...employee, recordedDays: attendance.length, presentDays: attendance.filter(a => a.status === "PRESENT").length, absentDays: attendance.filter(a => a.status === "ABSENT").length, workedHours: Math.round(attendance.reduce((sum, a) => sum + a.workedMinutes, 0) / 60 * 100) / 100, pendingRequests: requests.filter(r => r.status === "PENDING").length, approvedRequests: requests.filter(r => r.status === "APPROVED").length})), from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10)};
}
export async function readHr(session: SessionUser | null, resource: string, query = new URLSearchParams()) {
  const actor = await requireHr(session);
  switch (resource) {
    case "dashboard": return dashboard(actor);
    case "people": return listPeople(actor);
    case "team": return listPeople(actor, true);
    case "profile": return myProfile(actor);
    case "requests": return listHrRequests(actor, true);
    case "team-requests": return listHrRequests(actor, false);
    case "attendance": return listAttendance(actor, false);
    case "my-attendance": return listAttendance(actor, true);
    case "shifts": return listShifts(actor, false);
    case "my-shifts": return listShifts(actor, true);
    case "performance": return listEvaluations(actor, false);
    case "my-performance": return listEvaluations(actor, true);
    case "jobs": return listRecruitment(actor, true);
    case "recruitment": return listRecruitment(actor);
    case "placement": return listTransfers(actor);
    case "questionnaires": return listSurveys(actor, false);
    case "my-questionnaires": return listSurveys(actor, true);
    case "survey-results": return surveyResults(actor, false);
    case "results": return surveyResults(actor, true);
    case "voice": return listFeedback(actor, true);
    case "feedback": return listFeedback(actor, false);
    case "regulations": return listRegulations(actor);
    case "features": return listFeatures(actor, query);
    case "my-features": return myFeatures(actor);
    case "promotion": return listPromotion(actor);
    case "productivity": return listProductivity(actor);
    case "reports": return getHrReport(actor, false, query);
    case "team-reports": return getHrReport(actor, true, query);
    case "contracts": return listContracts(actor, query);
    case "decrees": return listDecrees(actor, query);
    case "decree-templates": return listTemplates(actor);
    // The picker the حکم dialog opens: layouts with their item rules, and the
    // personnel the actor may issue a decree for.
    case "hokm-board": return templateBoard(actor);
    case "hokm-profiles": return listHokmProfiles(actor);
    case "meetings": return listMeetings(actor);
    case "minutes": return listMinutes(actor, query);
    case "my-minutes": return listMinutes(actor, query, true);
    case "documents": return listDocuments(actor);
    case "file-audit": return fileAudit(actor);
    case "contractors": return listContractors(actor);
    case "inbox": return {rows: await prisma.hrNotification.findMany({where: {recipientId: actor.id}, orderBy: {createdAt: "desc"}, take: 200})};
    default: throw new AccessError(404, "بخش منابع انسانی یافت نشد");
  }
}
export async function writeHr(session: SessionUser | null, resource: string, input: unknown, id?: string) {
  const actor = await requireHr(session);
  switch (resource) {
    case "people": return saveEmployee(actor, input, id);
    case "profile": return updateMyProfile(actor, input);
    case "requests": return id ? decideHrRequest(actor, id, input) : createHrRequest(actor, input);
    case "attendance": return saveAttendance(actor, input);
    case "shifts": return saveShift(actor, input);
    case "performance": return saveEvaluation(actor, input, id);
    case "jobs": return saveJob(actor, input, id);
    case "recruitment": return saveCandidate(actor, input, id);
    case "placement": return saveTransfer(actor, input, id);
    case "questionnaires": return saveSurvey(actor, input, id);
    case "survey-responses": if (!id) throw new AccessError(400, "پرسشنامه انتخاب کنید"); return submitSurvey(actor, id, input);
    case "voice": if (id) throw new AccessError(400, "پیام ارسال‌شده قابل ویرایش نیست"); return saveFeedback(actor, input);
    case "feedback": if (!id) throw new AccessError(400, "پیام انتخاب کنید"); return saveFeedback(actor, input, id);
    case "regulations": return saveRegulation(actor, input, id);
    case "features": return saveFeature(actor, input);
    case "promotion": return saveTalent(actor, input);
    case "productivity": return saveProductivity(actor, input, id);
    // یک ردیف قرارداد سه کار دارد: ثبت/ویرایش، تمدید و خاتمه. تمدید و خاتمه فقط
    // روی ردیف موجود معنا دارند، پس با `id` و `action` تفکیک می‌شوند.
    case "contracts": {
      const body = bodyObject(input);
      if (id && body.action === "renew") return renewContract(actor, id, input);
      if (id && body.action === "terminate") return terminateContract(actor, id, input);
      return saveContract(actor, input, id);
    }
    case "decrees": {
      const body = bodyObject(input);
      if (id && body.action === "notify") return notifyDecree(actor, id);
      return saveDecree(actor, input, id);
    }
    case "decree-templates": return saveTemplate(actor, input, id);
    case "hokm-profiles": if (!id) throw new AccessError(400, "پرونده پرسنلی انتخاب کنید"); return saveHokmProfile(actor, id, input);
    case "meetings": return saveMeeting(actor, input, id);
    // یک صورت‌جلسه سه کار دارد که همه روی ردیف موجود معنا دارند: نوشتن، ارسال
    // برای امضا، بازگرداندن به پیش‌نویس — و امضا که خودِ امضاکننده انجام می‌دهد.
    case "minutes": {
      const body = bodyObject(input);
      if (id && body.action === "send") return sendMinuteForSignature(actor, id);
      if (id && body.action === "withdraw") return withdrawMinute(actor, id);
      if (id && body.action === "sign") return signMinute(actor, id, input);
      return saveMinute(actor, input, id);
    }
    case "documents": return saveDocument(actor, input);
    case "contractors": return saveContractor(actor, input, id);
    case "file-facts": if (!id) throw new AccessError(400, "پرونده انتخاب کنید"); return saveFileFacts(actor, id, input);
    case "inbox": {
      const body = bodyObject(input);
      if (!id && body.all !== true) throw new AccessError(400, "اعلان انتخاب کنید");
      return prisma.hrNotification.updateMany({where: {recipientId: actor.id, readAt: null, ...(id ? {id} : {})}, data: {readAt: new Date()}});
    }
    default: throw new AccessError(404, "عملیات منابع انسانی یافت نشد");
  }
}
export async function exportHrReport(session: SessionUser | null, query: URLSearchParams) {
  const actor = await requireHr(session);
  const result = await getHrReport(actor, query.get("scope") === "team", query, true);
  const cell = (input: unknown) => {
    const text = String(input ?? "");
    return `"${(/^[=+\-@\t\r\n]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
  };
  const rows = [["کد پرسنلی", "نام", "واحد", "روز ثبت‌شده", "روز حضور", "روز غیبت", "ساعت کار ثبت‌شده", "درخواست باز", "درخواست تأییدشده"], ...result.rows.map(row => [row.personnelCode, row.name, row.department, row.recordedDays, row.presentDays, row.absentDays, row.workedHours, row.pendingRequests, row.approvedRequests])];
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n");
}
