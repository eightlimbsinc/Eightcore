import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { db, type DbOrTx } from "@/server/db";
import {
  customFieldOptions,
  customFields,
  taskFieldValues,
  taskLists,
  tasks,
  users,
} from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import { ForbiddenError, NotFoundError, ValidationError, assertId, pgErrorInfo } from "@/server/errors";
import { recordActivity } from "@/modules/activity/service";
import { loadProjectAccess } from "@/modules/projects/service";
import { assignableUserIds, loadTaskAccess } from "@/modules/tasks/service";
import {
  OPTION_COLORS,
  createFieldInput,
  optionInput,
  parseFieldValue,
  renameFieldInput,
  type CreateFieldInput,
  type FieldType,
} from "./validators";

function mapFieldError(error: unknown): never {
  const { constraint } = pgErrorInfo(error);
  if (constraint === "custom_fields_project_name_uq") {
    throw new ValidationError("This project already has a field with that name", { name: "Already in use" });
  }
  if (constraint === "custom_field_options_field_label_uq") {
    throw new ValidationError("This field already has that option", { label: "Already in use" });
  }
  throw error;
}

function assertManage(role: Parameters<typeof canProject>[0]) {
  if (!canProject(role, "custom_field.manage")) throw new ForbiddenError();
}

async function loadFieldAccess(tx: DbOrTx, actor: ActorContext, fieldId: string) {
  assertId(fieldId, "Field not found");
  const [field] = await tx
    .select()
    .from(customFields)
    .where(and(eq(customFields.id, fieldId), eq(customFields.workspaceId, actor.workspaceId)));
  if (!field) throw new NotFoundError("Field not found");
  const { project, role } = await loadProjectAccess(tx, actor, { id: field.projectId });
  return { field, project, role };
}

async function optionsFor(tx: DbOrTx, fieldIds: string[]) {
  const map = new Map<string, { id: string; label: string; color: string }[]>();
  if (!fieldIds.length) return map;
  const rows = await tx
    .select({
      id: customFieldOptions.id,
      fieldId: customFieldOptions.fieldId,
      label: customFieldOptions.label,
      color: customFieldOptions.color,
    })
    .from(customFieldOptions)
    .where(inArray(customFieldOptions.fieldId, fieldIds))
    .orderBy(asc(customFieldOptions.position));
  for (const { fieldId, ...o } of rows) map.set(fieldId, [...(map.get(fieldId) ?? []), o]);
  return map;
}

// ── Managing fields ───────────────────────────────────────────────────────────────────────

/** Every field of a project, with options and the list it is limited to (if any). */
export async function listProjectFields(actor: ActorContext, projectId: string) {
  const { role } = await loadProjectAccess(db(), actor, { id: projectId });
  const rows = await db()
    .select({
      id: customFields.id,
      name: customFields.name,
      type: customFields.type,
      listId: customFields.listId,
      listName: taskLists.name,
    })
    .from(customFields)
    .leftJoin(taskLists, eq(taskLists.id, customFields.listId))
    .where(eq(customFields.projectId, projectId))
    .orderBy(asc(customFields.position));
  const options = await optionsFor(
    db(),
    rows.map((r) => r.id),
  );
  return {
    fields: rows.map((r) => ({ ...r, options: options.get(r.id) ?? [] })),
    canManage: canProject(role, "custom_field.manage"),
  };
}

export async function createField(actor: ActorContext, projectId: string, raw: CreateFieldInput) {
  const input = createFieldInput.parse(raw);
  if (input.type === "dropdown" && input.options.length === 0) {
    throw new ValidationError("Add at least one option", { options: "Add at least one option" });
  }
  const labels = input.type === "dropdown" ? input.options : [];
  if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) {
    throw new ValidationError("Each option needs a different name", { options: "Remove the duplicate" });
  }
  try {
    return await db().transaction(async (tx) => {
      const { role } = await loadProjectAccess(tx, actor, { id: projectId });
      assertManage(role);
      if (input.listId) {
        const [list] = await tx
          .select({ id: taskLists.id })
          .from(taskLists)
          .where(and(eq(taskLists.id, input.listId), eq(taskLists.projectId, projectId)));
        if (!list) throw new NotFoundError("List not found in this project");
      }
      const [last] = await tx
        .select({ position: customFields.position })
        .from(customFields)
        .where(eq(customFields.projectId, projectId))
        .orderBy(desc(customFields.position))
        .limit(1);
      const [field] = await tx
        .insert(customFields)
        .values({
          workspaceId: actor.workspaceId,
          projectId,
          listId: input.listId,
          name: input.name,
          type: input.type,
          position: generateKeyBetween(last?.position ?? null, null),
          createdBy: actor.userId,
        })
        .returning({ id: customFields.id, name: customFields.name });
      if (labels.length) {
        const positions = generateNKeysBetween(null, null, labels.length);
        await tx.insert(customFieldOptions).values(
          labels.map((label, i) => ({
            workspaceId: actor.workspaceId,
            fieldId: field!.id,
            label,
            color: OPTION_COLORS[i % OPTION_COLORS.length]!,
            position: positions[i]!,
          })),
        );
      }
      await recordActivity(tx, actor, {
        entityType: "custom_field",
        entityId: field!.id,
        action: "created",
        metadata: { name: input.name, type: input.type, projectId, listId: input.listId },
      });
      return field!;
    });
  } catch (error) {
    mapFieldError(error);
  }
}

