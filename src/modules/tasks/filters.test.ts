import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTER,
  dueRange,
  filterQuery,
  isFiltering,
  matchesFilter,
  readFilter,
  weekOf,
  type FilterableTask,
} from "./filters";

const task = (over: Partial<FilterableTask> = {}): FilterableTask => ({
  title: "Homepage hero",
  ref: "WEB-1",
  priority: "none",
  dueDate: null,
  completed: false,
  closed: false,
  assigneeIds: [],
  tagNames: [],
  openBlockers: 0,
  ...over,
});
const ctx = { userId: "u-me", today: "2026-10-21" }; // a Wednesday

describe("task filters", () => {
  it("reads and writes the address bar, ignoring junk", () => {
    const f = readFilter({
      assignee: "me,none,not-an-id",
      priority: "high,bogus",
      due: "overdue",
      q: " hero ",
      state: "open",
    });
    expect(f).toEqual({
      ...EMPTY_FILTER,
      assignees: ["me", "none"],
      priorities: ["high"],
      due: ["overdue"],
      q: "hero",
      state: "open",
    });
    expect(filterQuery(f).toString()).toBe("assignee=me%2Cnone&priority=high&due=overdue&q=hero&state=open");
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
    // Defaults (a saved view) apply until the address bar says otherwise.
    expect(readFilter({}, { priorities: ["low"] }).priorities).toEqual(["low"]);
    expect(readFilter({ priority: "" }, { priorities: ["low"] }).priorities).toEqual([]);
  });

  it("computes weeks Monday to Sunday", () => {
    expect(weekOf("2026-10-21")).toEqual(["2026-10-19", "2026-10-25"]);
    expect(weekOf("2026-10-25")).toEqual(["2026-10-19", "2026-10-25"]);
    expect(dueRange("next_week", "2026-10-21")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(dueRange("overdue", "2026-11-01")).toEqual({ to: "2026-10-31" });
  });

  it("matches assignees, priorities, tags, due dates, text and state", () => {
    const f = (over: Partial<typeof EMPTY_FILTER>) => ({ ...EMPTY_FILTER, ...over });
    expect(matchesFilter(task({ assigneeIds: ["u-me"] }), f({ assignees: ["me"] }), ctx)).toBe(true);
    expect(matchesFilter(task(), f({ assignees: ["none"] }), ctx)).toBe(true);
    expect(matchesFilter(task({ assigneeIds: ["x"] }), f({ assignees: ["me"] }), ctx)).toBe(false);
    expect(matchesFilter(task({ priority: "high" }), f({ priorities: ["high", "urgent"] }), ctx)).toBe(true);
    expect(matchesFilter(task({ tagNames: ["Bug"] }), f({ tags: ["bug"] }), ctx)).toBe(true);
    expect(matchesFilter(task({ dueDate: "2026-10-20" }), f({ due: ["overdue"] }), ctx)).toBe(true);
    expect(matchesFilter(task({ dueDate: "2026-10-20", closed: true }), f({ due: ["overdue"] }), ctx)).toBe(
      false,
    );
    expect(matchesFilter(task({ dueDate: "2026-10-24" }), f({ due: ["week"] }), ctx)).toBe(true);
    expect(matchesFilter(task(), f({ due: ["none"] }), ctx)).toBe(true);
    expect(matchesFilter(task(), f({ q: "hero home" }), ctx)).toBe(true);
    expect(matchesFilter(task(), f({ q: "web-1" }), ctx)).toBe(true);
    expect(matchesFilter(task({ closed: true }), f({ state: "open" }), ctx)).toBe(false);
    expect(matchesFilter(task({ openBlockers: 1 }), f({ blocked: true }), ctx)).toBe(true);
  });
});
