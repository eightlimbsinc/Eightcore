import "server-only";
import { notFound } from "next/navigation";
import { canWorkspace } from "@/server/authz/policy";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { listMembers } from "@/modules/workspaces/service";
import { getProjectTree } from "@/modules/lists/service";
import { listProjectFields } from "@/modules/fields/service";
import { getProjectByKey, listProjectMembers } from "./service";

export async function getProjectPage(slug: string, key: string) {
  const { actor } = await getWorkspaceContext(slug);
  try {
    const project = await getProjectByKey(actor, key);
    const [members, tree] = await Promise.all([
      listProjectMembers(actor, project.id),
      getProjectTree(actor, project.id),
    ]);
    // Candidates for "add member": only needed (and only allowed) for project managers.
    const workspaceMembers =
      project.can.manageMembers && canWorkspace(actor.workspaceRole, "member.view_directory")
        ? (await listMembers(actor)).filter((m) => m.status === "active")
        : [];
    return { actor, project, members, workspaceMembers, tree };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** The custom fields settings page: managers only (others get a 404). */
export async function getProjectFieldsPage(slug: string, key: string) {
  const { actor } = await getWorkspaceContext(slug);
  try {
    const project = await getProjectByKey(actor, key);
    const [{ fields, canManage }, tree] = await Promise.all([
      listProjectFields(actor, project.id),
      getProjectTree(actor, project.id),
    ]);
    if (!canManage) notFound();
    const lists = [...tree.rootLists, ...tree.folders.flatMap((f) => f.lists)].map((l) => ({
      id: l.id,
      name: l.name,
    }));
    return { project, fields, lists };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
