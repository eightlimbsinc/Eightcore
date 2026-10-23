import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, effectiveView, readViewSettings, sameView, viewQuery } from "./view-settings";

describe("list view settings", () => {
  it("reads stored settings safely", () => {
    expect(readViewSettings(null)).toEqual(DEFAULT_VIEW);
    expect(readViewSettings({ order: "desc", closed: "nonsense", extra: 1 })).toEqual({
      order: "desc",
      subtasks: "collapsed",
      closed: "show",
    });
  });

  it("lets the address bar override the saved view, and only links the differences", () => {
    const saved = readViewSettings({ order: "desc" });
    const view = effectiveView(saved, { subtasks: "expanded", order: "bogus" });
    expect(view).toEqual({ order: "asc", subtasks: "expanded", closed: "show" });
    expect(sameView(view, saved)).toBe(false);
    expect(viewQuery(view, saved)).toBe("?order=asc&subtasks=expanded");
    expect(viewQuery(saved, saved)).toBe("");
  });
});
