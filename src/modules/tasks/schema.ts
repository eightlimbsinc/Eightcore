// Tasks, subtasks and assignees (docs/DATA_MODEL.md §4.4).
import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { listStatuses, taskLists } from "@/modules/lists/schema";
import { workspaceMembers, workspaces } from "@/modules/workspaces/schema";

export const taskPriority = pgEnum("task_priority", ["urgent", "high", "normal", "low", "none"]);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid().notNull(),
    listId: uuid().notNull(),
    statusId: uuid().notNull(),
    parentTaskId: uuid(),
    /** Per-project sequence: shown as KEY-number, e.g. WEB-12. Never reused. */
    number: integer().notNull(),
    title: text().notNull(),
    description: text().notNull().default(""),
    priority: taskPriority().notNull().default("none"),
    /** Calendar dates (no time of day), so deadlines don't shift across time zones. */
    startDate: date({ mode: "string" }),
    dueDate: date({ mode: "string" }),
    position: text().notNull(),
    /** Optimistic concurrency: every update must name the version it read. */
    version: integer().notNull().default(1),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    completedAt: timestamp({ withTimezone: true }),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "tasks_list_fk",
      columns: [t.listId, t.workspaceId],
      foreignColumns: [taskLists.id, taskLists.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "tasks_list_project_fk",
      columns: [t.listId, t.projectId],
      foreignColumns: [taskLists.id, taskLists.projectId],
    }),
    // The status must belong to the task's own list.
    foreignKey({
      name: "tasks_status_fk",
      columns: [t.statusId, t.listId],
      foreignColumns: [listStatuses.id, listStatuses.listId],
    }),
    // A subtask lives in its parent's list (and therefore its workspace).
    foreignKey({
      name: "tasks_parent_fk",
      columns: [t.parentTaskId, t.listId],
      foreignColumns: [t.id, t.listId],
    }).onDelete("cascade"),
    unique("tasks_id_workspace_uq").on(t.id, t.workspaceId),
    unique("tasks_id_list_uq").on(t.id, t.listId),
    unique("tasks_project_number_uq").on(t.projectId, t.number),
    check("tasks_not_own_parent", sql`${t.parentTaskId} <> ${t.id}`),
    check("tasks_title_length", sql`char_length(${t.title}) between 1 and 500`),
    check(
      "tasks_dates_order",
      sql`${t.startDate} is null or ${t.dueDate} is null or ${t.startDate} <= ${t.dueDate}`,
    ),
    index().on(t.listId, t.parentTaskId, t.position),
    index().on(t.workspaceId, t.dueDate),
    index().on(t.parentTaskId),
  ],
);

export const taskAssignees = pgTable(
  "task_assignees",
  {
    workspaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    userId: uuid().notNull(),
    assignedBy: uuid().references(() => users.id),
    assignedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    foreignKey({
      name: "task_assignees_task_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }).onDelete("cascade"),
    // Assignees must be members of the same workspace.
    foreignKey({
      name: "task_assignees_member_fk",
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete("cascade"),
    index().on(t.userId, t.workspaceId),
  ],
);
