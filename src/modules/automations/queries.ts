import "server-only";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { canProject, type ActorContext } from "@/server/authz/policy";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { getProjectByKey } from "@/modules/projects/service";
import { getList, getProjectTree, listStatusesFor } from "@/modules/lists/service";
import { listProjectTags } from "@/modules/tags/service";
import { listAssignableMembers } from "@/modules/tasks/service";
import { listProjectFields } from "@/modules/fields/service";
import { webhookEndpointChoices } from "@/modules/webhooks/service";
import { listAutomations } from "./service";

/** Everything the automation editor offers for a project (or one of its lists). */
async function editorChoices(actor: ActorContext, projectId: string, listId?: string) {
  const [tree, tags, people, endpoints, { fields }] = await Promise.all([
    getProjectTree(actor, projectId),
    listProjectTags(actor, projectId),
    listAssignableMembers(actor, projectId, listId),
    webhookEndpointChoices(db(), actor.workspaceId),
    listProjectFields(actor, projectId),
  ]);
  const listRows = [
    ...tree.rootLists.map((l) => ({ ...l, folder: null as string | null })),
    ...tree.folders.flatMap((f) => f.lists.map((l) => ({ ...l, folder: f.name as string | null }))),
  ].filter((l) => !listId || l.id === listId);
  const lists = await Promise.all(
    listRows.map(async (l) => ({
      id: l.id,
      name: l.folder ? `${l.folder} / ${l.name}` : l.name,
      statuses: (await listStatusesFor(db(), l.id)).map((s) => ({ id: s.id, name: s.name, color: s.color })),
    })),
  );
  return {
    lists,
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    people: people.map((p) => ({ id: p.userId, name: p.name })),
    endpoints,
    fields: fields
      .filter((f) => !listId || !f.listId || f.listId === listId)
      .map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        listId: f.listId,
        options: f.options.map((o) => ({ id: o.id, label: o.label })),
      })),
  };
}

/** The project automations screen: project managers only (others get a 404). */
export async function getAutomationsPage(slug: string, key: string) {
  const { actor } = await getWorkspaceContext(slug);
  try {
    const project = await getProjectByKey(actor, key);
    if (!canProject(project.role, "automation.manage")) notFound();
    const [automations, choices] = await Promise.all([
      listAutomations(actor, project.id),
      editorChoices(actor, project.id),
    ]);
    return { project, automations, ...choices };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** One list's automations (and how many project-wide ones also apply to it). */
export async function getListAutomationsPage(slug: string, listId: string) {
  const { actor } = await getWorkspaceContext(slug);
  try {
    const detail = await getList(actor, listId);
    if (!detail.can.manageAutomations || detail.list.archivedAt) notFound();
    const [all, choices] = await Promise.all([
      listAutomations(actor, detail.project.id),
      editorChoices(actor, detail.project.id, listId),
    ]);
    return {
      list: { id: detail.list.id, name: detail.list.name },
      project: { id: detail.project.id, key: detail.project.key, name: detail.project.name },
      automations: all.filter((a) => a.listId === listId),
      projectWide: all.filter((a) => a.listId === null).length,
      ...choices,
    };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
