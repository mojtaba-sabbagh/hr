import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/auth";
import { AccessError } from "@/app/lib/access-policy";
import { minuteSheet } from "@/app/lib/hr-meetings";
import PrintButton from "@/app/components/print-button";

// صورت‌جلسه — the printable minute.
//
// The signature block is the point of the page: one box per person who was
// present, holding the image that was snapshotted when they signed. A box with
// no signature is printed as a blank line with «امضا نشده» under it, so a
// partially signed paper says so on its face instead of looking complete.
export const dynamic = "force-dynamic";

const faDate = (value: Date | string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fa-IR", {year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tehran"}).format(date) : "";
};
const plain = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));

export default async function MinutePrintPage({params}: {params: {id: string}}) {
  const session = await getSession();
  if (!session) redirect("/login");
  let sheet: Awaited<ReturnType<typeof minuteSheet>>;
  try {
    sheet = await minuteSheet(session, params.id);
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    return <main className="access-denied"><h1>چاپ صورت‌جلسه</h1><p>{error.message}</p><Link href="/hr?view=minutes" className="primary-button">بازگشت به صورت‌جلسه‌ها</Link></main>;
  }
  const {minute, statusTitle, present, absent, pending} = sheet;
  const signed = new Map(minute.signatures.map(signature => [signature.employeeId, signature]));

  return (
    <main className="paper-page">
      <div className="paper-toolbar no-print">
        <Link href="/hr?view=minutes" className="secondary-button">بازگشت به صورت‌جلسه‌ها</Link>
        <PrintButton/>
        <span className="paper-note">وضعیت: {statusTitle}{pending.length && minute.status === "FOR_SIGNATURE" ? ` — ${pending.length} امضا در انتظار` : ""}</span>
      </div>

      <div className="paper-wrap">
        <div className="paper paper-sheet">
          <div className="watermark" aria-hidden><span>{minute.company?.name ?? ""}</span></div>

          <header className="paper-head">
            <div className="paper-head-side">
              <div>{minute.company?.name ?? ""}</div>
              <div className="paper-head-unit">{minute.meeting?.name ?? ""}</div>
            </div>
            <div className="paper-head-main">
              <div className="paper-title">صورت‌جلسه</div>
              <div className="paper-sub">{minute.meeting?.period || ""}</div>
            </div>
            <div className="paper-head-side paper-head-meta">
              <div>شماره: {minute.number}</div>
              <div>تاریخ: {faDate(minute.date)}</div>
              {minute.time ? <div>ساعت: {minute.time}</div> : null}
            </div>
          </header>

          <table className="paper-grid">
            <tbody>
              <tr><th className="label">محل جلسه</th><td>{plain(minute.location)}</td><th className="label">تنظیم‌کننده</th><td>{plain(minute.createdByName)}</td></tr>
              <tr><th className="label">حاضران</th><td colSpan={3}>{present.map(row => row.employee?.name).join("، ") || "—"}</td></tr>
              {absent.length ? <tr><th className="label">غایبان</th><td colSpan={3}>{absent.map(row => row.employee?.name).join("، ")}</td></tr> : null}
            </tbody>
          </table>

          <section className="paper-block">
            <div className="paper-block-title">خلاصهٔ مذاکرات</div>
            <p className="paper-text paper-long">{minute.summary || "—"}</p>
          </section>

          <section className="paper-block">
            <div className="paper-block-title">مصوبات</div>
            {minute.resolutions.length ? (
              <table className="paper-items">
                <thead><tr><th className="letter">شماره</th><th>متن مصوبه</th><th className="result">نتیجه</th><th className="owner">مسئول پیگیری</th><th className="due">مهلت</th></tr></thead>
                <tbody>
                  {minute.resolutions.map(resolution => <tr key={resolution.id}>
                    <td className="letter">{resolution.itemNo}</td>
                    <td>{resolution.text}</td>
                    <td className="result">{resolution.result ? "تصویب شد" : "رد شد"}</td>
                    <td className="owner">{resolution.owner?.name ?? "—"}</td>
                    <td className="due">{resolution.dueDate ? faDate(resolution.dueDate) : "—"}</td>
                  </tr>)}
                </tbody>
              </table>
            ) : <p className="paper-text">مصوبه‌ای ثبت نشده است.</p>}
          </section>

          <section className="paper-block">
            <div className="paper-block-title">امضای حاضران</div>
            <div className="sign-grid">
              {present.map(row => {
                const signature = row.employeeId ? signed.get(row.employeeId) : undefined;
                return <div className="sign-cell" key={row.id}>
                  <div className="sign-name">{row.employee?.name ?? ""}</div>
                  <div className="sign-title">{signature?.signerTitle || ""}</div>
                  {signature ? <>
                    <img src={signature.image} alt={`امضای ${row.employee?.name ?? ""}`}/>
                    <div className="sign-caption">{faDate(signature.signedAt)}</div>
                  </> : <>
                    <div className="sign-blank"/>
                    <div className="sign-caption">امضا نشده</div>
                  </>}
                </div>;
              })}
              {!present.length ? <p className="paper-text">حاضری ثبت نشده است.</p> : null}
            </div>
          </section>

          <p className="paper-standing">این صورت‌جلسه پس از امضای همهٔ حاضران قطعی می‌شود؛ هر امضا تصویر امضای همان شخص در لحظهٔ امضا است.</p>
        </div>
      </div>
    </main>
  );
}
