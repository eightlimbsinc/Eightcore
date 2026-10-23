// Calendar arithmetic on "YYYY-MM-DD" strings (dates only, no time zones). Weeks start Monday.
import { addDays, weekOf } from "@/modules/tasks/filters";

export { addDays, weekOf };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_RE.test(value);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

/** "2026-10" → "2026-11" (or -1). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return date.toISOString().slice(0, 7);
}

/** The Monday-to-Sunday weeks covering a month (4 to 6 rows of 7 dates). */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  const weeks: string[][] = [];
  let monday = weekOf(first)[0];
  while (monday <= last) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(monday, i)));
    monday = addDays(monday, 7);
  }
  return weeks;
}

/** The 7 dates of the week containing `date`. */
export function weekDays(date: string): string[] {
  const monday = weekOf(date)[0];
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function monthLabel(month: string): string {
  return monthFormat.format(utc(`${month}-01`));
}

/** "Oct 19 – 25, 2026" or "Sep 28 – Oct 4, 2026". */
export function weekLabel(date: string): string {
  const [monday, sunday] = weekOf(date);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  const end = sameMonth ? String(Number(sunday.slice(8))) : dayFormat.format(utc(sunday));
  return `${dayFormat.format(utc(monday))} – ${end}, ${sunday.slice(0, 4)}`;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
