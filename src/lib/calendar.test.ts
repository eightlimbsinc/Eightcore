import { describe, expect, it } from "vitest";
import { addMonths, isIsoDate, isMonth, monthGrid, monthLabel, weekDays, weekLabel } from "./calendar";

describe("calendar", () => {
  it("lays out a month in Monday-to-Sunday weeks", () => {
    const weeks = monthGrid("2026-10"); // Oct 1, 2026 is a Thursday
    expect(weeks[0]).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(weeks.at(-1)!.at(-1)).toBe("2026-11-01");
    expect(weeks).toHaveLength(5);
    expect(monthGrid("2027-02")).toHaveLength(4); // Feb 2027 starts on a Monday, 28 days
  });

  it("moves between months and weeks, and validates input", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(weekDays("2026-10-21")[0]).toBe("2026-10-19");
    expect(isMonth("2026-13")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(weekLabel("2026-10-21")).toBe("Oct 19 – 25, 2026");
    expect(weekLabel("2026-10-01")).toBe("Sep 28 – Oct 4, 2026");
  });
});
