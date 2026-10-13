"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { formString, runAction } from "@/server/action";
import { PROJECT_ROLES, type ProjectRole } from "@/server/authz/matrix";
import type { ActionState } from "@/lib/action-state";
import { createProject, setProjectArchived, setProjectMember, updateProject } from "./service";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

export async function createProjectAction(
  workspaceSlug: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  let key = "";
  const result = await runAction(async () => {
    const project = await createProject(await actorFor(workspaceSlug), {
      name: formString(form, "name"),
      key: formString(form, "key"),
      description: formString(form, "description"),
      visibility: formString(form, "visibility") === "private" ? "private" : "workspace",
    });
    key = project.key;
  });
  if (result?.ok) {
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    redirect(`/w/${workspaceSlug}/p/${key}`);
  }
  return result;
}

export async function updateProjectAction(
  workspaceSlug: string,
  projectId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await updateProject(await actorFor(workspaceSlug), projectId, {
      name: formString(form, "name"),
      description: formString(form, "description"),
      visibility: formString(form, "visibility") === "private" ? "private" : "workspace",
    });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Project saved" };
  });
}

export async function setProjectArchivedAction(
  workspaceSlug: string,
  projectId: string,
  archived: boolean,
): Promise<ActionState> {
  const result = await runAction(async () => {
    await setProjectArchived(await actorFor(workspaceSlug), projectId, archived);
  });
  if (result?.ok) {
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    if (archived) redirect(`/w/${workspaceSlug}`);
  }
  return result;
}

export async function setProjectMemberAction(
  workspaceSlug: string,
  projectId: string,
  userId: string,
  role: string | null,
): Promise<ActionState> {
  return runAction(async () => {
    if (role !== null && !PROJECT_ROLES.includes(role as ProjectRole))
      return { ok: false, message: "Unknown role" };
    await setProjectMember(await actorFor(workspaceSlug), projectId, {
      userId,
      role: role as ProjectRole | null,
    });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}
