import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  effectiveView,
  orderTabs,
  readViewSettings,
  sameView,
  viewQuery,
} from "./view-settings";

describe("list view settings", () => {
  it("reads stored settings safely", () => {
    expect(readViewSettings(null)).toEqual(DEFAULT_VIEW);
    expect(readViewSettings({ order: "desc", closed: "nonsense", extra: 1 })).toEqual({
      order: "desc",
      subtasks: "collapsed",
      closed: "hide",
      filters: "",
      tabs: [],
    });
  });

  it("lets the address bar override the saved view, and only links the differences", () => {
    const saved = readViewSettings({ order: "desc" });
    const view = effectiveView(saved, { subtasks: "expanded", order: "bogus" });
    expect(view).toEqual({ order: "asc", subtasks: "expanded", closed: "hide", filters: "", tabs: [] });
    expect(sameView(view, saved)).toBe(false);
    expect(viewQuery(view, saved)).toBe("?order=asc&subtasks=expanded");
    expect(viewQuery(saved, saved)).toBe("");
    expect(viewQuery(view, saved, "priority=high")).toBe("?priority=high&order=asc&subtasks=expanded");
  });
});

describe("separate subtasks", () => {
  it("is a saved and address-bar option", () => {
    expect(readViewSettings({ subtasks: "separate" }).subtasks).toBe("separate");
    expect(effectiveView(DEFAULT_VIEW, { subtasks: "separate" }).subtasks).toBe("separate");
    expect(readViewSettings({ subtasks: "sideways" }).subtasks).toBe("collapsed");
  });
});

describe("orderTabs", () => {
  it("follows the saved order; tabs it doesn't name keep their order at the end", () => {
    expect(orderTabs(["list", "board", "calendar", "f1", "f2"], ["calendar", "f2", "gone"])).toEqual([
      "calendar",
      "f2",
      "list",
      "board",
      "f1",
    ]);
    expect(orderTabs(["list", "board"], [])).toEqual(["list", "board"]);
  });
});
