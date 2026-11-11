"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpLeft, ListChecks, LayoutGrid, RefreshCw } from "lucide-react";
import AppShell from "./app-shell";
import type { SmartBoard } from "../lib/smart/inbox";
import type { Finding } from "../lib/smart/findings";
import { smartHref } from "../lib/smart/access";
import type { SessionUser } from "../lib/session-types";

const fa = (n: number) => n.toLocaleString("fa-IR");
export default function SmartDesk({
  actor,
  companyId,
  companies,
  board,
}: {
  actor: SessionUser;
  companyId: string;
  companies: { id: string; name: string }[];
  board: SmartBoard;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const hasMonth = board.scopes.some((s) => s !== "assets"),
    hasAssets = board.scopes.includes("assets");
  async function rate(row: Finding, useful: boolean) {
    if (busy) return;
    setBusy(row.key);
    setError("");
    try {
      const response = await fetch("/api/smart-inbox/" + encodeURIComponent(companyId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period: board.period, key: row.key, fingerprint: row.fingerprint, useful }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "ثبت نظر انجام نشد");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ارتباط با سرور برقرار نشد");
    } finally {
      setBusy("");
    }
  }
  function row(item: Finding) {
    const feedback =
      board.reviewable.includes(item.scope) && (item.scope === "assets" || item.level !== "task");
    return (
      <article key={item.key} className={"smart-finding " + item.level}>
        <div>
          <h3>{item.title}</h3>
          <p>{item.evidence}</p>
          <span className="smart-owner">مسئول پیگیری · {item.owner}</span>
        </div>
        <div className="smart-controls">
          <Link href={item.href} className="secondary-button">
            {item.next}
            <ArrowUpLeft size={16} />
          </Link>
          {feedback && (
            <div className="smart-votes" aria-label="ارزیابی این تشخیص">
              <button
                disabled={!!busy}
                aria-pressed={item.review === true}
                onClick={() => void rate(item, true)}
              >
                تشخیص درست
              </button>
              <button
                disabled={!!busy}
                aria-pressed={item.review === false}
                onClick={() => void rate(item, false)}
              >
                نیاز به اصلاح قاعده
              </button>
            </div>
          )}
        </div>
      </article>
    );
  }
  const month = board.findings.filter((f) => f.scope !== "assets"),
    assets = board.findings.filter((f) => f.scope === "assets");
  const { metrics } = board;
  return (
    <AppShell
      session={actor}
      title="کارتابل هوشمند"
      section="پرتال سازمانی"
      active="smart"
      items={[
        { id: "home", label: "داشبورد معاونت توسعه", href: "/", icon: LayoutGrid },
        { id: "smart", label: "کارتابل هوشمند", href: smartHref(companyId, board.period), icon: ListChecks },
      ]}
    >
      <div className="smart-desk">
        <header className="asset-heading">
          <h1>کارتابل هوشمند</h1>
          <div className="office-switches">
            <label>
              شرکت
              <select value={companyId} onChange={(e) => router.push(smartHref(e.target.value))}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {!!board.periods.length && (
              <label>
                دورهٔ کارکرد
                <select
                  value={board.period}
                  onChange={(e) => router.push(smartHref(companyId, e.target.value))}
                >
                  {board.periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="icon-button" aria-label="تازه‌سازی کارتابل" onClick={() => router.refresh()}>
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        {error && (
          <p role="alert" className="feedback error">
            {error}
          </p>
        )}
        {hasMonth && (
          <section className="panel smart-panel">
            <h2>آمادگی بستن ماه</h2>
            {!!board.stages.length && (
              <div className="smart-stages">
                {board.stages.map((s) => (
                  <Link key={s.title} href={s.href} className={"smart-stage " + s.state}>
                    <strong>{s.title}</strong>
                    <span>{s.status}</span>
                  </Link>
                ))}
              </div>
            )}
            {!board.period && !month.length && <p>هنوز دوره‌ای در حوزهٔ دسترسی شما برای بررسی وجود ندارد.</p>}
            {month.map(row)}
            {board.period && !month.length && (
              <p>برای این دوره در بخش‌های در دسترس شما موردی برای پیگیری ثبت نشده است.</p>
            )}
            {metrics.closeDays !== null && (
              <p>از پایان دوره تا ثبت قطعی سند حقوق: {fa(metrics.closeDays)} روز</p>
            )}
          </section>
        )}
        {hasAssets && (
          <section className="panel smart-panel" id="exit-assets">
            <h2>اموال باز هنگام پایان همکاری</h2>
            {assets.length ? (
              assets.map(row)
            ) : (
              <p>اکنون مال تحویلی با نشانهٔ پایان همکاری در این شرکت وجود ندارد.</p>
            )}
            <p className="smart-owner">
              تحویل یا انتقال ثبت‌شده در تسویه‌های این شرکت: {fa(metrics.cleared ?? 0)}
            </p>
          </section>
        )}
        {(metrics.reviewed > 0 || board.period) && (
          <section className="panel smart-panel">
            <h2>ارزیابی هشدارها</h2>
            <p>
              {metrics.reviewed
                ? fa(metrics.verified) + " تشخیص درست از " + fa(metrics.reviewed) + " مورد بررسی‌شده"
                : "هنوز ارزیابی ثبت نشده است."}
            </p>
            {board.period && board.scopes.some((s) => s === "attendance" || s === "payroll") && (
              <p>موارد تأییدشدهٔ کارکرد و حقوق پیش از پرداخت در این دوره: {fa(metrics.beforePayment)}</p>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
