import { describe, expect, it } from "vitest";
import { dateIn } from "./today";

describe("viewer's today", () => {
  it("uses the viewer's time zone, falling back to UTC", () => {
    const now = new Date("2026-10-23T20:30:00Z");
    expect(dateIn("Asia/Manila", now)).toBe("2026-10-24");
    expect(dateIn("America/New_York", now)).toBe("2026-10-23");
    expect(dateIn("Not/AZone", now)).toBe("2026-10-23");
    expect(dateIn(undefined, now)).toBe("2026-10-23");
  });
});
