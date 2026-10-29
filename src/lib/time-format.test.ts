import { describe, expect, it } from "vitest";
import { formatClock, formatMinutes, parseDuration } from "./time-format";

describe("parseDuration", () => {
  it("understands the usual ways of writing time", () => {
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("90m")).toBe(90);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("2 hours")).toBe(120);
    expect(parseDuration("45 min")).toBe(45);
    expect(parseDuration("1d")).toBe(480);
    expect(parseDuration(" 3H15M ")).toBe(195);
  });

  it("refuses anything it can't read", () => {
    for (const bad of ["", "soon", "1h banana", "1:75", "-5", "h"]) expect(parseDuration(bad)).toBeNull();
  });
});

describe("formatting", () => {
  it("shows minutes as hours and minutes", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(95)).toBe("1h 35m");
    expect(formatMinutes(62 * 60 + 35)).toBe("62h 35m");
  });

  it("shows a running timer as a clock", () => {
    expect(formatClock(0)).toBe("0:00:00");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});
