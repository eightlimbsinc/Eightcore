import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { getTaskByRef } from "./service";

export async function getTaskPage(slug: string, ref: string) {
  const { user, actor } = await getWorkspaceContext(slug);
  try {
    const detail = await getTaskByRef(actor, decodeURIComponent(ref));
    if (detail.task.archivedAt) notFound();
    return { user, actor, ...detail };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
