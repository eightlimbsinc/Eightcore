// Task filters: one model for the list view, the workspace Tasks page and dashboard links.
// Filters live in the address bar (shareable) and can be saved in a list's view.
import { TASK_PRIORITIES, type TaskPriority } from "./validators";

export const DUE_FILTERS = ["overdue", "today", "week", "next_week", "later", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export const DUE_FILTER_LABELS: Record<DueFilter, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "Due this week",
  next_week: "Due next week",
  later: "Due later",
  none: "No due date",
};

export const STATE_FILTERS = ["open", "closed", "all"] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];

export interface TaskFilter {
  /** "me", "none" (unassigned) or user ids. Any of them matches. */
  assignees: string[];
  priorities: TaskPriority[];
  due: DueFilter[];
  /** Tag names, case-insensitive. Any of them matches. */
  tags: string[];
  /** Words in the title (or the task's reference, e.g. "B3-14"). */
  q: string;
  /** Open (not done/cancelled/closed) tasks, finished ones, or both. */
  state: StateFilter;
  /** Only tasks blocked by unfinished tasks. */
  blocked: boolean;
}

export const EMPTY_FILTER: TaskFilter = {
  assignees: [],
  priorities: [],
  due: [],
  tags: [],
  q: "",
  state: "all",
  blocked: false,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Record<string, string | string[] | undefined>;

function list(params: Params, key: string): string[] {
  const raw = params[key];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return [
    ...new Set(
      values
        .flatMap((v) => v.split(","))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

/** Reads filters from the address bar (or a saved view), dropping anything unknown. */
export function readFilter(params: Params, defaults: Partial<TaskFilter> = {}): TaskFilter {
  const base = { ...EMPTY_FILTER, ...defaults };
  const has = (key: string) => params[key] !== undefined;
  const state = typeof params.state === "string" ? params.state : undefined;
  return {
    assignees: has("assignee")
      ? list(params, "assignee")
          .filter((a) => a === "me" || a === "none" || UUID_RE.test(a))
          .slice(0, 20)
      : base.assignees,
    priorities: has("priority")
      ? (list(params, "priority").filter((p) =>
          (TASK_PRIORITIES as readonly string[]).includes(p),
        ) as TaskPriority[])
      : base.priorities,
    due: has("due")
      ? (list(params, "due").filter((d) => (DUE_FILTERS as readonly string[]).includes(d)) as DueFilter[])
      : base.due,
    tags: has("tag")
      ? list(params, "tag")
          .map((t) => t.slice(0, 40))
          .slice(0, 20)
      : base.tags,
    q: typeof params.q === "string" ? params.q.trim().slice(0, 100) : base.q,
    state:
      state && (STATE_FILTERS as readonly string[]).includes(state) ? (state as StateFilter) : base.state,
    blocked: has("blocked") ? params.blocked === "1" : base.blocked,
  };
}

/** Address-bar query for a filter (only what differs from `defaults`). */
export function filterQuery(filter: TaskFilter, defaults: Partial<TaskFilter> = {}): URLSearchParams {
  const base = { ...EMPTY_FILTER, ...defaults };
  const params = new URLSearchParams();
  const setList = (key: string, value: string[], baseValue: string[]) => {
    if (value.join(",") !== baseValue.join(",")) params.set(key, value.join(","));
  };
  setList("assignee", filter.assignees, base.assignees);
  setList("priority", filter.priorities, base.priorities);
  setList("due", filter.due, base.due);
  setList("tag", filter.tags, base.tags);
  if (filter.q !== base.q) params.set("q", filter.q);
  if (filter.state !== base.state) params.set("state", filter.state);
  if (filter.blocked !== base.blocked) params.set("blocked", filter.blocked ? "1" : "0");
  return params;
}

export function isFiltering(filter: TaskFilter): boolean {
  return (
    filter.assignees.length > 0 ||
    filter.priorities.length > 0 ||
    filter.due.length > 0 ||
    filter.tags.length > 0 ||
    filter.q !== "" ||
    filter.state !== "all" ||
    filter.blocked
  );
}

/** Calendar arithmetic on "YYYY-MM-DD" strings (no time zones involved). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}

/** Monday-to-Sunday week containing `today`: [monday, sunday]. */
export function weekOf(today: string): [string, string] {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -weekday);
  return [monday, addDays(monday, 6)];
}

/** Date ranges for the due filters, relative to `today`. */
export function dueRange(due: DueFilter, today: string): { from?: string; to?: string; none?: true } {
  const [monday, sunday] = weekOf(today);
  switch (due) {
    case "overdue":
      return { to: addDays(today, -1) };
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: monday, to: sunday };
    case "next_week":
      return { from: addDays(monday, 7), to: addDays(sunday, 7) };
    case "later":
      return { from: addDays(sunday, 8) };
    case "none":
      return { none: true };
  }
}

export interface FilterableTask {
  title: string;
  ref: string;
  priority: TaskPriority;
  dueDate: string | null;
  completed: boolean;
  closed: boolean;
  assigneeIds: string[];
  tagNames: string[];
  openBlockers: number;
}

/** In-memory version of the filter (the list view), matching the SQL version's rules. */
export function matchesFilter(
  task: FilterableTask,
  filter: TaskFilter,
  ctx: { userId: string; today: string },
): boolean {
  if (filter.state === "open" && task.closed) return false;
  if (filter.state === "closed" && !task.closed) return false;
  if (filter.blocked && task.openBlockers === 0) return false;
  if (filter.priorities.length && !filter.priorities.includes(task.priority)) return false;
  if (filter.assignees.length) {
    const ok = filter.assignees.some((a) =>
      a === "none" ? task.assigneeIds.length === 0 : task.assigneeIds.includes(a === "me" ? ctx.userId : a),
    );
    if (!ok) return false;
  }
  if (filter.tags.length) {
    const names = task.tagNames.map((n) => n.toLowerCase());
    if (!filter.tags.some((t) => names.includes(t.toLowerCase()))) return false;
  }
  if (filter.due.length) {
    const ok = filter.due.some((d) => {
      const range = dueRange(d, ctx.today);
      if (range.none) return task.dueDate === null;
      if (!task.dueDate) return false;
      // "Overdue" only counts unfinished tasks.
      if (d === "overdue" && task.closed) return false;
      return (!range.from || task.dueDate >= range.from) && (!range.to || task.dueDate <= range.to);
    });
    if (!ok) return false;
  }
  if (filter.q) {
    const words = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = `${task.ref} ${task.title}`.toLowerCase();
    if (!words.every((w) => haystack.includes(w))) return false;
  }
  return true;
}
