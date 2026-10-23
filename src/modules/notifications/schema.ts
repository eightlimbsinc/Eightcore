// In-app notifications (docs/DATA_MODEL.md §4.8).
import { foreignKey, index, jsonb, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { tasks } from "@/modules/tasks/schema";
import { workspaceMembers, workspaces } from "@/modules/workspaces/schema";

export const notificationType = pgEnum("notification_type", [
  "assigned",
  "mentioned",
  "commented",
  "status_changed",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid().notNull(),
    type: notificationType().notNull(),
    taskId: uuid().notNull(),
    actorId: uuid().references(() => users.id),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "notifications_task_fk",
      columns: [t.taskId, t.workspaceId],
      foreignColumns: [tasks.id, tasks.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "notifications_member_fk",
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete("cascade"),
    index().on(t.userId, t.workspaceId, t.createdAt.desc()),
  ],
);
