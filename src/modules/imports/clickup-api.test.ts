import { describe, expect, it } from "vitest";
import {
  attachmentsComment,
  dateOf,
  descriptionOf,
  estimateMinutes,
  fieldKind,
  fieldValue,
  normalizeColor,
  priorityOf,
  projectKeyFor,
  statusCategory,
} from "./clickup-api";

describe("ClickUp conversion", () => {
  it("maps statuses, colours, priorities and estimates", () => {
    expect(statusCategory({ status: "to do", type: "open" })).toBe("unstarted");
    expect(statusCategory({ status: "client review", type: "custom" })).toBe("review");
    expect(statusCategory({ status: "in development", type: "custom" })).toBe("active");
    expect(statusCategory({ status: "live", type: "done" })).toBe("done");
    expect(statusCategory({ status: "complete", type: "closed" })).toBe("closed");
    expect(statusCategory({ status: "cancelled", type: "custom" })).toBe("cancelled");
    expect(normalizeColor("#abc")).toBe("#AABBCC");
    expect(normalizeColor("#d3d3d3")).toBe("#D3D3D3");
    expect(normalizeColor(null, "#111111")).toBe("#111111");
    expect(priorityOf({ priority: { priority: "urgent" } })).toBe("urgent");
    expect(priorityOf({ priority: null })).toBe("none");
    expect(estimateMinutes(5_400_000)).toBe(90);
    expect(estimateMinutes(null)).toBeNull();
  });

  it("reads dates in the team's time zone", () => {
    const ms = String(Date.UTC(2026, 10, 5, 20, 0)); // 5 Nov 20:00 UTC = 6 Nov in Manila
    expect(dateOf(ms, "Asia/Manila")).toBe("2026-11-06");
    expect(dateOf(ms, "UTC")).toBe("2026-11-05");
    expect(dateOf(null, "UTC")).toBeNull();
  });

  it("converts custom field values", () => {
    const ctx = {
      timeZone: "UTC",
      options: new Map([["opt-b", "eight-b"]]),
      people: new Map([[7, "user-7"]]),
    };
    const options = [
      { id: "opt-a", name: "A", orderindex: 0 },
      { id: "opt-b", name: "B", orderindex: 1 },
    ];
    expect(
      fieldValue({ id: "f", name: "x", type: "drop_down", type_config: { options }, value: 1 }, ctx),
    ).toBe("eight-b");
    expect(
      fieldValue({ id: "f", name: "x", type: "drop_down", type_config: { options }, value: "opt-b" }, ctx),
    ).toBe("eight-b");
    expect(
      fieldValue(
        { id: "f", name: "x", type: "labels", type_config: { options }, value: ["opt-a", "opt-b"] },
        ctx,
      ),
    ).toBe("A, B");
    expect(fieldValue({ id: "f", name: "x", type: "users", value: [{ id: 7 }, { id: 8 }] }, ctx)).toBe(
      "user-7",
    );
    expect(fieldValue({ id: "f", name: "x", type: "checkbox", value: "true" }, ctx)).toBe("on");
    expect(fieldValue({ id: "f", name: "x", type: "currency", value: "12.5" }, ctx)).toBe("12.5");
    expect(fieldValue({ id: "f", name: "x", type: "short_text", value: "hi" }, ctx)).toBe("hi");
    expect(fieldValue({ id: "f", name: "x", type: "text", value: null }, ctx)).toBeNull();
    expect(fieldKind("formula")?.lossy).toMatch(/text/);
    expect(fieldKind("button")).toBeNull();
  });

  it("picks project keys that start with a letter and aren't taken", () => {
    expect(projectKeyFor("8limbs INC", new Set())).toBe("LI");
    expect(projectKeyFor("Blend 360", new Set())).toBe("BLEN");
    expect(projectKeyFor("8limbs FC", new Set(["LF"]))).toBe("LIMB");
    expect(projectKeyFor("Web", new Set(["WEB"]))).toBe("WEB2");
  });

  it("builds descriptions and attachment links", () => {
    const d = descriptionOf({
      id: "abc",
      name: "x",
      status: { status: "open", type: "open" },
      text_content: "Hello",
      checklists: [{ name: "QA", items: [{ name: "Mobile", resolved: true }, { name: "Desktop" }] }],
      url: "https://app.clickup.com/t/abc",
    });
    expect(d).toContain("Hello");
    expect(d).toContain("- [x] Mobile");
    expect(d).toContain("Imported from ClickUp: https://app.clickup.com/t/abc");
    expect(
      descriptionOf({
        id: "a",
        name: "x",
        status: { status: "o", type: "open" },
        text_content: "y".repeat(30_000),
      }).length,
    ).toBeLessThanOrEqual(20_000);
    expect(
      attachmentsComment({
        id: "a",
        name: "x",
        status: { status: "o", type: "open" },
        attachments: [{ title: "brief.pdf", url: "https://x/y", size: 2048 }],
      }),
    ).toBe("Attachments from ClickUp:\n- brief.pdf (2 KB): https://x/y");
  });
});
