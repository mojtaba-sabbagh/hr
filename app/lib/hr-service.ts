import { prisma } from "./prisma";
import { AccessError, bodyObject, hasPermission } from "./access-policy";
import type { SessionUser } from "./session-types";
import { canAny, dateField, employeeInclude, employeeScope, requireAny, requireHr, teamEmployeeIds, tenantWhere, today } from "./hr-policy";
import { listAttendance, listEvaluations, listPeople, listShifts, myProfile, saveAttendance, saveEmployee, saveEvaluation, updateMyProfile } from "./hr-people";
import { createHrRequest, decideHrRequest, listHrRequests, listRecruitment, listTransfers, saveCandidate, saveJob, saveTransfer } from "./hr-workflows";
import { listFeedback, listRegulations, listSurveys, saveFeedback, saveRegulation, saveSurvey, submitSurvey, surveyResults } from "./hr-engagement";
import { listFeatures, listProductivity, listPromotion, myFeatures, saveFeature, saveProductivity, saveTalent } from "./hr-talent";
import { approveDecree, contractStats, fileAudit, listContractors, listContracts, listDecrees, listDocuments, notifyDecree, renewContract, saveContract, saveContractor, saveDecree, saveDocument, saveFileFacts, signDecree, terminateContract } from "./hr-contracts";
import { listHokmProfiles, listTemplates, saveHokmProfile, saveTemplate, templateBoard } from "./hr-hokm";
import { listMeetings, listMinutes, saveMeeting, saveMinute, sendMinuteForSignature, signMinute, withdrawMinute } from "./hr-meetings";
import { hrQueue } from "./hr-queue";
import { insightsFor, INSIGHT_VIEW_KEYS } from "./hr-insights";
import { fatigueFindings, sweepFatigue } from "./hr-fatigue";
import { shiftwiseStatus, syncShiftwise } from "./hr-shiftwise";
import { assignInstructors, listTraining, myTraining, planPreview, publishPlan, recordAttendance, saveCourse, saveInstructor, sweepNeeds, teamTraining } from "./hr-training";
import { askAssistant, deleteFaq, listAssistant, saveFaq } from "./hr-assistant";
import { listSafety, mySafety, saveBriefing, saveQuestion, submitDaily } from "./hr-safety";
import { aiSummary, analyzeCv, applyCv, draftDecree, draftMinute, feedbackInsight, latestInsight, surveyInsight } from "./ai/hr-ai";
import { hseSafetyFindings } from "./hse";

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
  // AI-07 — the five most serious insights in the actor's area, on the card
  // that already exists. The full board is its own view.
  let insights: Awaited<ReturnType<typeof insightsFor>>["rows"] = [];
  if (canAny(actor, INSIGHT_VIEW_KEYS)) {
    try {
      const board = await insightsFor(actor, {limit: 5});
      insights = board.rows;
      if (board.summary.risk) stats.push({label: "ریسک‌های باز در حوزهٔ شما", value: board.summary.risk, view: "insights"});
    } catch {
      // A dashboard must not fail because a secondary engine could not run;
      // the insight view will show the same error if it is real.
      insights = [];
    }
  }
  const notifications = await prisma.hrNotification.findMany({where: {recipientId: actor.id}, orderBy: {createdAt: "desc"}, take: 8});
  return {rows: [], profile: profile?.active ? profile : null, stats, notifications, insights};
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
    // «کارهای من» — the decisions waiting on the actor, for the sidebar badge
    // and the dashboard. Read-only; each row links to the screen that acts on it.
    case "queue": return hrQueue(actor);
    // AI-07 — what is about to go wrong in the area the actor owns. Computed on
    // read from the same tables the screens use; nothing is stored.
    case "insights": return insightsFor(actor);
    // AI-10 — the fatigue board, and the sweep that takes the three actions.
    case "fatigue": return fatigueFindings(actor);
    case "people": return listPeople(actor);
    case "team": return listPeople(actor, true);
    case "profile": return myProfile(actor);
    case "requests": return listHrRequests(actor, true);
    case "team-requests": return listHrRequests(actor, false);
    case "attendance": return listAttendance(actor, false);
    case "my-attendance": return listAttendance(actor, true);
    case "shifts": return {...await listShifts(actor, false), sync: await shiftwiseStatus(actor)};
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
    // Rule 15 is fed from the typed HSE incidents. The audit stays pure: HSE hands
    // in findings, it does not get read from inside the audit loop.
    case "file-audit": return fileAudit(actor, {safety: await hseSafetyFindings(actor)});
    case "contractors": return listContractors(actor);
    case "training": return listTraining(actor);
    case "my-training": return myTraining(actor);
    case "team-training": return teamTraining(actor);
    case "assistant": return listAssistant(actor);
    // آزمون ایمنی دو خواندن دارد: برگهٔ امروزِ خودِ شخص، و بانک سؤال و گزارش
    // مشارکت برای کسی که مجوز دیدن دارد. یکی‌کردنشان یعنی هر پاسخ‌دهنده مجبور
    // شود کل بانک را بگیرد.
    case "my-safety": return mySafety(actor);
    case "safety": return listSafety(actor);
    case "inbox": return {rows: await prisma.hrNotification.findMany({where: {recipientId: actor.id}, orderBy: {createdAt: "desc"}, take: 200})};
    // لایهٔ مدل: وضعیت (کلید هست یا نه، سهمیهٔ امروز) و آخرین تحلیل هر متن.
    // خواندنِ این مسیر هیچ فراخوانی‌ای به مدل نمی‌زند.
    case "ai": {
      const [status, survey, feedback] = await Promise.all([
        aiSummary(actor),
        query.get("surveyId") ? latestInsight(actor, "survey", query.get("surveyId")!) : Promise.resolve(null),
        query.get("feedbackDays") ? latestInsight(actor, "feedback", `${query.get("feedbackDays")}d`) : Promise.resolve(null),
      ]);
      return {status, survey, feedback};
    }
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
    case "shiftwise": return syncShiftwise(actor, input);
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
    // The sweep writes (ledger, notices, training need), so it is a POST on the
    // fatigue resource, not a GET that changes state.
    case "fatigue": return sweepFatigue(actor);
    // یک منبع، چند کار: دوره، مدرس، نیازسنجی، پیش‌نمایش و انتشار برنامه و ثبت
    // حضور. تفکیک با `action` است چون همه‌شان روی ردیف‌های یک زیرسامانه‌اند.
    case "training": {
      const body = bodyObject(input);
      const action = typeof body.action === "string" ? body.action : "course";
      if (action === "course") return saveCourse(actor, input, id);
      if (action === "instructor") return saveInstructor(actor, input, id);
      if (action === "instructors") {
        if (!id) throw new AccessError(400, "دوره انتخاب کنید");
        return assignInstructors(actor, id, input);
      }
      if (action === "sweep") return sweepNeeds(actor);
      if (action === "plan") return planPreview(actor, input);
      if (action === "publish") return publishPlan(actor, input);
      if (action === "attendance") {
        if (!id) throw new AccessError(400, "کلاس انتخاب کنید");
        return recordAttendance(actor, id, input);
      }
      throw new AccessError(400, "عملیات آموزش معتبر نیست");
    }
    // دستیار: «پرسش» یک نوشتن است، چون هر پرسش در گزارش ثبت می‌شود و پاسخ
    // متداول شمارندهٔ hits دارد. ویرایش پاسخ‌ها مجوز جداست.
    case "assistant": {
      const body = bodyObject(input);
      const action = typeof body.action === "string" ? body.action : "ask";
      if (action === "ask") return askAssistant(actor, input);
      if (action === "faq") return saveFaq(actor, input, id);
      if (action === "delete") {
        if (!id) throw new AccessError(400, "پاسخ متداول انتخاب کنید");
        return deleteFaq(actor, id);
      }
      throw new AccessError(400, "عملیات دستیار معتبر نیست");
    }
    // آزمون ایمنی: ثبت برگهٔ امروز، ویرایش سؤال بانک و ویرایش پیام روزانه.
    case "safety": {
      const body = bodyObject(input);
      const action = typeof body.action === "string" ? body.action : "submit";
      if (action === "submit") return submitDaily(actor, input);
      if (action === "question") return saveQuestion(actor, input, id);
      if (action === "briefing") return saveBriefing(actor, input, id);
      throw new AccessError(400, "عملیات آزمون ایمنی معتبر نیست");
    }
    // یک ردیف قرارداد سه کار دارد: ثبت/ویرایش، تمدید و خاتمه. تمدید و خاتمه فقط
    // روی ردیف موجود معنا دارند، پس با `id` و `action` تفکیک می‌شوند.
    case "contracts": {
      const body = bodyObject(input);
      if (id && body.action === "renew") return renewContract(actor, id, input);
      if (id && body.action === "terminate") return terminateContract(actor, id, input);
      return saveContract(actor, input, id);
    }
    // حکم یک زنجیره دارد: صدور (کارگزینی)، تأیید (رئیس کارگزینی)، امضا (رئیس
    // شرکت) و ابلاغ. سه مرحلهٔ آخر با `action` روی ردیف موجود انجام می‌شوند.
    case "decrees": {
      const body = bodyObject(input);
      if (id && body.action === "approve") return approveDecree(actor, id);
      if (id && body.action === "sign") return signDecree(actor, id);
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
    // یک درگاه برای همهٔ کارهای مدل، چون همه یک چیز هستند: «این داده را بخوان
    // و پیش‌نویس بده». تفکیک فقط در `action` است، نه در مجوز — هر عمل خودش
    // مجوز صفحهٔ مربوط را می‌خواهد.
    case "ai": {
      const body = bodyObject(input);
      const action = body.action;
      if (action === "cv") return analyzeCv(actor, input);
      if (action === "apply-cv") return applyCv(actor, input);
      if (action === "survey") return surveyInsight(actor, input);
      if (action === "feedback") return feedbackInsight(actor, input);
      if (action === "minute") return draftMinute(actor, input);
      if (action === "decree") return draftDecree(actor, input);
      throw new AccessError(400, "عملیات مدل مشخص نیست");
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
