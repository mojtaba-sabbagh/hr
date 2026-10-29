import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/auth";
import { AccessError } from "@/app/lib/access-policy";
import { hokmSheet } from "@/app/lib/hr-hokm";
import { rialText } from "@/app/lib/amount-words";
import PrintButton from "@/app/components/print-button";

// حکم — the printable page.
//
// It is a plain server-rendered HTML page with an A4 stylesheet, not a PDF
// library. The browser already shapes Persian correctly, so «چاپ / ذخیره
// به‌صورت PDF» produces the file the person hands over, with the right bidi,
// the right type and no extra dependency in the project.
//
// Every number here comes from the copy stored on the decree (`HrDecreeItem`),
// never from the live template catalogue: a paper signed last year must print
// the rows it was signed with.
export const dynamic = "force-dynamic";

const faDate = (value: Date | string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("fa-IR", {year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tehran"}).format(date) : "";
};
const plain = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));

type Pair = [label: string, value: string];

export default async function DecreePrintPage({params}: {params: {id: string}}) {
  const session = await getSession();
  if (!session) redirect("/login");
  let sheet: Awaited<ReturnType<typeof hokmSheet>>;
  try {
    sheet = await hokmSheet(session, params.id);
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    return <main className="access-denied"><h1>چاپ حکم</h1><p>{error.message}</p><Link href="/hr?view=decrees" className="primary-button">بازگشت به احکام</Link></main>;
  }
  const {decree, items, totals, words, signature, kindTitle} = sheet;
  const employee = decree.employee;
  const profile = employee.hokmProfile;
  const template = decree.template;
  const company = decree.company?.name ?? "";
  const service = profile && (profile.serviceYears || profile.serviceMonths || profile.serviceDays)
    ? `${profile.serviceYears} سال و ${profile.serviceMonths} ماه و ${profile.serviceDays} روز`
    : "";

  const rows: Pair[][] = [
    [["نام و نام خانوادگی", employee.name], ["کد ملی", employee.nationalId], ["شمارهٔ مستخدم", employee.personnelCode]],
    [["نام پدر", profile?.fatherName ?? ""], ["شمارهٔ شناسنامه", profile?.idBookNo ?? ""], ["محل تولد", profile?.birthPlace ?? ""]],
    [["استان محل تولد", profile?.birthProvince ?? ""], ["تاریخ تولد", faDate(employee.birthDate)], ["وضعیت نظام وظیفه", employee.militaryStatus === "DONE" ? "پایان خدمت" : employee.militaryStatus === "EXEMPT" ? "معاف" : "مشمول"]],
    [["آخرین مدرک تحصیلی", profile?.degree ?? employee.education], ["رشتهٔ تحصیلی", profile?.major ?? ""], ["گرایش", profile?.orientation ?? ""]],
    [["دانشگاه محل تحصیل", profile?.university ?? ""], ["کشور محل تحصیل", profile?.country ?? ""], ["تاریخ اخذ مدرک", faDate(profile?.degreeDate)]],
    [["پست سازمانی", profile?.orgPosition ?? employee.jobTitle], ["شمارهٔ پست", profile?.positionNo ?? ""], ["شناسهٔ یکتای پست", profile?.positionUniqueId ?? ""]],
    [["واحد سازمانی", employee.department], ["وضعیت استخدامی", profile?.employmentStatus ?? ""], ["حالت استخدامی", profile?.employmentCase ?? ""]],
    [["سوابق خدمت", service], ["وضعیت تأهل", profile?.maritalStatus ?? ""], ["تعداد فرزندان", profile ? String(profile.children) : ""]],
    [["مرتبهٔ علمی", profile?.rank ?? ""], ["پایهٔ استحقاقی", profile ? String(profile.basePoint) : ""], ["امتیاز ایثارگری", profile ? String(profile.veteranPoint) : ""]],
    [["مجوز", profile?.licenseNo ? `${profile.licenseNo}${profile.licenseDate ? ` — ${faDate(profile.licenseDate)}` : ""}` : ""], ["پست اجرایی", profile?.executivePosition ?? ""], ["نوع حکم", kindTitle]],
    [["تاریخ اجرا", faDate(decree.effectiveAt)], ["تاریخ صدور", faDate(decree.issuedAt)], ["شمارهٔ حکم", decree.number]],
  ];

  const earnings = items.filter(item => item.kind !== "DEDUCTION");
  const deductions = items.filter(item => item.kind === "DEDUCTION");

  return (
    <main className="paper-page">
      <div className="paper-toolbar no-print">
        <Link href="/hr?view=decrees" className="secondary-button">بازگشت به احکام</Link>
        <PrintButton/>
        <span className="paper-note">این صفحه برای چاپ روی کاغذ A4 آماده است؛ در پنجرهٔ چاپ «ذخیره به‌صورت PDF» را انتخاب کنید.</span>
      </div>

      <div className="paper-wrap">
        <div className="paper paper-sheet">
          <div className="watermark" aria-hidden><span>{company}</span></div>

          <header className="paper-head">
            <div className="paper-head-side">
              {template?.ministryLine ? <div>{template.ministryLine}</div> : null}
              <div className="paper-head-unit">{template?.unitLine || company}</div>
            </div>
            <div className="paper-head-main">
              <div className="paper-title">{template?.title || "حکم کارگزینی"}</div>
              <div className="paper-sub">{kindTitle}</div>
            </div>
            <div className="paper-head-side paper-head-meta">
              <div>شماره: {decree.number}</div>
              <div>تاریخ: {faDate(decree.issuedAt)}</div>
            </div>
          </header>

          {template?.intro ? <p className="paper-intro">{template.intro}</p> : null}

          <table className="paper-grid">
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {row.map(([label, value]) => (
                    <Fragmentish key={label} label={label} value={value}/>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {decree.reason ? (
            <section className="paper-block">
              <div className="paper-block-title">شرح حکم</div>
              <p className="paper-text">{decree.reason}</p>
            </section>
          ) : null}

          <section className="paper-block">
            <div className="paper-block-title">حقوق، مزایا و فوق‌العاده‌ها</div>
            {items.length ? (
              <table className="paper-items">
                <thead><tr><th className="letter">ردیف</th><th>عنوان</th><th className="amount">مبلغ (ریال)</th></tr></thead>
                <tbody>
                  {earnings.map(item => <tr key={item.id}><td className="letter">{item.letter}</td><td>{item.label}{item.note ? <small> — {item.note}</small> : null}</td><td className="amount">{rialText(item.amount)}</td></tr>)}
                  {deductions.length ? <tr className="paper-items-head"><td colSpan={3}>کسور</td></tr> : null}
                  {deductions.map(item => <tr key={item.id}><td className="letter">{item.letter}</td><td>{item.label}{item.note ? <small> — {item.note}</small> : null}</td><td className="amount">{rialText(item.amount)}</td></tr>)}
                  <tr className="paper-items-total"><td colSpan={2}>جمع</td><td className="amount">{rialText(totals.net)}</td></tr>
                </tbody>
              </table>
            ) : <p className="paper-text">این حکم ردیف حقوقی ندارد.</p>}
          </section>

          <section className="paper-block">
            <div className="paper-block-title">مبلغ به حروف</div>
            <p className="paper-text">{items.length ? `${words} ریال` : "—"}</p>
          </section>

          <p className="paper-standing">{template?.footer || "دستگاه اجرایی موظف است ساعت کار هفتگی را بر اساس مقررات جاری تنظیم کند و این حکم پس از امضا و ابلاغ قابل اجراست."}</p>

          <footer className="paper-sign">
            <div className="sign-line">
              <div className="sign-name">{decree.signer || "—"}</div>
              <div className="sign-title">{decree.signerTitle || ""}</div>
              {signature ? <img src={signature} alt={`امضای ${decree.signer}`}/> : <div className="sign-blank"/>}
              <div className="sign-caption">امضا</div>
            </div>
            {decree.cosigner ? <div className="sign-line"><div className="sign-name">{decree.cosigner}</div><div className="sign-blank"/><div className="sign-caption">هم‌امضا</div></div> : null}
          </footer>
        </div>
      </div>
    </main>
  );
}

/** One label/value pair of the numbered grid, as a th/td couple. */
function Fragmentish({label, value}: {label: string; value: string}) {
  return <><th className="label">{label}</th><td>{plain(value)}</td></>;
}
