// ClickUp API v2 → Eightcore: the pure conversion rules used by scripts/import/clickup-api.ts.
// No I/O here, so every rule is unit-tested.
import type { StatusCategory } from "@/modules/lists/templates";

export type CuStatus = { status: string; type: string; color?: string | null; orderindex?: number | string };
export type CuUser = { id: number; username?: string | null; email?: string | null };
export type CuField = {
  id: string;
  name: string;
  type: string;
  type_config?: {
    options?: { id: string; name?: string; label?: string; color?: string | null; orderindex?: number }[];
  };
  value?: unknown;
};
export type CuTask = {
  id: string;
  custom_id?: string | null;
  name: string;
  text_content?: string | null;
  description?: string | null;
  markdown_description?: string | null;
  status: CuStatus;
  date_created?: string | null;
  date_updated?: string | null;
  date_closed?: string | null;
  date_done?: string | null;
  archived?: boolean;
  creator?: CuUser | null;
  assignees?: CuUser[];
  watchers?: CuUser[];
  parent?: string | null;
  priority?: { priority?: string | null } | null;
  due_date?: string | null;
  start_date?: string | null;
  time_estimate?: number | string | null;
  tags?: { name: string; tag_bg?: string | null; tag_fg?: string | null }[];
  custom_fields?: CuField[];
  dependencies?: { task_id: string; depends_on: string; type?: number }[];
  linked_tasks?: unknown[];
  checklists?: { name: string; items?: { name: string; resolved?: boolean }[] }[];
  attachments?: { title?: string | null; url?: string | null; size?: number | string | null }[];
  url?: string;
};

