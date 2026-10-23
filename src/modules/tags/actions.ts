"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { formString, runAction } from "@/server/action";
import { formStrings } from "@/server/form-files";
import type { ActionState } from "@/lib/action-state";
import { createTag, deleteTag, setTaskTags, updateTag } from "./service";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

export async function setTaskTagsAction(
  workspaceSlug: string,
  taskId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await setTaskTags(await actorFor(workspaceSlug), taskId, formStrings(form, "tag"));
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Tags saved" };
  });
}

/** Creates a project tag and, when a task is given, adds it to that task. */
export async function createTagAction(
  workspaceSlug: string,
  projectId: string,
  taskId: string | null,
  currentTagIds: string[],
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await actorFor(workspaceSlug);
    const tag = await createTag(actor, projectId, {
      name: formString(form, "name"),
      color: formString(form, "color") || undefined,
    });
    if (taskId) await setTaskTags(actor, taskId, [...currentTagIds, tag.id]);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: `Created “${tag.name}”` };
  });
}

export async function updateTagAction(
  workspaceSlug: string,
  tagId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await updateTag(await actorFor(workspaceSlug), tagId, {
      name: formString(form, "name"),
      color: formString(form, "color") || undefined,
    });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Tag saved" };
  });
}

export async function deleteTagAction(workspaceSlug: string, tagId: string): Promise<ActionState> {
  return runAction(async () => {
    await deleteTag(await actorFor(workspaceSlug), tagId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}
