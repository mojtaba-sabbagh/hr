import { Prisma } from "@prisma/client";
import type { Tx } from "../company-service";
import { date, day, demand, integer, list, shiftDay, str, uniqueRange, type Body } from "./shared";

export type WorkDay = {
  date: string;
  scheduled: number;
  regular: number;
  overtime: number;
  leave: number;
  unpaidLeave: number;
  mission: number;
  shortage: number;
  absent: boolean;
  issue: string;
  reason: string;
  evidence?: string[];
  shiftEndsAtLocal?: string;
};
const tehran = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function tehranClock(d: Date) {
  const parts = Object.fromEntries(tehran.formatToParts(d).map((period) => [period.type, period.value]));
  return {
    day: parts.year + "-" + parts.month + "-" + parts.day,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
const hhmm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export async function ingest(tx: Tx, companyId: string, source: string, input: unknown) {
  const events = list(input, 5000).map((r) => {
    const stamp = str(r.occurredAt, "زمان تردد", 45),
      occurredAt = new Date(stamp);
    demand(
      /T.*(Z|[+-]\d{2}:\d{2})$/.test(stamp) && Number.isFinite(+occurredAt),
      "زمان تردد باید دارای منطقه زمانی باشد",
    );
    const direction = str(r.direction, "جهت").toUpperCase();
    demand(["IN", "OUT", "UNKNOWN"].includes(direction), "جهت تردد نامعتبر است");
    return {
      companyId,
      source,
      externalId: str(r.id, "شناسه رویداد"),
      workerCode: str(r.workerCode, "شناسه فرد"),
      occurredAt,
      direction,
    };
  });
  // A reused immutable event identifier must not silently change the original punch.
  await tx.clockEvent.createMany({ data: events, skipDuplicates: true });
  const saved = await tx.clockEvent.findMany({
    where: { companyId, source, externalId: { in: events.map((e) => e.externalId) } },
  });
  const byId = new Map(saved.map((e) => [e.externalId, e]));
  for (const e of events) {
    const old = byId.get(e.externalId);
    demand(
      old &&
        old.workerCode === e.workerCode &&
        +old.occurredAt === +e.occurredAt &&
        old.direction === e.direction,
      "شناسهٔ تکراری با محتوای متفاوت دریافت شد",
      409,
    );
  }
}
export async function calculateWork(tx: Tx, companyId: string, id: string) {
  const period = await tx.workPeriod.findFirst({
    where: { id, companyId },
    include: {
      staff: {
        include: { employee: { select: { id: true, name: true, personnelCode: true } }, fixes: true },
      },
    },
  });
  demand(period, "دورهٔ کارکرد یافت نشد", 404);
  const ids = period.staff.map((m) => m.employeeId);
  const from = shiftDay(period.start, -2),
    to = shiftDay(period.end, 3);
  const [events, maps, shifts, manual, requests] = await Promise.all([
    tx.clockEvent.findMany({
      where: { companyId, occurredAt: { gte: from, lt: to } },
      orderBy: { occurredAt: "asc" },
    }),
    tx.clockMap.findMany({ where: { companyId } }),
    tx.hrShift.findMany({
      where: { employeeId: { in: ids }, published: true, workDate: { gte: from, lte: to } },
    }),
    tx.hrAttendance.findMany({
      where: { employeeId: { in: ids }, workDate: { gte: period.start, lte: period.end } },
    }),
    tx.hrRequest.findMany({
      where: {
        employeeId: { in: ids },
        kind: { in: ["LEAVE", "MISSION"] },
        status: "APPROVED",
        startDate: { lte: period.end },
        endDate: { gte: period.start },
      },
    }),
  ]);
  const key = (a: string, body: string) => JSON.stringify([a, body]);
  const map = new Map(maps.map((m) => [key(m.source, m.workerCode), m.employeeId]));
  const ticks = new Map<string, typeof events>(),
    unmapped = new Set<string>();
  for (const e of events) {
    const employee = map.get(key(e.source, e.workerCode));
    if (!employee) {
      const d = tehranClock(e.occurredAt).day;
      if (d >= day(period.start) && d <= day(period.end)) unmapped.add(e.source + " / " + e.workerCode);
      continue;
    }
    const group = ticks.get(employee) ?? [];
    group.push(e);
    ticks.set(employee, group);
  }
  const shiftMap = new Map(shifts.map((s) => [key(s.employeeId, day(s.workDate)), s]));
  const attendance = new Map(manual.map((a) => [key(a.employeeId, day(a.workDate)), a]));
  const summaries = period.staff.map((member) => {
    const days = new Map<string, WorkDay>();
    function work(d: string) {
      let workDay = days.get(d);
      if (!workDay) {
        workDay = {
          date: d,
          regular: 0,
          overtime: 0,
          scheduled: 0,
          leave: 0,
          unpaidLeave: 0,
          mission: 0,
          shortage: 0,
          absent: false,
          issue: "",
          reason: "",
        };
        days.set(d, workDay);
      }
      return workDay;
    }
    function workDate(instant: Date) {
      const t = tehranClock(instant),
        prev = day(shiftDay(date(t.day), -1));
      const shift = shiftMap.get(key(member.employeeId, prev));
      return shift?.endNextDay && shift.endTime && t.minutes <= hhmm(shift.endTime) ? prev : t.day;
    }
    let open: Date | null = null;
    for (const e of ticks.get(member.employeeId) ?? []) {
      const d = workDate(e.occurredAt);
      const record = work(e.direction === "OUT" && open ? workDate(open) : d);
      (record.evidence ??= []).push(
        (e.direction === "IN" ? "ورود" : e.direction === "OUT" ? "خروج" : "جهت نامشخص") +
          " · " +
          e.occurredAt.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }) +
          " · " +
          e.source +
          " / " +
          e.externalId,
      );
      if (e.direction === "IN") {
        if (open) work(workDate(open)).issue = "ورود بدون خروج";
        open = e.occurredAt;
      } else if (e.direction === "OUT" && open) {
        const target = work(workDate(open)),
          minutes = Math.round((+e.occurredAt - +open) / 60000);
        if (minutes <= 0 || minutes > 1440) target.issue = "بازهٔ ورود و خروج نامعتبر";
        else target.regular += minutes;
        open = null;
      } else work(d).issue = e.direction === "OUT" ? "خروج بدون ورود" : "جهت تردد مشخص نیست";
    }
    if (open) work(workDate(open)).issue = "ورود بدون خروج";
    const result: WorkDay[] = [];
    const fixes = new Map(member.fixes.map((f) => [day(f.date), f]));
    for (let current = period.start; current <= period.end; current = shiftDay(current, 1)) {
      const d = day(current),
        k = key(member.employeeId, d),
        s = shiftMap.get(k),
        a = attendance.get(k);
      const punched = days.has(d),
        workDay = work(d);
      if (s?.endTime)
        workDay.shiftEndsAtLocal = (s.endNextDay ? day(shiftDay(current, 1)) : d) + "T" + s.endTime;
      (workDay.evidence ??= []).unshift(
        s
          ? "شیفت منتشرشده: " +
              (s.startTime ?? "—") +
              " تا " +
              (s.endTime ?? "—") +
              (s.endNextDay ? " روز بعد" : "")
          : "برای این روز شیفت منتشرشده ثبت نشده است.",
      );
      if (a && !punched) workDay.evidence.push("کارکرد دستی ثبت‌شده: " + a.workedMinutes + " دقیقه");
      if (s?.startTime && s.endTime)
        workDay.scheduled = hhmm(s.endTime) - hhmm(s.startTime) + (s.endNextDay ? 1440 : 0);
      const grants = requests.filter(
        (r) => r.employeeId === member.employeeId && r.startDate <= current && r.endDate >= current,
      );
      if (!punched && a) {
        workDay.regular = a.workedMinutes;
        if (a.status === "LEAVE") workDay.leave = workDay.scheduled;
        if (a.status === "MISSION") workDay.mission = workDay.scheduled;
      }
      for (const type of ["LEAVE", "MISSION"]) {
        const allowed = grants
          .filter((r) => r.kind === type)
          .reduce((n, r) => n + (r.minutes ?? workDay.scheduled), 0);
        if (type === "LEAVE") workDay.leave = Math.max(workDay.leave, allowed);
        else workDay.mission = Math.max(workDay.mission, allowed);
      }
      const fix = fixes.get(d);
      if (fix) {
        Object.assign(workDay, {
          regular: fix.regular,
          overtime: fix.overtime,
          scheduled: fix.scheduled,
          leave: fix.leave,
          unpaidLeave: fix.unpaidLeave,
          mission: fix.mission,
          issue: "",
          reason: fix.reason,
        });
      } else {
        if (!s && (punched || a || grants.length)) workDay.issue ||= "شیفت روز تعیین نشده";
        if (workDay.scheduled > 0 && !punched && !a && !workDay.leave && !workDay.mission)
          workDay.issue ||= "تردد ثبت نشده؛ غیبت را بررسی کنید";
        if (workDay.scheduled < 0 || workDay.leave + workDay.mission > workDay.scheduled)
          workDay.issue ||= "ساعات شیفت یا مرخصی نیاز به بررسی دارد";
        if (workDay.leave) workDay.issue ||= "باحقوق یا بدون حقوق بودن مرخصی را تعیین کنید";
        const available = Math.max(0, workDay.scheduled - workDay.leave - workDay.mission);
        workDay.overtime =
          !punched && a?.overtimeMinutes ? a.overtimeMinutes : Math.max(0, workDay.regular - available);
        if (workDay.overtime > workDay.regular) workDay.issue ||= "اضافه‌کار ثبت‌شده از حضور بیشتر است";
        workDay.regular = Math.max(0, workDay.regular - workDay.overtime);
        if (workDay.regular > available) workDay.issue ||= "تفکیک کار عادی و اضافه‌کار نیاز به بررسی دارد";
      }
      workDay.shortage = Math.max(
        0,
        workDay.scheduled - workDay.regular - workDay.leave - workDay.unpaidLeave - workDay.mission,
      );
      workDay.absent = workDay.scheduled > 0 && workDay.shortage === workDay.scheduled && !workDay.issue;
      if (!s && !a && !punched && !fix && !grants.length)
        workDay.issue = "روز بدون برنامه؛ موظفی یا استراحت را تعیین کنید";
      if (!fix && grants.some((r) => r.minutes !== null && +r.startDate !== +r.endDate))
        workDay.issue = "مدت درخواست چندروزه باید برای این روز بررسی شود";
      result.push(workDay);
    }
    return { member, days: result };
  });
  return { period, summaries, unmapped: [...unmapped] };
}
export async function attendanceAction(tx: Tx, companyId: string, actor: string, action: string, body: Body) {
  if (action === "import") {
    const source = str(body.source, "مبدأ");
    await ingest(tx, companyId, source, body.events);
    return { id: source };
  }
  if (action === "map") {
    const employeeId = str(body.employeeId, "کارمند"),
      source = str(body.source, "مبدأ"),
      workerCode = str(body.workerCode, "شناسهٔ واسط");
    demand(
      await tx.hrEmployee.count({ where: { id: employeeId, companyId } }),
      "کارمند متعلق به این شرکت نیست",
    );
    const existing = await tx.clockMap.findUnique({
      where: { companyId_source_workerCode: { companyId, source, workerCode } },
    });
    if (existing) {
      demand(existing.employeeId === employeeId, "این شناسه قبلاً به کارمند دیگری متصل شده است", 409);
      return existing;
    }
    return tx.clockMap.create({ data: { companyId, employeeId, source, workerCode } });
  }
  if (action === "period") {
    const start = date(body.start),
      end = date(body.end);
    uniqueRange(start, end, 31);
    demand(
      !(await tx.workPeriod.count({ where: { companyId, start: { lte: end }, end: { gte: start } } })),
      "دوره هم‌پوشانی دارد",
      409,
    );
    const ids = body.employees;
    demand(
      Array.isArray(ids) && ids.length > 0 && ids.every((x) => typeof x === "string"),
      "کارمندان دوره را انتخاب کنید",
    );
    const staff = await tx.hrEmployee.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true },
    });
    demand(staff.length === ids.length, "کارمندان دوره معتبر نیستند");
    return tx.workPeriod.create({
      data: {
        companyId,
        label: str(body.label, "عنوان دوره"),
        start,
        end,
        staff: { create: staff.map((e) => ({ employeeId: e.id })) },
      },
    });
  }
  const id = str(body.id, "دوره");
  const period = await tx.workPeriod.findFirst({ where: { id, companyId }, include: { run: true } });
  demand(period, "دوره یافت نشد", 404);
  if (action === "reopen") {
    demand(period.status === "APPROVED" && !period.run, "دورهٔ دارای لیست حقوق قابل بازگشایی نیست", 409);
    const reason = str(body.reason, "دلیل بازگشایی");
    await tx.workMember.updateMany({ where: { periodId: id }, data: { snapshot: Prisma.DbNull } });
    await tx.workPeriod.update({
      where: { id },
      data: { status: "OPEN", approvedBy: null, approvedAt: null },
    });
    return { id, detail: reason };
  }
  demand(period.status === "OPEN", "دوره قطعی است", 409);
  if (action === "members") {
    const ids = body.employees;
    demand(
      Array.isArray(ids) && ids.length > 0 && ids.every((v) => typeof v === "string"),
      "کارمندان دوره را انتخاب کنید",
    );
    demand(
      (await tx.hrEmployee.count({ where: { companyId, id: { in: ids } } })) === ids.length,
      "کارمندان دوره معتبر نیستند",
    );
    const removed = { periodId: id, employeeId: { notIn: ids } };
    demand(
      !(await tx.workMember.count({ where: { ...removed, fixes: { some: {} } } })),
      "کارمند دارای اصلاح کارکرد را نمی‌توان از دوره حذف کرد",
      409,
    );
    await tx.workMember.deleteMany({ where: removed });
    await tx.workMember.createMany({
      data: ids.map((employeeId) => ({ periodId: id, employeeId })),
      skipDuplicates: true,
    });
    return { id, detail: ids.join(",") };
  }
  if (action === "fix") {
    const d = date(body.date),
      employeeId = str(body.employeeId, "کارمند");
    demand(d >= period.start && d <= period.end, "روز اصلاح خارج از دوره است");
    const member = await tx.workMember.findUnique({
      where: { periodId_employeeId: { periodId: id, employeeId } },
    });
    demand(member, "کارمند در دوره نیست");
    const data = {
      date: d,
      memberId: member.id,
      regular: integer(body.regular, "عادی", 1440),
      overtime: integer(body.overtime, "اضافه‌کار", 1440),
      scheduled: integer(body.scheduled, "موظف", 1440),
      leave: integer(body.leave, "مرخصی", 1440),
      unpaidLeave: integer(body.unpaidLeave ?? 0, "مرخصی بدون حقوق", 1440),
      mission: integer(body.mission, "مأموریت", 1440),
      reason: str(body.reason, "دلیل اصلاح"),
      actorId: actor,
    };
    demand(
      data.regular + data.leave + data.unpaidLeave + data.mission <= data.scheduled &&
        data.scheduled + data.overtime <= 1440,
      "دقایق اصلاح با ساعات موظف سازگار نیست",
    );
    const fix = await tx.workFix.upsert({
      where: { memberId_date: { memberId: member.id, date: d } },
      create: data,
      update: data,
    });
    return { id: fix.id, detail: JSON.stringify(data) };
  }
  demand(action === "approve", "عملیات نامعتبر");
  const { summaries, unmapped } = await calculateWork(tx, companyId, id);
  demand(!unmapped.length, "شناسه‌های ناشناس واسط را ابتدا تطبیق دهید", 409);
  for (const { member, days } of summaries) {
    demand(days.length && days.every((d) => !d.issue), "کارکرد " + member.employee.name + " ناقص است", 409);
    await tx.workMember.update({ where: { id: member.id }, data: { snapshot: days } });
  }
  return tx.workPeriod.update({
    where: { id },
    data: { status: "APPROVED", approvedAt: new Date(), approvedBy: actor },
  });
}
