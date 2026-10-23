// Task comments (one level of replies) and @mentions.
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
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { tasks } from "@/modules/tasks/schema";
import { workspaceMembers, workspaces } from "@/modules/workspaces/schema";

export const comments = pgTable(
  "comments",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid().notNull(),
    parentCommentId: uuid(),
    authorId: uuid()
      .notNull()
      .references(() => users.id),
    body: text().notNull(),
    editedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "comments_task_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }).onDelete("cascade"),
    // A reply belongs to a comment on the same task.
    foreignKey({
      name: "comments_parent_fk",
      columns: [t.parentCommentId, t.taskId],
      foreignColumns: [t.id, t.taskId],
    }).onDelete("cascade"),
    unique("comments_id_task_uq").on(t.id, t.taskId),
    unique("comments_id_workspace_uq").on(t.id, t.workspaceId),
    check("comments_body_length", sql`char_length(${t.body}) between 1 and 10000`),
    check("comments_not_own_parent", sql`${t.parentCommentId} <> ${t.id}`),
    index().on(t.taskId, t.createdAt),
  ],
);

export const commentMentions = pgTable(
  "comment_mentions",
  {
    workspaceId: uuid().notNull(),
    commentId: uuid().notNull(),
    userId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.commentId, t.userId] }),
    foreignKey({
      name: "comment_mentions_comment_fk",
      columns: [t.commentId, t.workspaceId],
      foreignColumns: [comments.id, comments.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "comment_mentions_member_fk",
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete("cascade"),
  ],
);
