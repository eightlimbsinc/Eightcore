// Time tracking: timer runs and manual entries on tasks.
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { tasks } from "@/modules/tasks/schema";
import { workspaces } from "@/modules/workspaces/schema";

/**
 * One block of time someone spent on a task. A running timer has `endedAt` null (at most
 * one per person); a stopped timer or a manual entry has a fixed `durationSeconds`.
 */
export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    /** Null while the timer runs. */
    endedAt: timestamp({ withTimezone: true }),
    /** Set when stopped (or entered by hand); 0 while running. */
    durationSeconds: integer().notNull().default(0),
    note: text().notNull().default(""),
    /** "timer" or "manual". */
    source: text().notNull().default("manual"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.taskId),
    index().on(t.workspaceId, t.userId, t.startedAt),
    // One running timer per person.
    uniqueIndex("time_entries_one_running_uq")
      .on(t.userId)
      .where(sql`${t.endedAt} is null`),
    check("time_entries_duration", sql`${t.durationSeconds} between 0 and 86400 * 7`),
    check("time_entries_source", sql`${t.source} in ('timer', 'manual')`),
    check("time_entries_note_length", sql`char_length(${t.note}) <= 500`),
  ],
);
