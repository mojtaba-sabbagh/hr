import { hasPermission } from "../access-policy";
import type { SessionUser } from "../session-types";
import { canPost, type OperationAction } from "./service";
import { type OperationModule } from "./rules";

export type Field = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  optional?: boolean;
  step?: string;
  min?: number;
};
export type Form = { action: OperationAction; title: string; fields: Field[]; hidden: Record<string, string> };
export type Section = { title: string; columns: string[]; rows: { cells: string[]; forms: Form[] }[]; forms: Form[] };
export type Board = { stats: { label: string; value: string }[]; sections: Section[]; alerts: string[] };
export const field = (key: string, label: string, type: Field["type"] = "text", optional = false): Field => ({
  key,
  label,
  type,
  optional,
});
export const number = (key: string, label: string, min = 0, step = "1"): Field => ({
  ...field(key, label, "number"),
  min,
  step,
});
export const select = (key: string, label: string, values: Record<string, string>): Field => ({
  ...field(key, label, "select"),
  options: Object.entries(values).map(([value, label]) => ({ value, label })),
});
export const options = <T extends { id: string }>(rows: T[], label: (r: T) => string) =>
  Object.fromEntries(rows.map((r) => [r.id, label(r)]));
export const fa = (value: number | bigint) => value.toLocaleString("fa-IR", { maximumFractionDigits: 1 });
export const date = (v: Date | null) => (v ? v.toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }) : "—");
export const decision = select("decision", "تصمیم", { APPROVE: "تأیید", REJECT: "رد" });
export class View {
  board: Board = { stats: [], sections: [], alerts: [] };
  constructor(
    readonly actor: SessionUser,
    readonly mod: OperationModule,
  ) {}
  can(resource: string, ...verbs: string[]) {
    return verbs.some((v) => hasPermission(this.actor, this.mod + ":" + resource + ":" + v));
  }
  form(action: OperationAction, title: string, fields: Field[] = [], hidden: Record<string, string> = {}): Form[] {
    if (!canPost(this.actor, action)) return [];
    return [{ action, title, fields, hidden }];
  }
  section(title: string, columns: string[], forms: Form[] = []): Section {
    const section: Section = { title, columns, forms, rows: [] };
    this.board.sections.push(section);
    return section;
  }
  stat(label: string, value: string | number | bigint) {
    this.board.stats.push({ label, value: typeof value === "string" ? value : fa(value) });
  }
}
