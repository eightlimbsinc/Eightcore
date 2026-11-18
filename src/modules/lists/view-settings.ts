import { z } from "zod";

/** How a list is shown. The saved view is everyone's default; the address bar can override it. */
export const viewSettingsSchema = z.object({
  /** Status groups first-to-last ("asc") or last-to-first ("desc"). */
  order: z.enum(["asc", "desc"]).catch("asc"),
  /**
   * Subtasks start collapsed under their parent, expanded, or "separate": each subtask is its
   * own row under its own status (so filters match subtasks directly), as in ClickUp.
   */
  subtasks: z.enum(["collapsed", "expanded", "separate"]).catch("collapsed"),
  /** Show or hide the groups of "closed" statuses (e.g. Completed). Hidden by default. */
  closed: z.enum(["show", "hide"]).catch("hide"),
  /** Saved filters, as an address-bar query ("priority=high&assignee=me"). */
  filters: z.string().max(2000).catch(""),
  /** Order of the view tabs (List, Board, Calendar, form ids); missing ones go at the end. */
  tabs: z.array(z.string().max(64)).max(50).catch([]),
});
export type ViewSettings = z.infer<typeof viewSettingsSchema>;

export const DEFAULT_VIEW: ViewSettings = {
  order: "asc",
  subtasks: "collapsed",
  closed: "hide",
  filters: "",
  tabs: [],
};

/** Stored JSON → settings, falling back to defaults for anything missing or unknown. */
export function readViewSettings(stored: unknown): ViewSettings {
  return viewSettingsSchema.parse({
    ...DEFAULT_VIEW,
    ...(stored && typeof stored === "object" ? stored : {}),
  });
}

/** The view to show: the saved one, with anything set in the address bar on top. */
export function effectiveView(
  saved: ViewSettings,
  params: Record<string, string | string[] | undefined>,
): ViewSettings {
  const pick = (key: keyof ViewSettings) => (typeof params[key] === "string" ? params[key] : undefined);
  return viewSettingsSchema.parse({
    order: pick("order") ?? saved.order,
    subtasks: pick("subtasks") ?? saved.subtasks,
    closed: pick("closed") ?? saved.closed,
    filters: saved.filters,
    tabs: saved.tabs,
  });
}

export function sameView(a: ViewSettings, b: ViewSettings): boolean {
  return a.order === b.order && a.subtasks === b.subtasks && a.closed === b.closed;
}

/** Address-bar query for `view`, listing only what differs from the saved view (plus `extra`). */
export function viewQuery(view: ViewSettings, saved: ViewSettings, extra = ""): string {
  const params = new URLSearchParams(extra);
  for (const key of ["order", "subtasks", "closed"] as const) {
    if (view[key] !== saved[key]) params.set(key, view[key]);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** `keys` in the saved tab order; keys it doesn't name keep their order after those it does. */
export function orderTabs<T extends string>(keys: T[], saved: string[]): T[] {
  const rank = (k: string) => {
    const i = saved.indexOf(k);
    return i < 0 ? saved.length + keys.indexOf(k as T) : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b));
}
