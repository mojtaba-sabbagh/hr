import type { SessionUser } from "../session-types";
import { can, type Module } from "./shared";
export type Option = { value: string; label: string };
export type Field = {
  key: string;
  label: string;
  kind: "text" | "date" | "number" | "select" | "multi" | "rows" | "json" | "evidence";
  options?: Option[];
  columns?: Field[];
  optional?: boolean;
  value?: string | string[] | Record<string, string>[];
  hint?: string;
};
export type Form = {
  action: string;
  title: string;
  fields: Field[];
  hidden: Record<string, string | number>;
};
export type Row = { id?:string; cells: string[]; forms?: Form[]; notes?: string[]; evidence?: string };
export type Section = { title: string; columns: string[]; rows: Row[]; forms: Form[]; hint?: string };
export type Board = { sections: Section[]; periods: Option[]; selected: string; periodLabel: string };
export const field = (
  key: string,
  label: string,
  kind: Field["kind"] = "text",
  optional = false,
  value?: string,
): Field => ({ key, label, kind, optional, value });
export const select = (
  key: string,
  label: string,
  options: Option[],
  optional = false,
  value?: string,
): Field => ({ ...field(key, label, "select", optional, value), options });
export const option = (value: string, label: string): Option => ({ value, label });
export const grid = (
  key: string,
  label: string,
  columns: Field[],
  value?: Record<string, string>[],
  optional = false,
): Field => ({ key, label, kind: "rows", columns, value, optional });
export class OfficeView {
  board: Board = { sections: [], periods: [], selected: "", periodLabel: "دوره" };
  constructor(
    readonly actor: SessionUser,
    readonly module: Module,
  ) {}
  allowed(verb: string) {
    return can(this.actor, this.module, verb);
  }
  form(
    verb: string,
    action: string,
    title: string,
    fields: Field[] = [],
    hidden: Form["hidden"] = {},
  ): Form[] {
    return this.allowed(verb) ? [{ action, title, fields, hidden }] : [];
  }
  section(title: string, columns: string[], forms: Form[] = [], hint?: string) {
    const section: Section = { title, columns, forms, rows: [], hint };
    this.board.sections.push(section);
    return section;
  }
}
