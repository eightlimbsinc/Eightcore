import { describe, expect, it } from "vitest";
import { describeRecurrence, nextOccurrence, readRecurrence } from "./recurrence";

const rule = (r: Record<string, unknown>) => readRecurrence(r)!;

describe("nextOccurrence", () => {
  it("steps days, skipping weekends when asked", () => {
    expect(nextOccurrence(rule({ freq: "daily" }), "2026-11-06")).toBe("2026-11-07");
    expect(nextOccurrence(rule({ freq: "daily", interval: 3 }), "2026-11-06")).toBe("2026-11-09");
    // Friday → Monday
    expect(nextOccurrence(rule({ freq: "daily", weekdaysOnly: true }), "2026-11-06")).toBe("2026-11-09");
  });

  it("repeats weekly on chosen days, and every N weeks", () => {
    // 2026-11-06 is a Friday.
    expect(nextOccurrence(rule({ freq: "weekly" }), "2026-11-06")).toBe("2026-11-13");
    expect(nextOccurrence(rule({ freq: "weekly", weekdays: [1, 4] }), "2026-11-02")).toBe("2026-11-05"); // Mon → Thu
    expect(nextOccurrence(rule({ freq: "weekly", weekdays: [1, 4] }), "2026-11-05")).toBe("2026-11-09"); // Thu → next Mon
    expect(nextOccurrence(rule({ freq: "weekly", interval: 2, weekdays: [1] }), "2026-11-02")).toBe(
      "2026-11-16",
    );
    expect(nextOccurrence(rule({ freq: "weekly", interval: 2 }), "2026-11-06")).toBe("2026-11-20");
  });

  it("keeps the day of the month, clamped at month end", () => {
    expect(nextOccurrence(rule({ freq: "monthly" }), "2026-11-15")).toBe("2026-12-15");
    expect(nextOccurrence(rule({ freq: "monthly" }), "2027-01-31")).toBe("2027-02-28");
    expect(nextOccurrence(rule({ freq: "monthly", interval: 3 }), "2026-11-30")).toBe("2027-02-28");
    expect(nextOccurrence(rule({ freq: "monthly" }), "2027-12-10")).toBe("2028-01-10");
    expect(nextOccurrence(rule({ freq: "yearly" }), "2028-02-29")).toBe("2029-02-28");
  });
});

describe("describeRecurrence", () => {
  it("reads like a person would say it", () => {
    expect(describeRecurrence(rule({ freq: "daily", weekdaysOnly: true }))).toBe("Every weekday");
    expect(describeRecurrence(rule({ freq: "weekly", weekdays: [4, 1] }))).toBe("Every week on Mon, Thu");
    expect(describeRecurrence(rule({ freq: "weekly", interval: 2 }))).toBe("Every 2 weeks");
    expect(describeRecurrence(rule({ freq: "monthly" }))).toBe("Every month");
  });

  it("ignores missing or broken stored rules", () => {
    expect(readRecurrence(null)).toBeNull();
    expect(readRecurrence({ freq: "hourly" })).toBeNull();
  });
});
