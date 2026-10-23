// Files attached to tasks (optionally to a comment). Stored via StorageAdapter.
import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { comments } from "@/modules/comments/schema";
import { tasks } from "@/modules/tasks/schema";
import { workspaces } from "@/modules/workspaces/schema";

export const attachments = pgTable(
  "attachments",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid().notNull(),
    commentId: uuid(),
    uploaderId: uuid()
      .notNull()
      .references(() => users.id),
    /** Random object key. Never derived from the file name, never sent to the browser. */
    storageKey: text().notNull().unique(),
    originalName: text().notNull(),
    /** Detected from the file's content where possible, not trusted from the browser. */
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "attachments_task_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "attachments_comment_fk",
      columns: [t.commentId, t.taskId],
      foreignColumns: [comments.id, comments.taskId],
    }).onDelete("cascade"),
    check("attachments_size_positive", sql`${t.sizeBytes} > 0`),
    check("attachments_name_length", sql`char_length(${t.originalName}) between 1 and 255`),
    index().on(t.taskId, t.createdAt),
  ],
);
