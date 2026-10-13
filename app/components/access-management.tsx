"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import type { AccessData, ManagedGroup, ManagedUser } from "@/app/lib/access-types";
import type { SessionUser } from "@/app/lib/session-types";

export type AccessTab = "admins" | "users" | "groups";
const field = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50";
const primary = "inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50";
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value];

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {method, cache: "no-store", ...(body === undefined ? {} : {headers: {"content-type": "application/json"}, body: JSON.stringify(body)})});
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
  return result;
}

function GroupChoices({data, value, onChange}: {data: AccessData; value: string[]; onChange: (value: string[]) => void}) {
  if (!data.groups.length) return <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">ابتدا در بخش «گروه‌ها و مجوزها» یک گروه ایجاد کنید.</p>;
  return <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
    {data.subsystems.filter(s => data.groups.some(g => g.subsystemKey === s.key)).map(s => <fieldset key={s.key} className="mb-3">
      <legend className="mb-2 text-xs font-bold text-slate-500">{s.title}{!s.enabled && " · غیرفعال"}</legend>
      {data.groups.filter(g => g.subsystemKey === s.key).map(g => <label key={g.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-slate-50">
        <input type="checkbox" className="mt-1 accent-blue-600" checked={value.includes(g.id)} onChange={() => onChange(toggle(value, g.id))}/>
        <span className="text-sm">{g.name}<span className="mr-2 text-xs text-slate-400">{g.permissionKeys.length.toLocaleString("fa-IR")} مجوز</span></span>
      </label>)}
    </fieldset>)}
  </div>;
}

function SubsystemChoices({data, value, onChange}: {data: AccessData; value: string[]; onChange: (value: string[]) => void}) {
  return <div className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
    {data.subsystems.map(s => <label key={s.key} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-sm hover:bg-slate-50">
      <input type="checkbox" className="accent-blue-600" checked={value.includes(s.key)} onChange={() => onChange(toggle(value, s.key))}/>
      {s.title}{!s.enabled && <span className="text-xs text-slate-400">غیرفعال</span>}
    </label>)}
  </div>;
}

export default function AccessManagement({tab, session, onTabChange}: {tab: AccessTab; session: SessionUser; onTabChange: (tab: AccessTab) => void}) {
  const [data, setData] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<"create" | "group" | "memberships" | "scopes" | null>(null);
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ManagedGroup | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [existing, setExisting] = useState(false);
  const [subsystemKeys, setSubsystemKeys] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [subsystemKey, setSubsystemKey] = useState("");
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [search, setSearch] = useState("");
  const isSuper = session.role === "SUPER_ADMIN";

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await request<AccessData>("/api/admin/access")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {load().catch(error => setError(error.message));}, [load]);
  useEffect(() => {setForm(null); setError(""); setSuccess(""); setSearch("");}, [tab]);

  function resetForm() {
    setName(""); setEmail(""); setPassword(""); setShowPassword(false); setExisting(false);
    setGroupIds([]); setSubsystemKeys([]); setPermissionKeys([]); setTemplateId("");
    setSelectedUser(null); setSelectedGroup(null); setError(""); setSuccess("");
    setSubsystemKey(data?.subsystems[0]?.key || "");
  }
  function openCreate() {resetForm(); setForm(tab === "groups" ? "group" : "create");}
  function editGroup(group: ManagedGroup) {
    resetForm(); setSelectedGroup(group); setName(group.name); setSubsystemKey(group.subsystemKey);
    setPermissionKeys(group.permissionKeys); setForm("group");
  }
  function editUser(user: ManagedUser, kind: "memberships" | "scopes") {
    resetForm(); setSelectedUser(user); setGroupIds(user.groupIds); setSubsystemKeys(user.adminSubsystemKeys); setForm(kind);
  }
  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true); setError(""); setSuccess("");
    try {
      await action(); setForm(null); setPassword(""); setSuccess(message);
      await load();
    } catch (error) {setError(error instanceof Error ? error.message : "عملیات انجام نشد");}
    finally {setBusy(false);}
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (form === "group") {
      void mutate(() => request(selectedGroup ? `/api/admin/groups/${selectedGroup.id}` : "/api/admin/groups", selectedGroup ? "PATCH" : "POST", {name, subsystemKey, permissionKeys}), "گروه و مجوزهای آن ذخیره شد.");
    } else if (form === "memberships" && selectedUser) {
      void mutate(() => request(`/api/admin/users/${selectedUser.id}/groups`, "PUT", {groupIds}), "عضویت در گروه‌ها به‌روز شد.");
    } else if (form === "scopes" && selectedUser) {
      void mutate(() => request(`/api/admin/users/${selectedUser.id}`, "PATCH", {subsystemKeys}), "حوزه مدیریت ادمین به‌روز شد.");
    } else if (existing) {
      void mutate(() => request("/api/admin/users/memberships", "POST", {email, groupIds}), "کاربر موجود به گروه‌های انتخاب‌شده پیوست.");
    } else {
      void mutate(() => request("/api/admin/users", "POST", {name, email, password, role: tab === "admins" ? "SUBSYSTEM_ADMIN" : "USER", groupIds, subsystemKeys: tab === "admins" ? subsystemKeys : []}), "حساب ایجاد شد. اطلاعات ورود را در اختیار صاحب حساب قرار دهید.");
    }
  }

  const title = tab === "admins" ? "ادمین‌های زیرسیستم" : tab === "groups" ? "گروه‌ها و مجوزها" : "حساب‌های کاربران";
  const createLabel = tab === "admins" ? "ایجاد ادمین زیرسیستم" : tab === "groups" ? "ایجاد گروه" : "افزودن کاربر";
  const visibleUsers = data?.users.filter(u => (tab === "admins" ? u.role === "SUBSYSTEM_ADMIN" : u.role === "USER") && `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase())) || [];
  const chosenPermissions = data?.permissions.filter(p => permissionKeys.includes(p.key)) || [];
  const effectivePermissions = data?.permissions.filter(p => data.groups.some(g => groupIds.includes(g.id) && g.permissionKeys.includes(p.key))) || [];

  return <section aria-label={title} className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-xl font-bold">{title}</h2><p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">{tab === "admins" ? "برای هر ادمین، زیرسیستم‌های تحت مدیریت را مشخص کنید. ادمین فقط در همان حوزه می‌تواند کاربر و گروه ایجاد کند." : tab === "groups" ? "مجوزها را به گروه بدهید؛ هر کاربر مجوزهای مجموع گروه‌های خود را دریافت می‌کند. الگوها بر اساس نقش‌های پروژه آماده شده‌اند." : "حساب بسازید یا کاربر موجود را با ایمیل به گروه‌های حوزه خود اضافه کنید. دسترسی عملیاتی فقط از گروه‌ها به دست می‌آید."}</p></div>
      <div className="flex gap-2">
        <button type="button" aria-label="تازه‌سازی فهرست" className={secondary} disabled={loading || busy} onClick={() => {setError(""); void load().catch(e => setError(e.message));}}><RefreshCw size={16}/></button>
        <button type="button" className={primary} onClick={openCreate} disabled={!data || busy}><Plus size={16}/>{createLabel}</button>
      </div>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {success && <p role="status" className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800"><Check size={18}/>{success}</p>}
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin"/>در حال دریافت اطلاعات…</p>}
    {data && !data.subsystems.length && <p className="rounded-2xl border border-amber-100 bg-amber-50 p-5 text-sm text-amber-800">زیرسیستم فعالی برای مدیریت شما تعیین نشده است. ابرادمین باید حوزه مدیریت شما را مشخص کند.</p>}

    {data && form && <form onSubmit={submit} className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h3 className="font-bold">{form === "group" ? selectedGroup ? `ویرایش گروه ${selectedGroup.name}` : "گروه جدید" : form === "memberships" ? `گروه‌های ${selectedUser?.name}` : form === "scopes" ? `حوزه مدیریت ${selectedUser?.name}` : createLabel}</h3>
        <button type="button" aria-label="بستن فرم" className={secondary} disabled={busy} onClick={() => {setForm(null); setPassword("");}}><X size={16}/></button>
      </div>
      <fieldset disabled={busy} className="space-y-5">
        {form === "create" && <>
          {tab === "users" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-blue-600" checked={existing} onChange={e => {setExisting(e.target.checked); setPassword("");}}/>افزودن حساب موجود با ایمیل</label>}
          <div className="grid gap-4 md:grid-cols-3">
            {!existing && <label className="text-sm font-medium">نام و نام خانوادگی<input className={field} required maxLength={120} value={name} onChange={e => setName(e.target.value)} autoComplete="off"/></label>}
            <label className="text-sm font-medium">ایمیل سازمانی<input type="email" dir="ltr" className={field} required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} autoComplete="off"/></label>
            {!existing && <label className="text-sm font-medium">گذرواژه اولیه<div className="relative"><input type={showPassword ? "text" : "password"} dir="ltr" className={`${field} pr-16`} required minLength={8} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password"/><button type="button" aria-label={showPassword ? "پنهان کردن گذرواژه" : "نمایش گذرواژه"} className="absolute right-3 top-5 text-xs text-blue-600" onClick={() => setShowPassword(v => !v)}>{showPassword ? "پنهان" : "نمایش"}</button></div><span className="mt-1 block text-xs font-normal text-slate-400">حداقل ۸ نویسه؛ حداکثر ۷۲ بایت</span></label>}
          </div>
        </>}
        {(form === "scopes" || (form === "create" && tab === "admins")) && <fieldset><legend className="mb-3 text-sm font-bold">حوزه مدیریت زیرسیستم‌ها</legend><SubsystemChoices data={data} value={subsystemKeys} onChange={setSubsystemKeys}/><p className="mt-2 text-xs text-slate-500">زیرسیستم غیرفعال تا زمان فعال‌سازی قابل استفاده یا مدیریت نیست.</p></fieldset>}
        {(form === "memberships" || form === "create") && <fieldset><legend className="mb-3 text-sm font-bold">گروه‌های کاربر{tab === "admins" && form === "create" ? " (اختیاری؛ برای دسترسی عملیاتی)" : ""}</legend>
          <GroupChoices data={data} value={groupIds} onChange={setGroupIds}/>
          {!data.groups.length && <button type="button" className="mt-2 text-sm text-blue-600" onClick={() => onTabChange("groups")}>رفتن به گروه‌ها و مجوزها</button>}
          {effectivePermissions.length > 0 && <details className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"><summary className="cursor-pointer font-medium">{effectivePermissions.length.toLocaleString("fa-IR")} مجوز از گروه‌های انتخاب‌شده</summary><ul className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2">{effectivePermissions.map(p => <li key={p.key}>{data.subsystems.find(s => s.key === p.subsystemKey)?.title} · {p.title}</li>)}</ul></details>}
          {form === "memberships" && <p className="mt-2 text-xs text-slate-500">برداشتن همه گزینه‌ها، دسترسی گروهی در حوزه شما را لغو می‌کند. عضویت سایر حوزه‌ها حفظ می‌شود.</p>}
        </fieldset>}
        {form === "group" && <>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm font-medium">زیرسیستم<select required className={field} value={subsystemKey} disabled={!!selectedGroup} onChange={e => {setSubsystemKey(e.target.value); setPermissionKeys([]); setTemplateId("");}}><option value="">انتخاب زیرسیستم</option>{data.subsystems.map(s => <option key={s.key} value={s.key}>{s.title}{!s.enabled && " (غیرفعال)"}</option>)}</select></label>
            <label className="text-sm font-medium">الگوی دسترسی<select className={field} value={templateId} onChange={e => {const t = data.templates.find(t => t.id === e.target.value); setTemplateId(e.target.value); if (t) {setPermissionKeys(t.permissionKeys); if (!name) setName(t.name);}}}><option value="">انتخاب دستی مجوزها</option>{data.templates.filter(t => t.subsystemKey === subsystemKey).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label className="text-sm font-medium">نام گروه<input required maxLength={120} className={field} value={name} onChange={e => setName(e.target.value)} placeholder="مثلاً سرپرستان شیفت"/></label>
          </div>
          {templateId && <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{data.templates.find(t => t.id === templateId)?.description}؛ مجوزهای زیر قابل تغییر هستند.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-sm font-bold">مجوزهای گروه · {chosenPermissions.length.toLocaleString("fa-IR")} انتخاب</h4><div className="flex gap-3 text-xs text-blue-600"><button type="button" onClick={() => {setTemplateId(""); setPermissionKeys(data.permissions.filter(p => p.subsystemKey === subsystemKey).map(p => p.key));}}>انتخاب همه</button><button type="button" onClick={() => {setTemplateId(""); setPermissionKeys([]);}}>پاک کردن انتخاب‌ها</button></div></div>
          <div className="grid max-h-[28rem] gap-3 overflow-y-auto rounded-xl border border-slate-200 p-3 md:grid-cols-2 xl:grid-cols-3">
            {[...new Set(data.permissions.filter(p => p.subsystemKey === subsystemKey).map(p => p.section))].map(section => <fieldset key={section} className="rounded-xl bg-slate-50 p-3"><legend className="px-1 text-xs font-bold text-slate-600">{section}</legend>{data.permissions.filter(p => p.subsystemKey === subsystemKey && p.section === section).map(p => <label key={p.key} className="flex cursor-pointer items-start gap-2 py-2 text-xs leading-5"><input type="checkbox" className="mt-1 accent-blue-600" checked={permissionKeys.includes(p.key)} onChange={() => {setTemplateId(""); setPermissionKeys(toggle(permissionKeys, p.key));}}/>{p.title}</label>)}</fieldset>)}
          </div>
          {!permissionKeys.length && <p className="text-xs text-amber-700">این گروه هیچ مجوز عملیاتی ندارد.</p>}
        </>}
        <div className="flex gap-3 border-t border-slate-100 pt-5"><button type="submit" className={primary} disabled={busy || (form === "create" && (tab === "admins" ? !subsystemKeys.length : !groupIds.length)) || (form === "group" && !subsystemKey)}>{busy ? <Loader2 size={16} className="animate-spin"/> : <Check size={16}/>}ذخیره</button><button type="button" className={secondary} onClick={() => {setForm(null); setPassword("");}}>انصراف</button></div>
      </fieldset>
    </form>}

    {data && tab === "groups" && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.groups.map(group => <article key={group.id} className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3"><div className="rounded-xl bg-blue-50 p-3 text-blue-600"><ShieldCheck size={22}/></div><button type="button" disabled={busy} className={secondary} onClick={() => editGroup(group)} aria-label={`ویرایش گروه ${group.name}`}><Pencil size={14}/>ویرایش</button></div>
      <h3 className="font-bold">{group.name}</h3><p className="mt-1 text-xs text-slate-500">{data.subsystems.find(s => s.key === group.subsystemKey)?.title}</p>
      <div className="mt-4 flex gap-4 text-xs text-slate-500"><span>{group.memberCount.toLocaleString("fa-IR")} عضو</span><span>{group.permissionKeys.length.toLocaleString("fa-IR")} مجوز</span></div>
      <details className="mt-4 text-xs"><summary className="cursor-pointer text-blue-600">مشاهده مجوزها</summary><ul className="mt-3 space-y-2 text-slate-600">{group.permissionKeys.map(key => <li key={key}>{data.permissions.find(p => p.key === key)?.title || key}</li>)}</ul></details>
    </article>)}{!data.groups.length && !loading && <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><Users className="mx-auto mb-3 text-slate-400"/><p className="text-sm text-slate-500">هنوز گروهی ایجاد نشده است. یک الگو انتخاب کنید و مجوزهای آن را تنظیم کنید.</p></div>}</div>}

    {data && tab !== "groups" && <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-4"><label className="sr-only" htmlFor="account-search">جست‌وجوی نام یا ایمیل</label><input id="account-search" className={`${field} mt-0 max-w-sm`} placeholder="جست‌وجوی نام یا ایمیل…" value={search} onChange={e => setSearch(e.target.value)}/></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-right text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-4">کاربر</th><th className="p-4">{tab === "admins" ? "حوزه مدیریت" : "گروه‌ها"}</th><th className="p-4">وضعیت</th><th className="p-4">عملیات</th></tr></thead><tbody className="divide-y divide-slate-100">
        {visibleUsers.map(user => <tr key={user.id}><td className="p-4"><b>{user.name}</b><div dir="ltr" className="mt-1 text-right text-xs text-slate-500">{user.email}</div></td><td className="max-w-xs p-4"><div className="flex flex-wrap gap-1">{(tab === "admins" ? user.adminSubsystemKeys.map(key => data.subsystems.find(s => s.key === key)?.title || key) : user.groupIds.map(id => data.groups.find(g => g.id === id)?.name || "")).map((name, index) => <span key={index} className="rounded-lg bg-slate-100 px-2 py-1 text-xs">{name}</span>)}{!(tab === "admins" ? user.adminSubsystemKeys : user.groupIds).length && <span className="text-xs text-slate-400">تعیین نشده</span>}</div></td><td className="p-4"><span className={`rounded-full px-2 py-1 text-xs ${user.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{user.active ? "فعال" : "غیرفعال"}</span></td><td className="p-4"><div className="flex flex-wrap gap-2">
          {tab === "admins" && <button type="button" disabled={busy} className={secondary} onClick={() => editUser(user, "scopes")}>حوزه مدیریت</button>}
          <button type="button" disabled={busy} className={secondary} onClick={() => editUser(user, "memberships")}><UserPlus size={14}/>گروه‌ها</button>
          {isSuper && <button type="button" disabled={busy} className={`${secondary} ${user.active ? "text-red-600" : "text-emerald-700"}`} onClick={() => void mutate(() => request(`/api/admin/users/${user.id}`, "PATCH", {active: !user.active}), "وضعیت حساب به‌روز شد.")}>{user.active ? "غیرفعال کردن" : "فعال کردن"}</button>}
        </div></td></tr>)}
      </tbody></table></div>
      {!visibleUsers.length && !loading && <p className="p-10 text-center text-sm text-slate-500">{search ? "کاربری با این مشخصات یافت نشد." : "هنوز حسابی در این فهرست وجود ندارد."}</p>}
    </div>}
  </section>;
}
