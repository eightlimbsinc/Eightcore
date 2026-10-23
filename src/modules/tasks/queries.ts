import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { db } from "@/server/db";
import { listComments } from "@/modules/comments/service";
import { listTaskAttachments } from "@/modules/attachments/service";
import { listProjectTags, tagsForTasks } from "@/modules/tags/service";
import { getTaskByRef } from "./service";

export async function getTaskPage(slug: string, ref: string) {
  const { user, actor } = await getWorkspaceContext(slug);
  try {
    const detail = await getTaskByRef(actor, decodeURIComponent(ref));
    if (detail.task.archivedAt) notFound();
    const [comments, attachments, projectTags, taskTags] = await Promise.all([
      listComments(actor, detail.task.id),
      listTaskAttachments(actor, detail.task.id),
      listProjectTags(actor, detail.project.id),
      tagsForTasks(db(), [detail.task.id]),
    ]);
    return {
      user,
      actor,
      ...detail,
      comments,
      // Files posted with a comment are shown on that comment.
      attachments: attachments.filter((a) => !a.commentId),
      projectTags,
      tags: taskTags.get(detail.task.id) ?? [],
    };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
