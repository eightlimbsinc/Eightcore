// Custom fields per project, optionally limited to one list (docs/DATA_MODEL.md §4.5).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";
import { taskLists } from "@/modules/lists/schema";
import { projects } from "@/modules/projects/schema";
import { tasks } from "@/modules/tasks/schema";
import { workspaceMembers, workspaces } from "@/modules/workspaces/schema";

export const customFieldType = pgEnum("custom_field_type", [
  "text",
  "number",
  "date",
  "dropdown",
  "checkbox",
  "person",
  "url",
]);

export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid().notNull(),
    /** Null: every list in the project. Otherwise only tasks in this list. */
    listId: uuid(),
    name: text().notNull(),
    type: customFieldType().notNull(),
    position: text().notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "custom_fields_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    // A list-scoped field belongs to a list of the same project.
    foreignKey({
      name: "custom_fields_list_fk",
      columns: [t.listId, t.projectId],
      foreignColumns: [taskLists.id, taskLists.projectId],
    }).onDelete("cascade"),
    unique("custom_fields_id_project_uq").on(t.id, t.projectId),
    uniqueIndex("custom_fields_project_name_uq").on(t.projectId, sql`lower(${t.name})`),
    check("custom_fields_name_length", sql`char_length(${t.name}) between 1 and 60`),
    index().on(t.projectId, t.position),
  ],
);

export const customFieldOptions = pgTable(
  "custom_field_options",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    fieldId: uuid()
      .notNull()
      .references(() => customFields.id, { onDelete: "cascade" }),
    label: text().notNull(),
    color: text().notNull(),
    position: text().notNull(),
  },
  (t) => [
    unique("custom_field_options_id_field_uq").on(t.id, t.fieldId),
    uniqueIndex("custom_field_options_field_label_uq").on(t.fieldId, sql`lower(${t.label})`),
    check("custom_field_options_label_length", sql`char_length(${t.label}) between 1 and 60`),
    check("custom_field_options_color_format", sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

/** One value per task and field, in the column matching the field's type. */
export const taskFieldValues = pgTable(
  "task_field_values",
  {
    workspaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    taskId: uuid().notNull(),
    fieldId: uuid().notNull(),
    valueText: text(),
    valueNumber: numeric(),
    valueDate: date({ mode: "string" }),
    valueBool: boolean(),
    valueOptionId: uuid(),
    valueUserId: uuid(),
    updatedBy: uuid().references(() => users.id),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.fieldId] }),
    // Task and field must belong to the same project.
    foreignKey({
      name: "task_field_values_task_fk",
      columns: [t.taskId, t.projectId],
      foreignColumns: [tasks.id, tasks.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "task_field_values_field_fk",
      columns: [t.fieldId, t.projectId],
      foreignColumns: [customFields.id, customFields.projectId],
    }).onDelete("cascade"),
    // A dropdown value is one of this field's options; deleting the option clears it.
    foreignKey({
      name: "task_field_values_option_fk",
      columns: [t.valueOptionId, t.fieldId],
      foreignColumns: [customFieldOptions.id, customFieldOptions.fieldId],
    }).onDelete("cascade"),
    foreignKey({
      name: "task_field_values_member_fk",
      columns: [t.workspaceId, t.valueUserId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete("cascade"),
    check(
      "task_field_values_one_value",
      sql`num_nonnulls(${t.valueText}, ${t.valueNumber}, ${t.valueDate}, ${t.valueBool}, ${t.valueOptionId}, ${t.valueUserId}) = 1`,
    ),
    check("task_field_values_text_length", sql`char_length(${t.valueText}) <= 2000`),
    index().on(t.fieldId),
  ],
);
