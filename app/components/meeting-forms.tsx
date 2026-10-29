"use client";
// Two dialogs for the meeting module, for the same reason as the حکم dialogs:
// their bodies are lists whose length the secretary decides — seats on a
// meeting, attendees and مصوبات on a minute — which a fixed field spec cannot
// hold.
//
// `MinuteDialog` also carries the one piece of behaviour that is easy to get
// wrong: a new minute starts with the meeting's own seats already ticked as
// present, because a meeting's minute is normally the meeting's people. The
// secretary untick anyone who did not come.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, Plus, Trash2 } from "lucide-react";

type Employee = {id: string; name: string; personnelCode?: string; department?: string};
export type MeetingSeat = {employeeId: string; role: string; employee?: Employee | null};
export type MeetingListItem = {id: string; name: string; period: string; members: MeetingSeat[]};
export type ResolutionInput = {itemNo: string; text: string; result: boolean; ownerId: string; dueDate: string};
export type AttendeeInput = {employeeId: string; present: boolean};

const ROLES: Record<string, string> = {MEMBER: "عضو", SECRETARY: "دبیر"};
const todayISO = () => new Date().toISOString().slice(0, 10);

function Shell({title, eyebrow, busy, error, close, children, submitLabel, onSubmit}: {title: string; eyebrow: string; busy: boolean; error: string; close: () => void; children: React.ReactNode; submitLabel: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {dialog.current?.showModal();}, []);
  return <dialog ref={dialog} className="core-dialog" aria-labelledby="meeting-dialog-title" onCancel={event => {event.preventDefault(); if (!busy) close();}}>
    <div className="dialog-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id="meeting-dialog-title">{title}</h2></div><button type="button" className="icon-button" onClick={close} disabled={busy} aria-label="بستن پنجره"><X size={20}/></button></div>
    <form onSubmit={onSubmit} className="dialog-body form-stack">
      {children}
      {error && <div role="alert" className="feedback error">{error}</div>}
      <div className="dialog-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "در حال ثبت…" : submitLabel}</button><button type="button" className="secondary-button" onClick={close} disabled={busy}>انصراف</button></div>
    </form>
  </dialog>;
}

/** جلسه: a named body with seats, one of which may be the secretary. */
export function MeetingDialog({meeting, employees, busy, error, close, onSubmit}: {meeting?: Record<string, any> | null; employees: Employee[]; busy: boolean; error: string; close: () => void; onSubmit: (body: Record<string, unknown>) => void}) {
  const [seats, setSeats] = useState<MeetingSeat[]>(() => (meeting?.members ?? []).map((seat: MeetingSeat) => ({employeeId: seat.employeeId, role: seat.role})));
  const update = (index: number, patch: Partial<MeetingSeat>) => setSeats(current => current.map((seat, at) => (at === index ? {...seat, ...patch} : seat)));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({name: form.get("name"), period: form.get("period"), active: form.get("active") === "on", seats: seats.filter(seat => seat.employeeId)});
  }

  return <Shell title={meeting ? `ویرایش ${meeting.name}` : "جلسهٔ جدید"} eyebrow="جلسات" busy={busy} error={error} close={close} submitLabel="ذخیرهٔ جلسه" onSubmit={submit}>
    <div className="form-columns">
      <label>نام جلسه<input name="name" required defaultValue={meeting?.name ?? ""} maxLength={160}/></label>
      <label>دوره<input name="period" defaultValue={meeting?.period ?? ""} maxLength={120}/></label>
    </div>
    <label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={meeting ? meeting.active !== false : true}/>جلسهٔ فعال</label>
    <section>
      <div className="section-heading"><h2>اعضای جلسه</h2><button type="button" className="secondary-button" onClick={() => setSeats(current => [...current, {employeeId: "", role: "MEMBER"}])}><Plus size={16}/>عضو جدید</button></div>
      {!seats.length && <p className="form-hint">هنوز عضوی ندارد. اعضای جلسه کسانی هستند که به‌طور معمول در آن حاضرند.</p>}
      <div className="template-rules">
        {seats.map((seat, index) => <div className="template-rule seat-rule" key={index}>
          <span className="hokm-letter">{index + 1}</span>
          <select aria-label="عضو" value={seat.employeeId} onChange={event => update(index, {employeeId: event.target.value})}>
            <option value="">انتخاب عضو…</option>
            {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.personnelCode ? ` — ${employee.personnelCode}` : ""}</option>)}
          </select>
          <select aria-label="نقش" value={seat.role} onChange={event => update(index, {role: event.target.value})}>{Object.entries(ROLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <button type="button" className="icon-button" onClick={() => setSeats(current => current.filter((_, at) => at !== index))} aria-label="حذف عضو"><Trash2 size={16}/></button>
        </div>)}
      </div>
    </section>
  </Shell>;
}

const blankResolution = (index: number): ResolutionInput => ({itemNo: String(index + 1), text: "", result: true, ownerId: "", dueDate: ""});

/**
 * صورت‌جلسه. Header, the people in the room, and the مصوبات.
 *
 * Editing is only offered while the minute is a DRAFT; the caller hides the
 * button otherwise, and the service refuses the write anyway.
 */