/** ClickUp status type (and name) → Eightcore category. */
export function statusCategory(status: CuStatus): StatusCategory {
  const name = status.status.toLowerCase();
  switch (status.type) {
    case "open":
      return "unstarted";
    case "done":
      return "done";
    case "closed":
      return "closed";
    default:
      if (/cancel|won'?t do|dropped|rejected/.test(name)) return "cancelled";
      if (/review|qa|test|approv|feedback|check/.test(name)) return "review";
      if (/backlog|icebox|someday/.test(name)) return "backlog";
      return "active";
  }
}

/** "#abc" / "#AABBCC" / null → "#AABBCC" (or the fallback). */
export function normalizeColor(color: string | null | undefined, fallback = "#A1A1AA"): string {
  const c = (color ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join("")}`.toUpperCase();
  return fallback;
}

export function priorityOf(task: Pick<CuTask, "priority">): "urgent" | "high" | "normal" | "low" | "none" {
  const p = task.priority?.priority?.toLowerCase();
  return p === "urgent" || p === "high" || p === "normal" || p === "low" ? p : "none";
}

/** A ClickUp millisecond timestamp → the calendar date in `timeZone` (YYYY-MM-DD). */
export function dateOf(ms: string | number | null | undefined, timeZone: string): string | null {
  if (ms === null || ms === undefined || ms === "") return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(n));
}

export function timestampOf(ms: string | number | null | undefined): Date | null {
  const n = Number(ms);
  return ms !== null && ms !== undefined && ms !== "" && Number.isFinite(n) && n > 0 ? new Date(n) : null;
}

/** Minutes from ClickUp's millisecond estimate (null when unset or out of range). */
export function estimateMinutes(ms: number | string | null | undefined): number | null {
  const n = Math.round(Number(ms) / 60_000);
  return Number.isFinite(n) && n >= 1 && n <= 100_000 ? n : null;
}

type FieldKind = "text" | "number" | "date" | "dropdown" | "checkbox" | "person" | "url";

/** ClickUp custom field type → Eightcore field type. `lossy`: comes across as text or partially. */
export function fieldKind(type: string): { kind: FieldKind; lossy?: string } | null {
  switch (type) {
    case "drop_down":
      return { kind: "dropdown" };
    case "text":
    case "short_text":
    case "email":
    case "phone":
      return { kind: "text" };
    case "number":
    case "currency":
    case "emoji":
      return { kind: "number" };
    case "date":
      return { kind: "date" };
    case "checkbox":
      return { kind: "checkbox" };
    case "url":
      return { kind: "url" };
    case "users":
      return { kind: "person", lossy: "only the first person is kept" };
    case "labels":
      return { kind: "text", lossy: "labels become comma-separated text" };
    case "formula":
    case "rollup":
    case "progress":
    case "location":
      return { kind: "text", lossy: "calculated values become text" };
    default:
      return null;
  }
}

export function optionLabel(o: { name?: string; label?: string }) {
  return (o.name ?? o.label ?? "").trim().slice(0, 60) || "Option";
}

/**
 * A task's value for one field, as Eightcore's setTaskFieldValues expects it.
 * `options` maps ClickUp option ids to Eightcore option ids; `people` ClickUp user ids to Eightcore user ids.
 */
export function fieldValue(
  field: CuField,
  ctx: { timeZone: string; options: Map<string, string>; people: Map<number, string> },
): string | null {
  const v = field.value;
  if (v === null || v === undefined || v === "") return null;
  const kind = fieldKind(field.type)?.kind;
  switch (field.type) {
    case "drop_down": {
      // Newer workspaces store the option id; older ones the option's orderindex.
      const opts = field.type_config?.options ?? [];
      const opt = opts.find((o) => o.id === v) ?? opts.find((o) => String(o.orderindex) === String(v));
      return opt ? (ctx.options.get(opt.id) ?? null) : null;
    }
    case "labels": {
      const ids = Array.isArray(v) ? v.map(String) : [];
      const opts = field.type_config?.options ?? [];
      const names = ids
        .map((id) => opts.find((o) => o.id === id))
        .filter(Boolean)
        .map((o) => optionLabel(o!));
      return names.length ? names.join(", ").slice(0, 500) : null;
    }
    case "users": {
      const first = Array.isArray(v) ? (v[0] as CuUser | undefined) : undefined;
      return first ? (ctx.people.get(Number(first.id)) ?? null) : null;
    }
    case "checkbox":
      return v === true || v === "true" ? "on" : null;
    case "date":
      return dateOf(v as string, ctx.timeZone);
    case "location":
      return typeof v === "object" && v && "formatted_address" in v
        ? String(v.formatted_address).slice(0, 500)
        : null;
    case "progress":
      return typeof v === "object" && v && "percent_completed" in v ? `${v.percent_completed}%` : null;
    default:
      if (kind === "number") return Number.isFinite(Number(v)) ? String(Number(v)) : null;
      if (typeof v === "object") return null;
      return String(v).slice(0, kind === "url" ? 2000 : 500);
  }
}

/**
 * A project key for a space name: 2–10 letters/digits, starting with a letter, not already taken.
 * "8limbs INC" → "LI", "Blend 360" → "B3"… so the dry run shows them and `--key` can override.
 */
export function projectKeyFor(name: string, taken: Set<string>): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^[0-9]+/, ""))
    .filter(Boolean);
  const candidates = [
    words.length > 1 ? words.map((w) => w[0]).join("") : "",
    words.join("").slice(0, 4),
    words.join("").slice(0, 6),
    words[0]?.slice(0, 3) ?? "",
  ].filter((k) => /^[A-Z][A-Z0-9]{1,9}$/.test(k));
  const base = candidates.find((k) => !taken.has(k)) ?? candidates[0] ?? "PRJ";
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const k = `${base.slice(0, 8)}${i}`;
    if (!taken.has(k)) return k;
  }
  throw new Error(`No free project key for ${name}`);
}

const MAX_DESCRIPTION = 20_000;

/** The task description: ClickUp's markdown (or plain text), its checklists, and where it came from. */
export function descriptionOf(task: CuTask): string {
  const body = (task.markdown_description || task.text_content || task.description || "").trim();
  const checklists = (task.checklists ?? [])
    .map((c) =>
      [
        `**${c.name || "Checklist"}**`,
        ...(c.items ?? []).map((i) => `- [${i.resolved ? "x" : " "}] ${i.name}`),
      ].join("\n"),
    )
    .join("\n\n");
  const source = `Imported from ClickUp${task.custom_id ? ` (${task.custom_id})` : ""}: ${task.url ?? `task ${task.id}`}`;
  const parts = [body, checklists, `---\n${source}`].filter(Boolean);
  let text = parts.join("\n\n");
  if (text.length > MAX_DESCRIPTION) {
    const note = `\n\n…(shortened; full text in ClickUp)\n\n---\n${source}`;
    text = text.slice(0, MAX_DESCRIPTION - note.length) + note;
  }
  return text;
}

/** Attachments as one comment of links (files stay in ClickUp). */
export function attachmentsComment(task: CuTask): string | null {
  const files = (task.attachments ?? []).filter((a) => a.url);
  if (!files.length) return null;
  const lines = files.map((a) => {
    const size = Number(a.size);
    const kb = Number.isFinite(size) && size > 0 ? ` (${Math.max(1, Math.round(size / 1024))} KB)` : "";
    return `- ${a.title || "file"}${kb}: ${a.url}`;
  });
  return `Attachments from ClickUp:\n${lines.join("\n")}`.slice(0, 10_000);
}

/** A comment by someone with no Eightcore account (or imported as the importer). */
export function attributedComment(text: string, who: string | null, at: Date | null) {
  const when = at ? at.toISOString().slice(0, 10) : "";
  const head = who ? `**${who}**${when ? ` (${when})` : ""} in ClickUp:\n\n` : "";
  const body = (text || "").trim() || "(empty comment)";
  return (head + body).slice(0, 10_000);
}
