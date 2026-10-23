// Project tags and their use on tasks.
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { projects } from "@/modules/projects/schema";
import { tasks } from "@/modules/tasks/schema";
import { workspaces } from "@/modules/workspaces/schema";

export const tags = pgTable(
  "tags",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid().notNull(),
    name: text().notNull(),
    color: text().notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "tags_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    unique("tags_id_project_uq").on(t.id, t.projectId),
    uniqueIndex("tags_project_name_uq").on(t.projectId, sql`lower(${t.name})`),
    check("tags_name_length", sql`char_length(${t.name}) between 1 and 40`),
    check("tags_color_format", sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

export const taskTags = pgTable(
  "task_tags",
  {
    workspaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    taskId: uuid().notNull(),
    tagId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.tagId] }),
    // Task and tag must belong to the same project.
    foreignKey({
      name: "task_tags_task_fk",
      columns: [t.taskId, t.projectId],
      foreignColumns: [tasks.id, tasks.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "task_tags_tag_fk",
      columns: [t.tagId, t.projectId],
      foreignColumns: [tags.id, tags.projectId],
    }).onDelete("cascade"),
    index().on(t.tagId),
  ],
);
