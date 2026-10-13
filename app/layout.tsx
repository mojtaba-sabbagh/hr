import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title: "پرتال جامع معاونت توسعه", description: "شرکت هوشمند فناوران برتر ایرانیان", icons: {icon: "/brand/itfco-icon.webp"}};
export default function RootLayout({children}: {children: React.ReactNode}) {return <html lang="fa" dir="rtl"><body>{children}</body></html>;}
