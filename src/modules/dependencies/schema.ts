// "Blocked by" links between tasks of one workspace (docs/DATA_MODEL.md §4.4).
import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { tasks } from "@/modules/tasks/schema";

/** `blockedTaskId` can't be finished until `blockingTaskId` is. No cycles (trigger). */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    workspaceId: uuid().notNull(),
    blockingTaskId: uuid().notNull(),
    blockedTaskId: uuid().notNull(),
    createdBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockingTaskId, t.blockedTaskId] }),
    // Both tasks belong to the same workspace.
    foreignKey({
      name: "task_dependencies_blocking_fk",
      columns: [t.blockingTaskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "task_dependencies_blocked_fk",
      columns: [t.blockedTaskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }).onDelete("cascade"),
    check("task_dependencies_not_self", sql`${t.blockingTaskId} <> ${t.blockedTaskId}`),
    index().on(t.blockedTaskId),
  ],
);
