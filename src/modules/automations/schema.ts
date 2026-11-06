// Automations (when → if → then, per project) and their run log.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { projects } from "@/modules/projects/schema";
import { taskLists } from "@/modules/lists/schema";
import { tasks } from "@/modules/tasks/schema";
import { workspaces } from "@/modules/workspaces/schema";

/**
 * A rule: when `trigger` happens to a task in the project (or one list), and every condition
 * holds, run the actions in order. Actions run with the permissions of whoever created it.
 */
export const automations = pgTable(
  "automations",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid().notNull(),
    /** Null: every list in the project. */
    listId: uuid(),
    name: text().notNull(),
    enabled: boolean().notNull().default(true),
    trigger: jsonb().$type<Record<string, unknown>>().notNull(),
    conditions: jsonb().$type<Record<string, unknown>[]>().notNull().default([]),
    actions: jsonb().$type<Record<string, unknown>[]>().notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "automations_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "automations_list_fk",
      columns: [t.listId, t.projectId],
      foreignColumns: [taskLists.id, taskLists.projectId],
    }).onDelete("cascade"),
    check("automations_name_length", sql`char_length(${t.name}) between 1 and 120`),
    index().on(t.projectId, t.enabled),
  ],
);

/** One evaluation of an automation for one event: what it did, or why not. */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    automationId: uuid()
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    taskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    outboxEventId: bigint({ mode: "number" }).notNull(),
    /** "success", "failed" or "skipped" (e.g. the loop guard). */
    status: text().notNull(),
    message: text().notNull().default(""),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // An event runs an automation at most once, even if processed twice.
    unique("automation_runs_once_uq").on(t.automationId, t.outboxEventId),
    check("automation_runs_status", sql`${t.status} in ('success', 'failed', 'skipped')`),
    index().on(t.automationId, t.createdAt),
  ],
);
