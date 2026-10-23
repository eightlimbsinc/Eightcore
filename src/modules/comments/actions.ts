"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { formString, runAction } from "@/server/action";
import { formFiles, formStrings } from "@/server/form-files";
import type { ActionState } from "@/lib/action-state";
import { createComment, deleteComment, updateComment } from "./service";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

export async function createCommentAction(
  workspaceSlug: string,
  taskId: string,
  parentCommentId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await createComment(
      await actorFor(workspaceSlug),
      taskId,
      {
        body: formString(form, "body"),
        parentCommentId: parentCommentId ?? undefined,
        mentionIds: formStrings(form, "mention"),
      },
      await formFiles(form, "files"),
    );
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: parentCommentId ? "Reply posted" : "Comment posted" };
  });
}

export async function updateCommentAction(
  workspaceSlug: string,
  commentId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await updateComment(await actorFor(workspaceSlug), commentId, {
      body: formString(form, "body"),
      mentionIds: formStrings(form, "mention"),
    });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Comment updated" };
  });
}

export async function deleteCommentAction(workspaceSlug: string, commentId: string): Promise<ActionState> {
  return runAction(async () => {
    await deleteComment(await actorFor(workspaceSlug), commentId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}
