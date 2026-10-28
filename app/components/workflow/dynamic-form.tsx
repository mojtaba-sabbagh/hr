"use client";
import { Plus, Trash2 } from "lucide-react";
import { matches, normalizeDigits } from "@/app/lib/workflow/validation";
import type { FormField, FormPayload, FormSchema } from "@/app/lib/workflow/types";

function Input({field: f, value, onChange, disabled}: {field: FormField; value: unknown; onChange: (value: unknown) => void; disabled?: boolean}) {
  const id = `field-${f.key}`;
  if (f.type === "paragraph") return <p className="wf-form-help">{f.labelFa}{f.help && <><br/>{f.help}</>}</p>;
  if (f.type === "checkbox") return <label className="wf-check"><input id={id} type="checkbox" checked={value === true} disabled={disabled} required={f.required} onChange={e => onChange(e.target.checked)}/><span>{f.labelFa}{f.required && " *"}{f.help && <small>{f.help}</small>}</span></label>;
  if (f.type === "table") {
    const rows = Array.isArray(value) ? value as FormPayload[] : [];
    return <fieldset className="wf-repeat"><legend>{f.labelFa}{f.required && " *"}</legend>{f.help && <p className="wf-help">{f.help}</p>}
      {rows.map((row, index) => <div className="wf-repeat-row" key={index}><span className="wf-row-number">{index + 1}</span><div className="wf-fields">{f.columns?.map(column => <Input key={column.key} field={{...column, key: `${f.key}-${index}-${column.key}`}} value={row[column.key]} disabled={disabled} onChange={next => onChange(rows.map((r, i) => i === index ? {...r, [column.key]: next} : r))}/>)}</div>{!disabled && <button type="button" className="icon-button" aria-label={`حذف ردیف ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 size={16}/></button>}</div>)}
      {!disabled && <button type="button" className="secondary-button" disabled={rows.length >= 100} onClick={() => onChange([...rows, {}])}><Plus size={16}/>افزودن ردیف</button>}{!rows.length && disabled && <p className="wf-help">ردیفی ثبت نشده است.</p>}
    </fieldset>;
  }
  const common = {id, disabled, required: f.required, "aria-describedby": f.help ? `${id}-help` : undefined};
  return <label className={f.type === "textarea" || f.type === "multiselect" ? "wf-field wide" : "wf-field"} htmlFor={id}><span>{f.labelFa}{f.required && <b className="wf-required"> *</b>}</span>
    {f.type === "textarea" ? <textarea {...common} rows={3} value={String(value ?? "")} onChange={e => onChange(e.target.value)}/> :
      f.type === "select" ? <select {...common} value={String(value ?? "")} onChange={e => onChange(e.target.value)}><option value="">انتخاب کنید</option>{f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> :
      f.type === "multiselect" ? <span className="wf-options">{f.options?.map(o => <span className="wf-check" key={o.value}><input type="checkbox" disabled={disabled} checked={Array.isArray(value) && value.includes(o.value)} onChange={e => onChange(e.target.checked ? [...(Array.isArray(value) ? value : []), o.value] : (Array.isArray(value) ? value : []).filter(v => v !== o.value))}/>{o.label}</span>)}</span> :
      <input {...common} type={f.type === "number" ? "text" : f.type} inputMode={f.type === "number" ? "decimal" : undefined} dir={["number", "date", "time"].includes(f.type) ? "ltr" : undefined} value={String(value ?? "")} onChange={e => onChange(e.target.value)}/>}
    {f.help && <small id={`${id}-help`}>{f.help}</small>}
  </label>;
}
export default function DynamicForm({schema, values, onChange, section = "", disabled = false, allSections = false}: {schema: FormSchema; values: FormPayload; onChange: (value: FormPayload) => void; section?: string; disabled?: boolean; allSections?: boolean}) {
  const context = {...values};
  for (const field of schema.fields) if (field.type === "number" && typeof context[field.key] === "string" && normalizeDigits(context[field.key] as string)) context[field.key] = Number(normalizeDigits(context[field.key] as string));
  const fields = schema.fields.filter(f => (allSections || (f.sectionKey || "") === section) && (!f.visibleWhen || matches(f.visibleWhen, context)));
  return <div className="wf-fields">{fields.map(field => <Input key={field.key} field={field} value={values[field.key]} disabled={disabled} onChange={value => onChange({...values, [field.key]: value})}/>)}</div>;
}
export function PayloadView({schema, values}: {schema: FormSchema; values: FormPayload}) {
  const groups = [{key: "", title: "اطلاعات درخواست"}, ...schema.sections];
  const display = (f: FormField, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "—";
    if (f.type === "checkbox") return v ? "بله" : "خیر";
    if (f.type === "select") return f.options?.find(o => o.value === v)?.label || String(v);
    if (f.type === "multiselect" && Array.isArray(v)) return v.map(item => f.options?.find(o => o.value === item)?.label || String(item)).join("، ") || "—";
    if (f.type === "date") return new Date(String(v)).toLocaleDateString("fa-IR", {timeZone: "Asia/Tehran"});
    if (typeof v === "number") return v.toLocaleString("fa-IR");
    return String(v);
  };
  return <>{groups.map(group => {const fields = schema.fields.filter(f => (f.sectionKey || "") === group.key && f.type !== "paragraph" && (!f.visibleWhen || matches(f.visibleWhen, values))); return fields.length ? <section className="wf-payload" key={group.key}><h3>{group.title}</h3><dl>{fields.map(f => <div key={f.key} className={f.type === "textarea" || f.type === "table" ? "wide" : ""}><dt>{f.labelFa}</dt><dd>{f.type === "table" && Array.isArray(values[f.key]) ? <div className="table-scroll"><table className="core-table"><thead><tr>{f.columns?.map(c => <th key={c.key}>{c.labelFa}</th>)}</tr></thead><tbody>{(values[f.key] as FormPayload[]).map((row, i) => <tr key={i}>{f.columns?.map(c => <td key={c.key}>{display(c, row[c.key])}</td>)}</tr>)}</tbody></table></div> : display(f, values[f.key])}</dd></div>)}</dl></section> : null;})}</>;
}