export function MinuteDialog({minute, meetings, employees, busy, error, close, onSubmit}: {minute?: Record<string, any> | null; meetings: MeetingListItem[]; employees: Employee[]; busy: boolean; error: string; close: () => void; onSubmit: (body: Record<string, unknown>) => void}) {
  const editing = Boolean(minute);
  const [meetingId, setMeetingId] = useState(minute?.meetingId ?? meetings[0]?.id ?? "");
  const [attendees, setAttendees] = useState<AttendeeInput[]>(() =>
    minute ? (minute.attendees ?? []).map((row: Record<string, any>) => ({employeeId: row.employeeId, present: row.present !== false}))
      : (meetings[0]?.members ?? []).map(seat => ({employeeId: seat.employeeId, present: true})));
  const [resolutions, setResolutions] = useState<ResolutionInput[]>(() =>
    minute ? (minute.resolutions ?? []).map((row: Record<string, any>) => ({itemNo: row.itemNo, text: row.text, result: row.result !== false, ownerId: row.ownerId ?? "", dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : ""})) : [blankResolution(0)]);

  // Picking another meeting for a *new* minute re-seats the room from it.
  function pickMeeting(id: string) {
    setMeetingId(id);
    if (editing) return;
    const meeting = meetings.find(item => item.id === id);
    setAttendees((meeting?.members ?? []).map(seat => ({employeeId: seat.employeeId, present: true})));
  }
  const toggle = (employeeId: string, present: boolean) => setAttendees(current => (current.some(row => row.employeeId === employeeId) ? current.map(row => (row.employeeId === employeeId ? {...row, present} : row)) : [...current, {employeeId, present}]));
  const updateResolution = (index: number, patch: Partial<ResolutionInput>) => setResolutions(current => current.map((row, at) => (at === index ? {...row, ...patch} : row)));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      meetingId, number: form.get("number"), date: form.get("date"), time: form.get("time"),
      location: form.get("location"), summary: form.get("summary"),
      attendees: attendees.filter(row => row.employeeId),
      resolutions: resolutions.filter(row => row.text.trim()).map((row, index) => ({...row, itemNo: row.itemNo || String(index + 1), dueDate: row.dueDate || undefined, ownerId: row.ownerId || undefined})),
    });
  }

  const nameOf = (id: string) => employees.find(employee => employee.id === id)?.name ?? "—";

  return <Shell title={editing ? `ویرایش صورت‌جلسهٔ ${minute?.number ?? ""}` : "صورت‌جلسهٔ جدید"} eyebrow="صورت‌جلسه" busy={busy} error={error} close={close} submitLabel="ذخیرهٔ صورت‌جلسه" onSubmit={submit}>
    <div className="form-columns">
      <label>جلسه<select value={meetingId} onChange={event => pickMeeting(event.target.value)} disabled={editing} required>{meetings.map(item => <option key={item.id} value={item.id}>{item.name}{item.period ? ` — ${item.period}` : ""}</option>)}</select></label>
      <label>شمارهٔ صورت‌جلسه<input name="number" required defaultValue={minute?.number ?? ""} maxLength={60}/></label>
      <label>تاریخ<input name="date" type="date" required defaultValue={minute?.date ? String(minute.date).slice(0, 10) : todayISO()}/></label>
      <label>ساعت<input name="time" type="time" defaultValue={minute?.time ?? ""}/></label>
      <label>محل جلسه<input name="location" defaultValue={minute?.location ?? ""} maxLength={200}/></label>
    </div>
    <label>خلاصهٔ مذاکرات<textarea name="summary" rows={4} defaultValue={minute?.summary ?? ""} maxLength={20000}/></label>

    <section>
      <div className="section-heading"><h2>حاضران</h2><span>{attendees.filter(row => row.present).length} حاضر از {attendees.length} نفر دعوت‌شده</span></div>
      <div className="attendee-list">
        {attendees.map(row => <label key={row.employeeId} className="checkbox-label attendee-row">
          <input type="checkbox" checked={row.present} onChange={event => toggle(row.employeeId, event.target.checked)}/>
          <span>{nameOf(row.employeeId)}</span>
        </label>)}
        {!attendees.length && <p className="form-hint">این جلسه عضو ثبت‌شده ندارد؛ ابتدا اعضای جلسه را در بخش «جلسات» تعیین کنید.</p>}
      </div>
    </section>

    <section>
      <div className="section-heading"><h2>مصوبات</h2><button type="button" className="secondary-button" onClick={() => setResolutions(current => [...current, blankResolution(current.length)])}><Plus size={16}/>مصوبهٔ جدید</button></div>
      <div className="resolution-list">
        {resolutions.map((row, index) => <div className="resolution-row" key={index}>
          <span className="hokm-letter">{row.itemNo || index + 1}</span>
          <textarea aria-label="متن مصوبه" placeholder="متن مصوبه" value={row.text} onChange={event => updateResolution(index, {text: event.target.value})} rows={2} maxLength={4000}/>
          <div className="resolution-meta">
            <label className="checkbox-label"><input type="checkbox" checked={row.result} onChange={event => updateResolution(index, {result: event.target.checked})}/>تصویب شد</label>
            <select aria-label="مسئول پیگیری" value={row.ownerId} onChange={event => updateResolution(index, {ownerId: event.target.value})}><option value="">مسئول پیگیری…</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>
            <input aria-label="مهلت" type="date" value={row.dueDate} onChange={event => updateResolution(index, {dueDate: event.target.value})}/>
            <button type="button" className="icon-button" onClick={() => setResolutions(current => current.filter((_, at) => at !== index))} aria-label="حذف مصوبه"><Trash2 size={16}/></button>
          </div>
        </div>)}
      </div>
    </section>
  </Shell>;
}
