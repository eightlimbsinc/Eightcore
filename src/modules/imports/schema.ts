// What a migration has already brought in, so a re-run updates nothing twice and creates no duplicates.
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "@/modules/workspaces/schema";

export const importMappings = pgTable(
  "import_mappings",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** e.g. "clickup". */
    source: text().notNull(),
    /** project, folder, list, status, field, option, tag, task, comment, dependency, attachments */
    entityType: text().notNull(),
    /** The id in the source system (or a composite key such as "<listId>:<status name>"). */
    externalId: text().notNull(),
    /** The Eightcore row it became. */
    entityId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("import_mappings_external_uq").on(t.workspaceId, t.source, t.entityType, t.externalId),
    index().on(t.entityId),
  ],
);
