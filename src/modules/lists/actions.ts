"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { formString, runAction } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import {
  addStatus,
  createFolder,
  createList,
  deleteFolder,
  deleteStatus,
  moveStatus,
  renameFolder,
  saveListView,
  setItemAppearance,
  setListArchived,
  setListViewProtected,
  updateList,
  updateStatus,
} from "./service";
import type { ItemAppearance, ItemKind } from "@/lib/appearance";
import { statusInput } from "./validators";
import {
  applyStatusTemplate,
  deleteStatusTemplate,
  saveStatusTemplate,
  type TemplateSource,
} from "./status-templates";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

function statusFromForm(form: FormData) {
  return statusInput.parse({
    name: formString(form, "name"),
    category: formString(form, "category"),
    color: formString(form, "color"),
  });
}

export async function createFolderAction(
  workspaceSlug: string,
  projectId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await createFolder(await actorFor(workspaceSlug), projectId, { name: formString(form, "name") });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Folder created" };
  });
}

export async function deleteFolderAction(workspaceSlug: string, folderId: string): Promise<ActionState> {
  return runAction(async () => {
    await deleteFolder(await actorFor(workspaceSlug), folderId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

export async function renameFolderAction(
  workspaceSlug: string,
  folderId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await renameFolder(await actorFor(workspaceSlug), folderId, { name: formString(form, "name") });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Saved" };
  });
}

/** Removes a list from view (archived: its tasks and history are kept and can be restored). */
export async function deleteListAction(workspaceSlug: string, listId: string): Promise<ActionState> {
  return runAction(async () => {
    await setListArchived(await actorFor(workspaceSlug), listId, true);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

export async function createListAction(
  workspaceSlug: string,
  projectId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  let listId = "";
  const result = await runAction(async () => {
    const folderId = formString(form, "folderId");
    const list = await createList(await actorFor(workspaceSlug), projectId, {
      name: formString(form, "name"),
      folderId: folderId || null,
      ...(formString(form, "template").startsWith("saved:")
        ? { templateId: formString(form, "template").slice("saved:".length) }
        : {
            template: formString(form, "template") === "simple" ? ("simple" as const) : ("agency" as const),
          }),
    });
    listId = list.id;
  });
  if (result?.ok) {
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    redirect(`/w/${workspaceSlug}/l/${listId}`);
  }
  return result;
}

export async function renameListAction(
  workspaceSlug: string,
  listId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await updateList(await actorFor(workspaceSlug), listId, { name: formString(form, "name") });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Saved" };
  });
}

export async function archiveListAction(
  workspaceSlug: string,
  listId: string,
  projectKey: string,
): Promise<ActionState> {
  const result = await runAction(async () => {
    await setListArchived(await actorFor(workspaceSlug), listId, true);
  });
  if (result?.ok) {
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    redirect(`/w/${workspaceSlug}/p/${projectKey}`);
  }
  return result;
}

export async function addStatusAction(
  workspaceSlug: string,
  listId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await addStatus(await actorFor(workspaceSlug), listId, statusFromForm(form));
    revalidatePath(`/w/${workspaceSlug}/l/${listId}`, "layout");
    return { ok: true, message: "Status added" };
  });
}

export async function updateStatusAction(
  workspaceSlug: string,
  listId: string,
  statusId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await updateStatus(await actorFor(workspaceSlug), statusId, statusFromForm(form));
    revalidatePath(`/w/${workspaceSlug}/l/${listId}`, "layout");
    return { ok: true, message: "Saved" };
  });
}

export async function moveStatusAction(
  workspaceSlug: string,
  listId: string,
  statusId: string,
  direction: "up" | "down",
): Promise<ActionState> {
  return runAction(async () => {
    await moveStatus(await actorFor(workspaceSlug), statusId, direction === "up" ? "up" : "down");
    revalidatePath(`/w/${workspaceSlug}/l/${listId}`, "layout");
  });
}

export async function deleteStatusAction(
  workspaceSlug: string,
  listId: string,
  statusId: string,
  replacementStatusId: string,
): Promise<ActionState> {
  return runAction(async () => {
    await deleteStatus(await actorFor(workspaceSlug), statusId, replacementStatusId);
    revalidatePath(`/w/${workspaceSlug}/l/${listId}`, "layout");
  });
}

export async function saveListViewAction(
  workspaceSlug: string,
  listId: string,
  view: { order: string; subtasks: string; closed: string; filters: string },
  layout: "list" | "board" | "calendar" = "list",
): Promise<ActionState> {
  return runAction(async () => {
    await saveListView(await actorFor(workspaceSlug), listId, view);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    // Back to the plain list address: it now shows the saved view.
    redirect(`/w/${workspaceSlug}/l/${listId}${layout === "list" ? "" : `/${layout}`}`);
  });
}

export async function setListViewProtectedAction(
  workspaceSlug: string,
  listId: string,
  isProtected: boolean,
): Promise<ActionState> {
  return runAction(async () => {
    await setListViewProtected(await actorFor(workspaceSlug), listId, isProtected);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** Icon and colour picker in the sidebar (null resets to the default). */
export async function setItemAppearanceAction(
  workspaceSlug: string,
  kind: ItemKind,
  id: string,
  appearance: ItemAppearance,
): Promise<ActionState> {
  return runAction(async () => {
    await setItemAppearance(await actorFor(workspaceSlug), kind, id, {
      icon: appearance.icon ?? null,
      color: appearance.color ?? null,
    });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** "Save as template" on the list settings page. */
export async function saveStatusTemplateAction(
  workspaceSlug: string,
  listId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const name = formString(form, "name");
    await saveStatusTemplate(await actorFor(workspaceSlug), listId, name);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: `Saved “${name.trim()}” as a template` };
  });
}

/** Replaces the list's statuses with a template's (tasks are kept and moved). */
export async function applyStatusTemplateAction(
  workspaceSlug: string,
  listId: string,
  source: TemplateSource,
): Promise<ActionState> {
  return runAction(async () => {
    const clean: TemplateSource =
      "builtin" in source
        ? { builtin: source.builtin === "simple" ? "simple" : "agency" }
        : { id: String(source.id) };
    const { removed, movedTasks } = await applyStatusTemplate(await actorFor(workspaceSlug), listId, clean);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    const note = removed.length
      ? ` Removed ${removed.join(", ")}${movedTasks ? `; moved ${movedTasks} ${movedTasks === 1 ? "task" : "tasks"}` : ""}.`
      : "";
    return { ok: true, message: `Template applied.${note}` };
  });
}

export async function deleteStatusTemplateAction(
  workspaceSlug: string,
  templateId: string,
): Promise<ActionState> {
  return runAction(async () => {
    await deleteStatusTemplate(await actorFor(workspaceSlug), templateId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}
