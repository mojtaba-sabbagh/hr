"use client";
import { FormEvent, useState } from "react";
import { ArrowLeft, Leaf, ShieldCheck } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth/login", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({email, password})});
      if (response.ok) {window.location.replace("/"); return;}
      const data = await response.json();
      throw new Error(data.error || "ورود ناموفق بود");
    } catch (error) {setError(error instanceof Error ? error.message : "ارتباط برقرار نشد. دوباره تلاش کنید."); setLoading(false);}
  }
  return <main className="login-page"><section className="login-story"><span className="story-mark"><Leaf size={40} strokeWidth={1.5}/></span><h1>همراهِ هم،<br/>رو به آینده‌ای بهتر</h1><p>یک فضای مشترک برای ارتباط، همکاری و دسترسی به خدمات سازمانی.</p><small>پرتال جامع معاونت توسعه<br/>شرکت هوشمند فناوران برتر ایرانیان</small></section><div className="login-form-area"><form onSubmit={submit} className="login-form"><img src="/brand/itfco-logo.webp" width={175} height={107} alt="شرکت هوشمند فناوران برتر ایرانیان"/><span className="eyebrow">خوش آمدید</span><h2>ورود به پرتال سازمانی</h2><p>برای ورود به فضای کاری خود، اطلاعات حساب سازمانی را وارد کنید.</p><div className="form-stack"><label>ایمیل سازمانی<input required type="email" dir="ltr" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" placeholder="name@company.com"/></label><label>گذرواژه<div className="relative" dir="ltr"><input required type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" style={{paddingRight: 82}}/><button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-blue-600" onClick={() => setShowPassword(value => !value)}>{showPassword ? "پنهان کردن" : "نمایش"}</button></div></label></div>{error && <div role="alert" className="feedback error mt-5">{error}</div>}<button type="submit" className="primary-button" disabled={loading}>{loading ? "در حال بررسی…" : "ورود به حساب"}<ArrowLeft size={17}/></button><div className="login-footnote"><ShieldCheck size={14}/>دسترسی امن با حساب سازمانی شما</div></form></div></main>;
}
