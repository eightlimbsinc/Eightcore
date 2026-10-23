import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { listTasks } from "@/modules/tasks/service";
import { tagsForTasks } from "@/modules/tags/service";
import { db } from "@/server/db";
import { getList, getProjectTree } from "./service";

export async function getListPage(slug: string, listId: string) {
  const { user, actor } = await getWorkspaceContext(slug);
  try {
    const [detail, tasks] = await Promise.all([getList(actor, listId), listTasks(actor, listId)]);
    if (detail.list.archivedAt) notFound();
    // listTasks has checked access to this list, so its task ids are safe to look up.
    const tags = await tagsForTasks(
      db(),
      tasks.map((t) => t.id),
    );
    return { user, actor, ...detail, tasks: tasks.map((t) => ({ ...t, tags: tags.get(t.id) ?? [] })) };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function getProjectTreeForPage(slug: string, projectId: string) {
  const { actor } = await getWorkspaceContext(slug);
  return getProjectTree(actor, projectId);
}
