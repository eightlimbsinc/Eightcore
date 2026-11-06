import { z } from "zod";

/**
 * How a task repeats. Dates are calendar dates (YYYY-MM-DD), like due dates.
 * - daily: every `interval` days (`weekdaysOnly` skips Saturday and Sunday)
 * - weekly: every `interval` weeks, on `weekdays` (0 = Sunday … 6 = Saturday)
 * - monthly: every `interval` months on the same day (clamped to the month's last day)
 * - yearly: every `interval` years on the same date
 */
export const recurrenceSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(365).default(1),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  weekdaysOnly: z.boolean().default(false),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parse(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}
function iso(y: number, m: number, d: number) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Day of the week for a calendar date (0 = Sunday), without time zones. */
function weekday(date: string) {
  const { y, m, d } = parse(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function addDaysIso(date: string, days: number) {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** Same day `months` later, clamped (Jan 31 + 1 month = Feb 28/29). */
function addMonthsIso(date: string, months: number, day = parse(date).d) {
  const { y, m } = parse(date);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return iso(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}
/** Whole days from a to b. */
export function daysBetween(a: string, b: string) {
  const pa = parse(a);
  const pb = parse(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** The next occurrence strictly after `from`. */
export function nextOccurrence(rule: Recurrence, from: string): string {
  const r = recurrenceSchema.parse(rule);
  switch (r.freq) {
    case "daily": {
      let next = addDaysIso(from, r.interval);
      if (r.weekdaysOnly) while ([0, 6].includes(weekday(next))) next = addDaysIso(next, 1);
      return next;
    }
    case "weekly": {
      const days = r.weekdays.length ? [...new Set(r.weekdays)].sort() : [weekday(from)];
      // Later this week (same week as `from`)?
      const today = weekday(from);
      const later = days.find((d) => d > today);
      if (later !== undefined) return addDaysIso(from, later - today);
      // Otherwise the first chosen day, `interval` weeks on (counting from this week's Sunday).
      const sunday = addDaysIso(from, -today);
      return addDaysIso(sunday, 7 * r.interval + days[0]!);
    }
    case "monthly":
      return addMonthsIso(from, r.interval);
    case "yearly":
      return addMonthsIso(from, 12 * r.interval);
  }
}

/** "Every week on Mon, Thu", "Every 2 months", "Every weekday". */
export function describeRecurrence(rule: Recurrence): string {
  const r = recurrenceSchema.parse(rule);
  const every = (unit: string) => (r.interval === 1 ? `Every ${unit}` : `Every ${r.interval} ${unit}s`);
  switch (r.freq) {
    case "daily":
      return r.weekdaysOnly && r.interval === 1 ? "Every weekday" : every("day");
    case "weekly": {
      const days = [...new Set(r.weekdays)].sort().map((d) => DAY_NAMES[d]);
      return days.length ? `${every("week")} on ${days.join(", ")}` : every("week");
    }
    case "monthly":
      return every("month");
    case "yearly":
      return every("year");
  }
}

/** Stored JSON → rule, or null when absent or unreadable. */
export function readRecurrence(value: unknown): Recurrence | null {
  const parsed = recurrenceSchema.safeParse(value);
  return value && parsed.success ? parsed.data : null;
}
