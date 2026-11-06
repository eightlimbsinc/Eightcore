import "server-only";
import { notFound } from "next/navigation";
import { canWorkspace } from "@/server/authz/policy";
import { env } from "@/server/env";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { listVisibleProjects } from "@/modules/projects/service";
import { getSidebarTree } from "@/modules/lists/service";
import { WEBHOOK_EVENTS, listInboundHooks, listWebhookDeliveries, listWebhookEndpoints } from "./service";

/** Workspace integrations (Make and other webhooks): owners and admins only. */
export async function getIntegrationsPage(slug: string) {
  const { actor } = await getWorkspaceContext(slug);
  if (!canWorkspace(actor.workspaceRole, "integration.manage")) notFound();
  const projects = await listVisibleProjects(actor);
  const [endpoints, deliveries, inbound, tree] = await Promise.all([
    listWebhookEndpoints(actor),
    listWebhookDeliveries(actor),
    listInboundHooks(actor),
    getSidebarTree(
      actor,
      projects.map((p) => p.id),
    ),
  ]);
  // List ids, for "create a task in list …" from Make.
  const lists = projects.flatMap((p) => {
    const t = tree.get(p.id);
    if (!t) return [];
    return [
      ...t.rootLists.map((l) => ({ id: l.id, name: `${p.key} · ${l.name}` })),
      ...t.folders.flatMap((f) =>
        f.lists.map((l) => ({ id: l.id, name: `${p.key} · ${f.name} / ${l.name}` })),
      ),
    ];
  });
  return {
    endpoints,
    deliveries,
    inbound,
    projects: projects.map((p) => ({ id: p.id, name: p.name, key: p.key })),
    lists,
    events: [...WEBHOOK_EVENTS],
    hookBase: new URL("/api/hooks/", env().BETTER_AUTH_URL).toString(),
  };
}
