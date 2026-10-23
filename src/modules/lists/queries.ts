import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { listTasks } from "@/modules/tasks/service";
import { getList, getProjectTree } from "./service";

export async function getListPage(slug: string, listId: string) {
  const { user, actor } = await getWorkspaceContext(slug);
  try {
    const [detail, tasks] = await Promise.all([getList(actor, listId), listTasks(actor, listId)]);
    if (detail.list.archivedAt) notFound();
    return { user, actor, ...detail, tasks };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function getProjectTreeForPage(slug: string, projectId: string) {
  const { actor } = await getWorkspaceContext(slug);
  return getProjectTree(actor, projectId);
}