export async function renameField(actor: ActorContext, fieldId: string, raw: { name: string }) {
  const input = renameFieldInput.parse(raw);
  try {
    await db().transaction(async (tx) => {
      const { field, role } = await loadFieldAccess(tx, actor, fieldId);
      assertManage(role);
      if (field.name === input.name) return;
      await tx.update(customFields).set({ name: input.name }).where(eq(customFields.id, fieldId));
      await recordActivity(tx, actor, {
        entityType: "custom_field",
        entityId: fieldId,
        action: "renamed",
        changes: { name: [field.name, input.name] },
      });
    });
  } catch (error) {
    mapFieldError(error);
  }
}

/**
 * Moves a field between two others of the same project (ids of the fields that end up
 * just above and just below it; null at either end). Order shows on the settings page and tasks.
 */
export async function moveField(
  actor: ActorContext,
  fieldId: string,
  move: { afterFieldId: string | null; beforeFieldId: string | null },
) {
  for (const id of [move.afterFieldId, move.beforeFieldId]) if (id) assertId(id, "Field not found");
  await db().transaction(async (tx) => {
    const { field, role } = await loadFieldAccess(tx, actor, fieldId);
    assertManage(role);
    const ids = [move.afterFieldId, move.beforeFieldId].filter((id): id is string => Boolean(id));
    const neighbours = ids.length
      ? await tx
          .select({ id: customFields.id, position: customFields.position })
          .from(customFields)
          .where(and(inArray(customFields.id, ids), eq(customFields.projectId, field.projectId)))
      : [];
    if (neighbours.length !== ids.length) throw new NotFoundError("Field not found in this project");
    const after = neighbours.find((n) => n.id === move.afterFieldId)?.position ?? null;
    const before = neighbours.find((n) => n.id === move.beforeFieldId)?.position ?? null;
    if (after !== null && before !== null && after >= before) {
      throw new ValidationError("The fields changed meanwhile. Reload and try again.");
    }
    await tx
      .update(customFields)
      .set({ position: generateKeyBetween(after, before) })
      .where(eq(customFields.id, fieldId));
  });
}

/** Deletes a field and every value stored in it. */
export async function deleteField(actor: ActorContext, fieldId: string) {
  await db().transaction(async (tx) => {
    const { field, role } = await loadFieldAccess(tx, actor, fieldId);
    assertManage(role);
    await tx.delete(customFields).where(eq(customFields.id, fieldId));
    await recordActivity(tx, actor, {
      entityType: "custom_field",
      entityId: fieldId,
      action: "deleted",
      metadata: { name: field.name, projectId: field.projectId },
    });
  });
}

export async function addFieldOption(actor: ActorContext, fieldId: string, raw: { label: string }) {
  const input = optionInput.parse(raw);
  try {
    await db().transaction(async (tx) => {
      const { field, role } = await loadFieldAccess(tx, actor, fieldId);
      assertManage(role);
      if (field.type !== "dropdown") throw new ValidationError("Only dropdown fields have options");
      const existing = await tx
        .select({ position: customFieldOptions.position })
        .from(customFieldOptions)
        .where(eq(customFieldOptions.fieldId, fieldId))
        .orderBy(desc(customFieldOptions.position));
      if (existing.length >= 50) throw new ValidationError("A field can have at most 50 options");
      await tx.insert(customFieldOptions).values({
        workspaceId: actor.workspaceId,
        fieldId,
        label: input.label,
        color: OPTION_COLORS[existing.length % OPTION_COLORS.length]!,
        position: generateKeyBetween(existing[0]?.position ?? null, null),
      });
    });
  } catch (error) {
    mapFieldError(error);
  }
}

