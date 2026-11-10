// Forms: a public (link) form on a list; each response creates a task in that list.
import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { projects } from "@/modules/projects/schema";
import { taskLists } from "@/modules/lists/schema";
import { tasks } from "@/modules/tasks/schema";
import type { FormField } from "./rules";

export const listForms = pgTable(
  "list_forms",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    listId: uuid()
      .notNull()
      .references(() => taskLists.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().notNull().default(""),
    fields: jsonb().$type<FormField[]>().notNull(),
    /** Status new tasks get (null: the list's first open status). */
    statusId: uuid(),
    assigneeIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    submitMessage: text().notNull().default(""),
    /** The secret in the form's public link (/f/<token>); regenerating it retires old links. */
    token: text().notNull().unique(),
    enabled: boolean().notNull().default(true),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "list_forms_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    index().on(t.listId),
  ],
);

/** One response: which task it created, and a hash of the sender's address (for rate limits). */
export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    formId: uuid()
      .notNull()
      .references(() => listForms.id, { onDelete: "cascade" }),
    taskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    ipHash: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.formId, t.createdAt), index().on(t.ipHash, t.createdAt)],
);
