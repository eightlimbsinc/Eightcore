// Test data built through the same services the app uses, so fixtures obey every invariant.
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { users, workspaceMembers } from "@/server/db/schema";
import type { WorkspaceRole } from "@/server/authz/matrix";
import type { ActorContext } from "@/server/authz/policy";
import { createWorkspace } from "@/modules/workspaces/service";

export async function createUser(overrides: { name?: string; email?: string; emailVerified?: boolean } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const [user] = await db()
    .insert(users)
    .values({
      name: overrides.name ?? `User ${suffix}`,
      email: overrides.email ?? `user-${suffix}@example.test`,
      emailVerified: overrides.emailVerified ?? true,
    })
    .returning();
  return user!;
}

export function actorFor(
  user: { id: string },
  workspace: { id: string; slug: string },
  role: WorkspaceRole,
): ActorContext {
  return {
    userId: user.id,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    workspaceRole: role,
    actorKind: "user",
  };
}

/** A workspace with an owner and one member per other role. */
export async function createWorkspaceWithRoles(slug = `ws-${randomUUID().slice(0, 8)}`) {
  const owner = await createUser({ name: "Olivia Owner" });
  const workspace = await createWorkspace(owner.id, { name: `Workspace ${slug}`, slug });
  const others = {} as Record<"admin" | "member" | "guest", Awaited<ReturnType<typeof createUser>>>;
  for (const role of ["admin", "member", "guest"] as const) {
    const user = await createUser({ name: `${role} user` });
    await db().insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role });
    others[role] = user;
  }
  const users = { owner, ...others };
  const actors = {
    owner: actorFor(owner, workspace, "owner"),
    admin: actorFor(others.admin, workspace, "admin"),
    member: actorFor(others.member, workspace, "member"),
    guest: actorFor(others.guest, workspace, "guest"),
  } satisfies Record<WorkspaceRole, ActorContext>;
  return { workspace, users, actors };
}
