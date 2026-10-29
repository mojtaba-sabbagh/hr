"use client";

// The one interactive thing on a print page. Everything else is a server
// component, so the paper is complete before the browser runs any script.
export default function PrintButton({label = "چاپ / ذخیره به‌صورت PDF"}: {label?: string}) {
  return <button type="button" className="primary-button" onClick={() => window.print()}>{label}</button>;
}
