// Docs: rich-text pages inside a project (optionally tied to one list), with sub-pages.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { projects } from "@/modules/projects/schema";
import { taskLists } from "@/modules/lists/schema";

export const docs = pgTable(
  "docs",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    /** Set: the doc belongs to this list (and shows to guests limited to it). Null: the whole project. */
    listId: uuid().references(() => taskLists.id, { onDelete: "cascade" }),
    /** Sub-page of another doc. */
    parentId: uuid().references((): AnyPgColumn => docs.id, { onDelete: "cascade" }),
    title: text().notNull().default(""),
    /** The editor's document (ProseMirror JSON), validated on save. */
    content: jsonb()
      .notNull()
      .default(sql`'{"type":"doc","content":[]}'::jsonb`),
    /** Plain text of the content, for search. */
    plainText: text().notNull().default(""),
    position: text().notNull(),
    /** Bumped on every save; a save from an older version is refused (no silent overwrite). */
    version: integer().notNull().default(1),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    updatedBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "docs_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    index().on(t.projectId, t.parentId, t.position),
    index().on(t.listId),
    check("docs_title_length", sql`char_length(${t.title}) <= 200`),
    check("docs_text_length", sql`char_length(${t.plainText}) <= 200000`),
  ],
);
