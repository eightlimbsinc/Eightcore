import { sql } from "drizzle-orm";
import {
  check,
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
import { workspaceMembers, workspaces } from "@/modules/workspaces/schema";

export const projectVisibility = pgEnum("project_visibility", ["workspace", "private"]);
export const projectRole = pgEnum("project_role", ["manager", "editor", "commenter", "viewer"]);

export const projects = pgTable(
  "projects",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text().notNull(),
    key: text().notNull(),
    description: text().notNull().default(""),
    color: text(),
    visibility: projectVisibility().notNull().default("workspace"),
    /** Next task number for KEY-number task IDs. Incremented under a row lock. */
    nextTaskNumber: integer().notNull().default(1),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // Composite key target: children reference (id, workspace_id) so they can't cross workspaces.
    unique("projects_id_workspace_uq").on(t.id, t.workspaceId),
    unique("projects_workspace_key_uq").on(t.workspaceId, t.key),
    check("projects_key_format", sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
    check("projects_name_length", sql`char_length(${t.name}) between 1 and 120`),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    workspaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    userId: uuid().notNull(),
    role: projectRole().notNull(),
    addedBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    foreignKey({
      name: "project_members_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    // The user must be a member of the same workspace.
    foreignKey({
      name: "project_members_member_fk",
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete("cascade"),
    index().on(t.userId, t.workspaceId),
  ],
);
