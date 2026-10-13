import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { listWorkspacesForUser } from "@/modules/workspaces/queries";

export default async function WorkspacesIndex() {
  const user = await requireUser();
  const workspaces = await listWorkspacesForUser(user.id);
  redirect(workspaces[0] ? `/w/${workspaces[0].slug}` : "/w/new");
}
