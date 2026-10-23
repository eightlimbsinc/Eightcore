"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { formString, runAction } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import {
  addFieldOption,
  createField,
  deleteField,
  deleteFieldOption,
  renameField,
  setTaskFieldValues,
} from "./service";
import { FIELD_TYPES, splitOptions, type FieldType } from "./validators";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

export async function createFieldAction(
  workspaceSlug: string,
  projectId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const type = formString(form, "type");
    const field = await createField(await actorFor(workspaceSlug), projectId, {
      name: formString(form, "name"),
      type: (FIELD_TYPES as readonly string[]).includes(type) ? (type as FieldType) : ("" as FieldType),
      listId: formString(form, "listId") || null,
      options: splitOptions(formString(form, "options")),
    });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: `Created “${field.name}”` };
  });
}

export async function renameFieldAction(
  workspaceSlug: string,
  fieldId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await renameField(await actorFor(workspaceSlug), fieldId, { name: formString(form, "name") });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Saved" };
  });
}

export async function deleteFieldAction(workspaceSlug: string, fieldId: string): Promise<ActionState> {
  return runAction(async () => {
    await deleteField(await actorFor(workspaceSlug), fieldId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

export async function addFieldOptionAction(
  workspaceSlug: string,
  fieldId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await addFieldOption(await actorFor(workspaceSlug), fieldId, { label: formString(form, "label") });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Option added" };
  });
}

export async function deleteFieldOptionAction(workspaceSlug: string, optionId: string): Promise<ActionState> {
  return runAction(async () => {
    await deleteFieldOption(await actorFor(workspaceSlug), optionId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** Form fields named "field.<id>" carry each value; "fields" lists the ids shown (so unticked checkboxes clear). */
export async function saveTaskFieldsAction(
  workspaceSlug: string,
  taskId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ids = form.getAll("fields").filter((v): v is string => typeof v === "string");
    const values = Object.fromEntries(ids.map((id) => [id, formString(form, `field.${id}`)]));
    await setTaskFieldValues(await actorFor(workspaceSlug), taskId, values);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Fields saved" };
  });
}
