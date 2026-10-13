import "server-only";
import { notFound } from "next/navigation";
import { canWorkspace } from "@/server/authz/policy";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { listMembers } from "@/modules/workspaces/service";
import { getProjectByKey, listProjectMembers } from "./service";

export async function getProjectPage(slug: string, key: string) {
  const { actor } = await getWorkspaceContext(slug);
  try {
    const project = await getProjectByKey(actor, key);
    const members = await listProjectMembers(actor, project.id);
    // Candidates for "add member": only needed (and only allowed) for project managers.
    const workspaceMembers =
      project.can.manageMembers && canWorkspace(actor.workspaceRole, "member.view_directory")
        ? (await listMembers(actor)).filter((m) => m.status === "active")
        : [];
    return { actor, project, members, workspaceMembers };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
