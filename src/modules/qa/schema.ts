// QA rounds on tasks: pending → pass or fail, with notes and evidence (attachments.qa_cycle_id).
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { tasks } from "@/modules/tasks/schema";
import { workspaces } from "@/modules/workspaces/schema";

/**
 * One QA round on a task (#1, #2… per task). Locked once concluded: a database trigger
 * refuses updates when `result` is no longer "pending"; a retest is a new round.
 */
export const qaCycles = pgTable(
  "qa_cycles",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid().notNull(),
    cycleNumber: integer().notNull(),
    /** "pending", "pass" or "fail". */
    result: text().notNull().default("pending"),
    environmentUrl: text().notNull().default(""),
    buildRef: text().notNull().default(""),
    /** The tester's notes (required when failing). */
    summary: text().notNull().default(""),
    startedBy: uuid()
      .notNull()
      .references(() => users.id),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    concludedBy: uuid().references(() => users.id),
    concludedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "qa_cycles_task_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }).onDelete("cascade"),
    unique("qa_cycles_task_number_uq").on(t.taskId, t.cycleNumber),
    // Composite key target for evidence (attachments.qa_cycle_id must be this task's round).
    unique("qa_cycles_id_task_uq").on(t.id, t.taskId),
    check("qa_cycles_result", sql`${t.result} in ('pending', 'pass', 'fail')`),
    check("qa_cycles_concluded", sql`(${t.result} = 'pending') = (${t.concludedAt} is null)`),
    check(
      "qa_cycles_lengths",
      sql`char_length(${t.summary}) <= 10000 and char_length(${t.environmentUrl}) <= 2000 and char_length(${t.buildRef}) <= 200`,
    ),
    index().on(t.workspaceId, t.concludedAt),
  ],
);
