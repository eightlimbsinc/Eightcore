import { describe, expect, it } from "vitest";
import { describeActivity, dueState, formatDate, todayIso } from "./task-format";

describe("formatDate", () => {
  it("omits the year for the current year and keeps the calendar day", () => {
    const today = new Date(2026, 9, 23);
    expect(formatDate("2026-11-30", today)).toBe("Nov 30");
    expect(formatDate("2027-01-02", today)).toBe("Jan 2, 2027");
  });
});

describe("dueState", () => {
  it("classifies due dates", () => {
    expect(dueState(null, false, "2026-10-23")).toBe("none");
    expect(dueState("2026-10-22", false, "2026-10-23")).toBe("overdue");
    expect(dueState("2026-10-23", false, "2026-10-23")).toBe("today");
    expect(dueState("2026-10-24", false, "2026-10-23")).toBe("upcoming");
    expect(dueState("2026-10-22", true, "2026-10-23")).toBe("done");
  });

  it("formats today as a local calendar date", () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("describeActivity", () => {
  it("describes field changes in plain words", () => {
    expect(
      describeActivity({
        action: "updated",
        changes: { status: ["To Do", "Done"], priority: ["none", "high"], dueDate: [null, "2026-11-30"] },
        metadata: {},
      }),
    ).toEqual([
      "changed status from To Do to Done",
      "changed priority from No priority to High",
      expect.stringMatching(/^changed due date from none to Nov 30/),
    ]);
  });

  it("names assignees when known", () => {
    expect(
      describeActivity(
        { action: "assignees_changed", changes: {}, metadata: { added: ["u1"], removed: ["u2"] } },
        new Map([
          ["u1", "Ada"],
          ["u2", "Grace"],
        ]),
      ),
    ).toEqual(["assigned Ada", "unassigned Grace"]);
  });
});