/** Removes a dropdown option; tasks that had it chosen become empty for this field. */
export async function deleteFieldOption(actor: ActorContext, optionId: string) {
  assertId(optionId, "Option not found");
  await db().transaction(async (tx) => {
    const [option] = await tx
      .select({ fieldId: customFieldOptions.fieldId })
      .from(customFieldOptions)
      .where(and(eq(customFieldOptions.id, optionId), eq(customFieldOptions.workspaceId, actor.workspaceId)));
    if (!option) throw new NotFoundError("Option not found");
    const { role } = await loadFieldAccess(tx, actor, option.fieldId);
    assertManage(role);
    await tx.delete(customFieldOptions).where(eq(customFieldOptions.id, optionId));
  });
}

// ── Values on tasks ───────────────────────────────────────────────────────────────────────

const valueColumns = {
  taskId: taskFieldValues.taskId,
  fieldId: taskFieldValues.fieldId,
  valueText: taskFieldValues.valueText,
  valueNumber: taskFieldValues.valueNumber,
  valueDate: taskFieldValues.valueDate,
  valueBool: taskFieldValues.valueBool,
  valueOptionId: taskFieldValues.valueOptionId,
  valueUserId: taskFieldValues.valueUserId,
};
type ValueRow = {
  valueText: string | null;
  valueNumber: string | null;
  valueDate: string | null;
  valueBool: boolean | null;
  valueOptionId: string | null;
  valueUserId: string | null;
};

/** The raw form value for a stored value (what an input shows). */
function formValue(type: FieldType, v: ValueRow | undefined): string {
  if (!v) return "";
  switch (type) {
    case "text":
    case "url":
      return v.valueText ?? "";
    case "number":
      return v.valueNumber ?? "";
    case "date":
      return v.valueDate ?? "";
    case "checkbox":
      return v.valueBool ? "on" : "";
    case "dropdown":
      return v.valueOptionId ?? "";
    case "person":
      return v.valueUserId ?? "";
  }
}

/** Fields that apply to a task: project-wide ones and those of its list. */
function appliesTo(projectId: string, listId: string) {
  return and(
    eq(customFields.projectId, projectId),
    or(isNull(customFields.listId), eq(customFields.listId, listId)),
  );
}

