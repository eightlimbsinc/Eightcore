import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "member", "guest"]);
export const memberStatus = pgEnum("member_status", ["active", "deactivated"]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("workspaces_slug_format", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$'`),
    check("workspaces_name_length", sql`char_length(${t.name}) between 1 and 80`),
  ],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRole().notNull(),
    status: memberStatus().notNull().default("active"),
    invitedBy: uuid().references(() => users.id),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index().on(t.userId)],
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: workspaceRole().notNull(),
    // SHA-256 of the token sent by email. The raw token is never stored.
    tokenHash: text().notNull().unique(),
    invitedBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    acceptedBy: uuid().references(() => users.id),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("workspace_invitations_pending_email_uq")
      .on(t.workspaceId, sql`lower(${t.email})`)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    check("workspace_invitations_not_owner", sql`${t.role} <> 'owner'`),
  ],
);
