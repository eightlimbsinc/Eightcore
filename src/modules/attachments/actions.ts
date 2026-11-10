"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { runAction } from "@/server/action";
import { formFiles } from "@/server/form-files";
import type { ActionState } from "@/lib/action-state";
import { deleteAttachment, uploadTaskAttachments } from "./service";
import { startTaskUploads, type FileMeta } from "./direct";
import { DomainError } from "@/server/errors";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

export async function uploadAttachmentsAction(
  workspaceSlug: string,
  taskId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const rows = await uploadTaskAttachments(
      await actorFor(workspaceSlug),
      taskId,
      await formFiles(form, "files"),
    );
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: rows.length === 1 ? "File attached" : `${rows.length} files attached` };
  });
}

export async function deleteAttachmentAction(
  workspaceSlug: string,
  attachmentId: string,
): Promise<ActionState> {
  return runAction(async () => {
    await deleteAttachment(await actorFor(workspaceSlug), attachmentId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

export type StartUploadsResult =
  { ok: true; uploads: { id: string; url: string }[] } | { ok: false; message: string };

/** Upload addresses for files going onto a task (its files, a comment, QA evidence). */
export async function startTaskUploadsAction(
  workspaceSlug: string,
  taskId: string,
  files: FileMeta[],
): Promise<StartUploadsResult> {
  try {
    return { ok: true, uploads: await startTaskUploads(await actorFor(workspaceSlug), taskId, files) };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    console.error("[attachments] start uploads failed", error);
    return { ok: false, message: "Couldn't start the upload. Please try again." };
  }
}