async function userNames(tx: DbOrTx, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** A task's applicable fields with their current values, for the task page. */
export async function getTaskFields(actor: ActorContext, taskId: string) {
  const { task, role } = await loadTaskAccess(db(), actor, taskId);
  const fields = await db()
    .select({ id: customFields.id, name: customFields.name, type: customFields.type })
    .from(customFields)
    .where(appliesTo(task.projectId, task.listId))
    .orderBy(asc(customFields.position));
  const [options, values] = await Promise.all([
    optionsFor(
      db(),
      fields.map((f) => f.id),
    ),
    db().select(valueColumns).from(taskFieldValues).where(eq(taskFieldValues.taskId, taskId)),
  ]);
  const byField = new Map(values.map((v) => [v.fieldId, v]));
  const names = await userNames(
    db(),
    values.map((v) => v.valueUserId).filter((id): id is string => Boolean(id)),
  );
  return {
    fields: fields.map((f) => {
      const v = byField.get(f.id);
      return {
        ...f,
        options: options.get(f.id) ?? [],
        value: formValue(f.type, v),
        display: display(f.type, v, options.get(f.id) ?? [], names),
      };
    }),
    canEdit: canProject(role, "task.update"),
    canManage: canProject(role, "custom_field.manage"),
  };
}

function display(
  type: FieldType,
  v: ValueRow | undefined,
  options: { id: string; label: string; color: string }[],
  names: Map<string, string>,
): { text: string; color?: string } | null {
  if (!v) return null;
  switch (type) {
    case "dropdown": {
      const option = options.find((o) => o.id === v.valueOptionId);
      return option ? { text: option.label, color: option.color } : null;
    }
    case "person":
      return { text: names.get(v.valueUserId ?? "") ?? "Someone" };
    case "checkbox":
      return { text: "Yes" };
    default:
      return { text: formValue(type, v) };
  }
}

/**
 * Saves a task's field values from a form: `values` maps field id → raw text. Fields not
 * included are left alone; an empty value clears the field.
 */
export async function setTaskFieldValues(
  actor: ActorContext,
  taskId: string,
  values: Record<string, string>,
) {
  await db().transaction(async (tx) => {
    const { task, project, role } = await loadTaskAccess(tx, actor, taskId);
    if (!canProject(role, "task.update")) throw new ForbiddenError();
    const fields = await tx
      .select({ id: customFields.id, name: customFields.name, type: customFields.type })
      .from(customFields)
      .where(appliesTo(task.projectId, task.listId));
    const byId = new Map(fields.map((f) => [f.id, f]));
    const unknown = Object.keys(values).find((id) => !byId.has(id));
    if (unknown) throw new NotFoundError("Field not found on this task");

    const options = await optionsFor(
      tx,
      fields.map((f) => f.id),
    );
    const current = new Map(
      (await tx.select(valueColumns).from(taskFieldValues).where(eq(taskFieldValues.taskId, taskId))).map(
        (v) => [v.fieldId, v],
      ),
    );
    const assignable = fields.some((f) => f.type === "person")
      ? await assignableUserIds(tx, actor, project.id, project.visibility)
      : new Set<string>();

    const errors: Record<string, string> = {};
    const changes: Record<string, [unknown, unknown]> = {};
    for (const [fieldId, raw] of Object.entries(values)) {
      const field = byId.get(fieldId)!;
      let stored;
      try {
        stored = parseFieldValue(field.type, raw);
      } catch (error) {
        errors[`field.${fieldId}`] = (error as Error).message;
        continue;
      }
      if (
        stored &&
        "valueOptionId" in stored &&
        !options.get(fieldId)?.some((o) => o.id === stored.valueOptionId)
      ) {
        errors[`field.${fieldId}`] = "Pick one of the options";
        continue;
      }
      if (stored && "valueUserId" in stored && !assignable.has(stored.valueUserId)) {
        errors[`field.${fieldId}`] = "That person can't see this project";
        continue;
      }
      const before = formValue(field.type, current.get(fieldId));
      const after = stored ? formValue(field.type, { ...emptyValue, ...stored }) : "";
      if (before === after) continue;
      if (stored) {
        const row = { ...emptyValue, ...stored, updatedBy: actor.userId };
        await tx
          .insert(taskFieldValues)
          .values({ workspaceId: actor.workspaceId, projectId: task.projectId, taskId, fieldId, ...row })
          .onConflictDoUpdate({ target: [taskFieldValues.taskId, taskFieldValues.fieldId], set: row });
      } else {
        await tx
          .delete(taskFieldValues)
          .where(and(eq(taskFieldValues.taskId, taskId), eq(taskFieldValues.fieldId, fieldId)));
      }
      changes[field.name] = [before || null, after || null];
    }
    if (Object.keys(errors).length) throw new ValidationError("Please check the highlighted fields", errors);
    if (!Object.keys(changes).length) return;
    await tx
      .update(tasks)
      .set({ version: sql`${tasks.version} + 1` })
      .where(eq(tasks.id, taskId));
    await recordActivity(tx, actor, {
      entityType: "task",
      entityId: taskId,
      action: "fields_changed",
      metadata: { fields: Object.keys(changes) },
    });
  });
}

const emptyValue: ValueRow = {
  valueText: null,
  valueNumber: null,
  valueDate: null,
  valueBool: null,
  valueOptionId: null,
  valueUserId: null,
};

/** Filled-in field values for list rows (the caller has checked access to these tasks). */
export async function fieldValuesForTasks(tx: DbOrTx, taskIds: string[]) {
  const map = new Map<
    string,
    { fieldId: string; name: string; type: FieldType; text: string; color?: string }[]
  >();
  if (!taskIds.length) return map;
  const rows = await tx
    .select({
      ...valueColumns,
      name: customFields.name,
      type: customFields.type,
      position: customFields.position,
    })
    .from(taskFieldValues)
    .innerJoin(customFields, eq(customFields.id, taskFieldValues.fieldId))
    .where(inArray(taskFieldValues.taskId, taskIds))
    .orderBy(asc(customFields.position));
  const options = await optionsFor(tx, [...new Set(rows.map((r) => r.fieldId))]);
  const names = await userNames(
    tx,
    rows.map((r) => r.valueUserId).filter((id): id is string => Boolean(id)),
  );
  for (const r of rows) {
    const shown = display(r.type, r, options.get(r.fieldId) ?? [], names);
    if (!shown) continue;
    map.set(r.taskId, [
      ...(map.get(r.taskId) ?? []),
      { fieldId: r.fieldId, name: r.name, type: r.type, ...shown },
    ]);
  }
  return map;
}
