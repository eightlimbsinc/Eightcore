// Folders, lists, and each list's own statuses (docs/DATA_MODEL.md §4.2-4.3).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { projects } from "@/modules/projects/schema";
import { workspaces } from "@/modules/workspaces/schema";

/** What a status *means*, independent of its name: drives "is it done?" and reporting. */
export const statusCategory = pgEnum("status_category", [
  "backlog",
  "unstarted",
  "active",
  "review",
  "done",
  "cancelled",
  "closed",
]);

export const folders = pgTable(
  "folders",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid().notNull(),
    name: text().notNull(),
    /** Sidebar icon and colour by name (see src/lib/appearance.ts); null = default. */
    icon: text(),
    color: text(),
    position: text().notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "folders_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    unique("folders_id_project_uq").on(t.id, t.projectId),
    check("folders_name_length", sql`char_length(${t.name}) between 1 and 120`),
    index().on(t.projectId, t.position),
  ],
);

export const taskLists = pgTable(
  "task_lists",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid().notNull(),
    folderId: uuid(),
    name: text().notNull(),
    description: text().notNull().default(""),
    /** Sidebar icon and colour by name (see src/lib/appearance.ts); null = default. */
    icon: text(),
    color: text(),
    position: text().notNull(),
    /** The list's saved view (group order, subtasks, closed tasks): everyone's default. */
    viewSettings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** A protected view can only be changed by managers. */
    viewProtected: boolean().notNull().default(false),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "task_lists_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    // A list's folder must belong to the same project.
    foreignKey({
      name: "task_lists_folder_fk",
      columns: [t.folderId, t.projectId],
      foreignColumns: [folders.id, folders.projectId],
    }).onDelete("set null"),
    unique("task_lists_id_workspace_uq").on(t.id, t.workspaceId),
    unique("task_lists_id_project_uq").on(t.id, t.projectId),
    check("task_lists_name_length", sql`char_length(${t.name}) between 1 and 120`),
    index().on(t.projectId, t.folderId, t.position),
  ],
);

/** Statuses belong to one list, so every list can have its own workflow. */
export const listStatuses = pgTable(
  "list_statuses",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    listId: uuid().notNull(),
    name: text().notNull(),
    category: statusCategory().notNull(),
    color: text().notNull(),
    position: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "list_statuses_list_fk",
      columns: [t.listId, t.workspaceId],
      foreignColumns: [taskLists.id, taskLists.workspaceId],
    }).onDelete("cascade"),
    // Composite key target: a task's status must come from the task's own list.
    unique("list_statuses_id_list_uq").on(t.id, t.listId),
    uniqueIndex("list_statuses_list_name_uq").on(t.listId, sql`lower(${t.name})`),
    check("list_statuses_name_length", sql`char_length(${t.name}) between 1 and 40`),
    check("list_statuses_color_format", sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);
