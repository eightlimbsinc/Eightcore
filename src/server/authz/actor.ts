import "server-only";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/server/db";
import { workspaceMembers, workspaces } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import type { ActorContext } from "./policy";

/**
 * Builds the actor for a user inside a workspace. Non-members (and deactivated
 * members) get NotFound, so a workspace's existence is never revealed.
 */
export async function resolveActor(userId: string, workspaceSlug: string): Promise<ActorContext> {
  const [row] = await db()
    .select({ workspaceId: workspaces.id, slug: workspaces.slug, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);
  if (!row) throw new NotFoundError("Workspace not found");
  return {
    userId,
    workspaceId: row.workspaceId,
    workspaceSlug: row.slug,
    workspaceRole: row.role,
    actorKind: "user",
  };
}

/** Per-request memoized variant for Server Components. */
export const resolveActorCached = cache(resolveActor);

/**
 * The actor for work done on someone's behalf (an automation they created, an incoming webhook
 * they set up): their role and permissions, marked as not a person acting directly.
 */
export async function resolveActorById(
  userId: string,
  workspaceId: string,
  actorKind: ActorContext["actorKind"],
): Promise<ActorContext> {
  const [row] = await db()
    .select({ slug: workspaces.slug, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!row) throw new NotFoundError("Workspace not found");
  return { userId, workspaceId, workspaceSlug: row.slug, workspaceRole: row.role, actorKind };
}
