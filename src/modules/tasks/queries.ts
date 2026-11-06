import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { db } from "@/server/db";
import { listComments } from "@/modules/comments/service";
import { listTaskAttachments } from "@/modules/attachments/service";
import { listProjectTags, tagsForTasks } from "@/modules/tags/service";
import { getTaskDependencies } from "@/modules/dependencies/service";
import { getTaskFields } from "@/modules/fields/service";
import { getTaskTime } from "@/modules/time/service";
import { listQaCycles } from "@/modules/qa/service";
import { getTaskByRef } from "./service";

export async function getTaskPage(slug: string, ref: string) {
  const { user, actor } = await getWorkspaceContext(slug);
  try {
    const detail = await getTaskByRef(actor, decodeURIComponent(ref));
    if (detail.task.archivedAt) notFound();
    const [comments, attachments, projectTags, taskTags, dependencies, fields, time, qa] = await Promise.all([
      listComments(actor, detail.task.id),
      listTaskAttachments(actor, detail.task.id),
      listProjectTags(actor, detail.project.id),
      tagsForTasks(db(), [detail.task.id]),
      getTaskDependencies(actor, detail.task.id),
      getTaskFields(actor, detail.task.id),
      getTaskTime(actor, detail.task.id),
      listQaCycles(actor, detail.task.id),
    ]);
    return {
      user,
      actor,
      ...detail,
      comments,
      // Files posted with a comment are shown on that comment.
      attachments: attachments.filter((a) => !a.commentId && !a.qaCycleId),
      qa: {
        ...qa,
        // Evidence can be removed only while its round is open (and by whoever may delete it).
        rounds: qa.rounds.map((r) => ({
          ...r,
          evidence: r.evidence.map((e) => ({
            ...e,
            canDelete: r.result === "pending" && attachments.some((a) => a.id === e.id && a.canDelete),
          })),
        })),
      },
      projectTags,
      tags: taskTags.get(detail.task.id) ?? [],
      dependencies,
      fields,
      time,
    };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
