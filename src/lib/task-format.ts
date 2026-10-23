// Pure display helpers for tasks (shared by server and client components).

export const PRIORITY_META = {
  urgent: { label: "Urgent", tone: "text-[#EF4444]" },
  high: { label: "High", tone: "text-[#F59E0B]" },
  normal: { label: "Normal", tone: "text-[#3B82F6]" },
  low: { label: "Low", tone: "text-muted-foreground" },
  none: { label: "No priority", tone: "text-muted-foreground/60" },
} as const;

export type Priority = keyof typeof PRIORITY_META;

/** "2026-11-30" → "Nov 30" (this year) or "Nov 30, 2027". Date-only: no time-zone shifts. */
export function formatDate(isoDate: string, today = new Date()): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: y === today.getFullYear() ? undefined : "numeric",
    timeZone: "UTC",
  });
}

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function dueState(
  dueDate: string | null,
  completed: boolean,
  today = todayIso(),
): "none" | "overdue" | "today" | "upcoming" | "done" {
  if (!dueDate) return "none";
  if (completed) return "done";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return "upcoming";
}

type Change = [unknown, unknown];
const FIELD_LABELS: Record<string, string> = {
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  startDate: "start date",
  dueDate: "due date",
};

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (field === "priority") return PRIORITY_META[value as Priority]?.label ?? String(value);
  if (field === "startDate" || field === "dueDate") return formatDate(String(value));
  return String(value);
}

/** Human-readable lines for one activity event. */
export function describeActivity(
  event: { action: string; changes: Record<string, Change>; metadata: Record<string, unknown> },
  names: Map<string, string> = new Map(),
): string[] {
  switch (event.action) {
    case "created":
      return event.metadata.parentTaskId ? ["created this subtask"] : ["created this task"];
    case "archived":
      return ["archived this task"];
    case "restored":
      return ["restored this task"];
    case "assignees_changed": {
      const who = (ids: unknown) =>
        Array.isArray(ids) ? ids.map((id) => names.get(String(id)) ?? "someone") : [];
      const added = who(event.metadata.added);
      const removed = who(event.metadata.removed);
      return [
        ...(added.length ? [`assigned ${added.join(", ")}`] : []),
        ...(removed.length ? [`unassigned ${removed.join(", ")}`] : []),
      ];
    }
    case "updated":
      return Object.entries(event.changes).map(([field, [from, to]]) => {
        const label = FIELD_LABELS[field] ?? field;
        if (field === "description") return "updated the description";
        if (field === "title") return `renamed the task to “${show(field, to)}”`;
        return `changed ${label} from ${show(field, from)} to ${show(field, to)}`;
      });
    case "commented":
      return ["commented"];
    case "replied":
      return ["replied to a comment"];
    case "comment_deleted":
      return ["deleted a comment"];
    case "tags_changed": {
      const list = (v: unknown) => (Array.isArray(v) ? v.map((n) => `“${String(n)}”`) : []);
      const added = list(event.metadata.added);
      const removed = list(event.metadata.removed);
      return [
        ...(added.length ? [`added the tag${added.length > 1 ? "s" : ""} ${added.join(", ")}`] : []),
        ...(removed.length ? [`removed the tag${removed.length > 1 ? "s" : ""} ${removed.join(", ")}`] : []),
      ];
    }
    case "attachments_added": {
      const files = Array.isArray(event.metadata.names) ? event.metadata.names.map(String) : [];
      return [files.length === 1 ? `attached “${files[0]}”` : `attached ${files.length} files`];
    }
    case "dependency_added":
      return [
        `linked ${String(event.metadata.blocked ?? "")} as blocked by ${String(event.metadata.blocking ?? "")}`,
      ];
    case "dependency_removed":
      return [
        `unlinked ${String(event.metadata.blocked ?? "")} from ${String(event.metadata.blocking ?? "")}`,
      ];
    case "fields_changed": {
      const fields = Array.isArray(event.metadata.fields)
        ? event.metadata.fields.map((f) => `“${String(f)}”`)
        : [];
      return [`updated ${fields.length === 1 ? "the field" : "the fields"} ${fields.join(", ")}`];
    }
    case "attachment_removed":
      return [`removed the file “${String(event.metadata.name ?? "")}”`];
    default:
      return [event.action.replace(/_/g, " ")];
  }
}
