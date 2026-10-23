// Reading ClickUp CSV exports (pure functions: no database, easy to test).
import type { TaskPriority } from "@/modules/tasks/validators";

/** RFC 4180 CSV: quoted fields, "" for a quote inside quotes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** "Wednesday, August 5th 2026" (ClickUp's export format) → "2026-08-05"; "" → null. */
export function parseClickUpDate(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const match = /([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(v);
  if (!match) throw new Error(`Unrecognised date: "${value}"`);
  const month = MONTHS.indexOf(match[1]!.toLowerCase());
  if (month < 0) throw new Error(`Unrecognised month in "${value}"`);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCMonth() !== month) throw new Error(`Invalid date: "${value}"`);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** ClickUp priorities (URGENT/HIGH/NORMAL/LOW, "none" or blank). */
export function parseClickUpPriority(value: string): TaskPriority {
  const v = value.trim().toLowerCase();
  if (v === "urgent" || v === "high" || v === "normal" || v === "low") return v;
  return "none";
}

/** "[Nelfredo Bangkas, Edward caburnay]" → ["Nelfredo Bangkas", "Edward caburnay"]. */
export function parseClickUpPeople(value: string): string[] {
  return value
    .trim()
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ClickUpTaskRow {
  clickUpId: string;
  title: string;
  assignees: string[];
  dueDate: string | null;
  priority: TaskPriority;
  createdLabel: string;
}

/** The columns this import uses; any others in the file are ignored. */
const COLUMNS = {
  id: "Task ID",
  title: "Task Name",
  assignees: "Assignee",
  due: "Due Date",
  priority: "Priority",
  created: "Date Created",
};

export function readClickUpExport(text: string): { tasks: ClickUpTaskRow[]; ignoredColumns: string[] } {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error("The file is empty");
  const index = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const at = Object.fromEntries(Object.entries(COLUMNS).map(([k, name]) => [k, index(name)])) as Record<
    keyof typeof COLUMNS,
    number
  >;
  if (at.title < 0) throw new Error(`No "${COLUMNS.title}" column. Is this a ClickUp CSV export?`);
  const used = new Set(Object.values(at).filter((i) => i >= 0));
  const tasks = rows.map((r, n) => {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "") : "");
    const title = get(at.title).trim();
    if (!title) throw new Error(`Row ${n + 2} has no task name`);
    return {
      clickUpId: get(at.id).trim(),
      title: title.slice(0, 500),
      assignees: parseClickUpPeople(get(at.assignees)),
      dueDate: parseClickUpDate(get(at.due)),
      priority: parseClickUpPriority(get(at.priority)),
      createdLabel: get(at.created).trim(),
    };
  });
  return { tasks, ignoredColumns: header.filter((_, i) => !used.has(i)) };
}

/**
 * Finds a member for a ClickUp name: the exact full name (any case) first, otherwise the
 * only member whose name starts with it as a whole word ("Mark" → "Mark Reyes").
 */
export function matchPerson<T extends { name: string }>(name: string, people: T[]): T | undefined {
  const target = name.trim().toLowerCase();
  const exact = people.filter((p) => p.name.trim().toLowerCase() === target);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const prefix = people.filter((p) => p.name.trim().toLowerCase().startsWith(`${target} `));
  return prefix.length === 1 ? prefix[0] : undefined;
}
