import { bigint, index, jsonb, pgEnum, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "@/modules/identity/schema";
import { workspaces } from "@/modules/workspaces/schema";

export const actorKind = pgEnum("actor_kind", ["user", "automation", "import", "integration", "system"]);

/** Domain change history. Append-only: the app role has no UPDATE/DELETE (see migration). */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid().references(() => users.id),
    actorKind: actorKind().notNull(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    action: text().notNull(),
    changes: jsonb().$type<Record<string, [unknown, unknown]>>().notNull().default({}),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    requestId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.workspaceId, t.createdAt.desc()),
    index().on(t.entityType, t.entityId, t.createdAt.desc()),
  ],
);

/** Security events (sign-in, role changes, invitations, ...). Append-only. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: uuid().references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid().references(() => users.id),
    event: text().notNull(),
    ip: text(),
    userAgent: text(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt.desc()), index().on(t.actorId, t.createdAt.desc())],
);

/** Transactional outbox. Written in the same transaction as the change; drained by the worker (Phase 6). */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    causationDepth: smallint().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("outbox_events_pending_idx")
      .on(t.id)
      .where(sql`${t.dispatchedAt} is null`),
  ],
);
