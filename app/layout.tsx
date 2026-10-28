import type { Metadata } from "next";
import "./globals.css";
import "./workflow.css";
import "./landing.css";
export const metadata: Metadata = {title: "پرتال جامع توسعه و پشتیبانی", description: "شرکت هوشمند فناوران برتر ایرانیان", icons: {icon: "/brand/itfco-icon.webp"}};
export default function RootLayout({children}: {children: React.ReactNode}) {return <html lang="fa" dir="rtl"><body>{children}</body></html>;}
