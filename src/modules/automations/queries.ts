import "server-only";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { canProject } from "@/server/authz/policy";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { getProjectByKey } from "@/modules/projects/service";
import { getProjectTree, listStatusesFor } from "@/modules/lists/service";
import { listProjectTags } from "@/modules/tags/service";
import { listAssignableMembers } from "@/modules/tasks/service";
import { webhookEndpointChoices } from "@/modules/webhooks/service";
import { listAutomations } from "./service";

/** The project automations screen: project managers only (others get a 404). */
export async function getAutomationsPage(slug: string, key: string) {
  const { actor } = await getWorkspaceContext(slug);
  try {
    const project = await getProjectByKey(actor, key);
    if (!canProject(project.role, "automation.manage")) notFound();
    const [automations, tree, tags, people, endpoints] = await Promise.all([
      listAutomations(actor, project.id),
      getProjectTree(actor, project.id),
      listProjectTags(actor, project.id),
      listAssignableMembers(actor, project.id),
      webhookEndpointChoices(db(), actor.workspaceId),
    ]);
    const listRows = [
      ...tree.rootLists.map((l) => ({ ...l, folder: null as string | null })),
      ...tree.folders.flatMap((f) => f.lists.map((l) => ({ ...l, folder: f.name as string | null }))),
    ];
    const lists = await Promise.all(
      listRows.map(async (l) => ({
        id: l.id,
        name: l.folder ? `${l.folder} / ${l.name}` : l.name,
        statuses: (await listStatusesFor(db(), l.id)).map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
        })),
      })),
    );
    return {
      project,
      automations,
      lists,
      tags: tags.map((t) => ({ id: t.id, name: t.name })),
      people: people.map((p) => ({ id: p.userId, name: p.name })),
      endpoints,
    };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
