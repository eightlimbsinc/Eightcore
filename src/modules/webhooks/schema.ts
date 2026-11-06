// Webhooks: outgoing (Eightcore → Make etc., signed), their delivery log, and incoming addresses.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
import { workspaces } from "@/modules/workspaces/schema";

/** Where to POST events. Signed with HMAC-SHA256 using `secret` (shown once, kept to sign). */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Null: every project. */
    projectId: uuid().references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    url: text().notNull(),
    secret: text().notNull(),
    /** Event types to send; empty = only when an automation sends to it. */
    events: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    enabled: boolean().notNull().default(true),
    /** Made by an automation's "Call webhook" action (shown to admins, not offered as a saved webhook). */
    fromAutomation: boolean().notNull().default(false),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("webhook_endpoints_https", sql`${t.url} like 'https://%'`),
    check("webhook_endpoints_name_length", sql`char_length(${t.name}) between 1 and 120`),
    index().on(t.workspaceId),
  ],
);

/** Every attempt to deliver an event, for the log and retries. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    endpointId: uuid()
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventType: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    /** "pending", "delivered" or "failed" (after the last retry). */
    status: text().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    responseStatus: integer(),
    lastError: text(),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("webhook_deliveries_status", sql`${t.status} in ('pending', 'delivered', 'failed')`),
    index("webhook_deliveries_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index().on(t.endpointId, t.createdAt),
  ],
);

/**
 * An address Make (or anything) can call to create or update tasks. Only a hash of the token is
 * stored; requests act with the permissions of whoever created it.
 */
export const inboundHooks = pgTable(
  "inbound_hooks",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text().notNull(),
    tokenHash: text().notNull().unique(),
    /** First characters of the token, to recognise it in the list. */
    tokenHint: text().notNull(),
    enabled: boolean().notNull().default(true),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp({ withTimezone: true }),
  },
  (t) => [check("inbound_hooks_name_length", sql`char_length(${t.name}) between 1 and 120`)],
);
