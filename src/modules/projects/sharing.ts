import "server-only";
// A list's "Share & permissions": which guests can see it, adding and removing them, and inviting
// a new guest straight to the list. Guests get project_members rows limited to lists (list_ids).
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import { projectMembers, taskLists, users, workspaceInvitations, workspaceMembers } from "@/server/db/schema";
import { GUEST_MAX_PROJECT_ROLE, projectRoleAtMost, type ProjectRole } from "@/server/authz/matrix";
import { canProject, type ActorContext } from "@/server/authz/policy";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, assertId } from "@/server/errors";
import { recordActivity, recordAudit } from "@/modules/activity/service";
import { loadListAccess } from "@/modules/lists/service";
import { canInviteGuests, inviteMember } from "@/modules/workspaces/service";

export const GUEST_ROLES = ["editor", "commenter", "viewer"] as const;
export type GuestRole = (typeof GUEST_ROLES)[number];
const guestRole = z.enum(GUEST_ROLES);

async function manageableList(tx: DbOrTx, actor: ActorContext, listId: string) {
  const access = await loadListAccess(tx, actor, listId);
  if (!canProject(access.role, "project.manage_members")) throw new ForbiddenError();
  return access;
}

/** Who can see this list: workspace-wide access, and each guest (whole project or this list). */
export async function getListSharing(actor: ActorContext, listId: string) {
  const { list, project } = await manageableList(db(), actor, listId);
  const guests = await db()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: projectMembers.role,
      listIds: projectMembers.listIds,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, workspaceMembers.userId)),
    )
    .where(
      and(
        eq(workspaceMembers.workspaceId, actor.workspaceId),
        eq(workspaceMembers.role, "guest"),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .orderBy(asc(users.name));
  const withAccess = guests.filter((g) => g.role && (g.listIds === null || g.listIds.includes(listId)));
  const pending = (
    await db()
      .select({
        id: workspaceInvitations.id,
        email: workspaceInvitations.email,
        grants: workspaceInvitations.grants,
      })
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, actor.workspaceId),
          sql`${workspaceInvitations.acceptedAt} is null and ${workspaceInvitations.revokedAt} is null`,
          sql`${workspaceInvitations.expiresAt} > now()`,
        ),
      )
  ).filter((i) => i.grants.some((g) => g.projectId === project.id && g.listIds.includes(listId)));
  return {
    list: { id: list.id, name: list.name },
    project: { id: project.id, name: project.name, visibility: project.visibility },
    guests: withAccess.map((g) => ({
      userId: g.userId,
      name: g.name,
      email: g.email,
      role: g.role as ProjectRole,
      /** "project": they see every list in the project (change that on the project page). */
      scope: g.listIds === null ? ("project" as const) : ("list" as const),
    })),
    /** Guests in the workspace who can't see this list yet. */
    candidates: guests
      .filter((g) => !withAccess.includes(g))
      .map((g) => ({ userId: g.userId, name: g.name, email: g.email })),
    pending: pending.map((p) => ({ id: p.id, email: p.email })),
    canInvite: await canInviteGuests(actor),
  };
}

/** Gives a guest access to this list (adding it to the lists they already have in the project). */
export async function shareListWithGuest(
  actor: ActorContext,
  listId: string,
  raw: { userId: string; role: string },
) {
  assertId(raw.userId, "Person not found");
  const role = guestRole.parse(raw.role);
  await db().transaction(async (tx) => {
    const { list, project } = await manageableList(tx, actor, listId);
    const [target] = await tx
      .select({ role: workspaceMembers.role, status: workspaceMembers.status })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, raw.userId)),
      );
    if (!target || target.status !== "active") throw new NotFoundError("Person not found");
    if (target.role !== "guest")
      throw new ValidationError("Members already see the project's lists; share with guests here");
    const [current] = await tx
      .select({ listIds: projectMembers.listIds })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, raw.userId)));
    const granted = projectRoleAtMost(role, GUEST_MAX_PROJECT_ROLE);
    const listIds = current
      ? current.listIds === null
        ? null
        : [...new Set([...current.listIds, list.id])]
      : [list.id];
    await tx
      .insert(projectMembers)
      .values({
        workspaceId: actor.workspaceId,
        projectId: project.id,
        userId: raw.userId,
        role: granted,
        listIds,
        addedBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { role: granted, listIds },
      });
    await recordActivity(tx, actor, {
      entityType: "list",
      entityId: list.id,
      action: "shared",
      metadata: { userId: raw.userId, role: granted },
    });
    await recordAudit(tx, {
      event: "list.shared",
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      metadata: { projectId: project.id, listId: list.id, userId: raw.userId, role: granted },
    });
  });
}

/**
 * Takes this list away from a guest. A guest who saw the whole project keeps every other list;
 * a guest left with no lists leaves the project.
 */
export async function unshareListFromGuest(actor: ActorContext, listId: string, userId: string) {
  assertId(userId, "Person not found");
  await db().transaction(async (tx) => {
    const { list, project } = await manageableList(tx, actor, listId);
    const [current] = await tx
      .select({ listIds: projectMembers.listIds, wsRole: workspaceMembers.role })
      .from(projectMembers)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, projectMembers.workspaceId),
          eq(workspaceMembers.userId, projectMembers.userId),
        ),
      )
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, userId)));
    if (!current || current.wsRole !== "guest") throw new NotFoundError("That guest can't see this list");
    let remaining: string[];
    if (current.listIds === null) {
      const all = await tx
        .select({ id: taskLists.id })
        .from(taskLists)
        .where(eq(taskLists.projectId, project.id));
      remaining = all.map((l) => l.id).filter((id) => id !== list.id);
    } else {
      if (!current.listIds.includes(list.id)) throw new NotFoundError("That guest can't see this list");
      remaining = current.listIds.filter((id) => id !== list.id);
    }
    const where = and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, userId));
    if (remaining.length) await tx.update(projectMembers).set({ listIds: remaining }).where(where);
    else await tx.delete(projectMembers).where(where);
    await recordActivity(tx, actor, {
      entityType: "list",
      entityId: list.id,
      action: "unshared",
      metadata: { userId },
    });
    await recordAudit(tx, {
      event: "list.unshared",
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      metadata: { projectId: project.id, listId: list.id, userId },
    });
  });
}

/**
 * Invites someone new as a guest who'll see this list once they accept. If they're already
 * invited, the list is added to that invitation. Returns the token to email (null when merged).
 */
export async function inviteGuestToList(
  actor: ActorContext,
  listId: string,
  raw: { email: string; role: string },
): Promise<{ token: string | null; email: string }> {
  const role = guestRole.parse(raw.role);
  const email = z.email("Enter an email address").parse(raw.email.trim().toLowerCase());
  if (!(await canInviteGuests(actor))) throw new ForbiddenError();
  const { list, project } = await manageableList(db(), actor, listId);
  const grant = { projectId: project.id, listIds: [list.id], role };

  const [existingMember] = await db()
    .select({ userId: users.id, role: workspaceMembers.role, status: workspaceMembers.status })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(sql`lower(${users.email})`, email)));
  if (existingMember?.status === "active") {
    if (existingMember.role !== "guest")
      throw new ConflictError("That person is already a member and sees the project");
    await shareListWithGuest(actor, listId, { userId: existingMember.userId, role });
    return { token: null, email };
  }

  try {
    const { invitationId, token } = await inviteMember(actor, { email, role: "guest" });
    await db()
      .update(workspaceInvitations)
      .set({ grants: [grant] })
      .where(eq(workspaceInvitations.id, invitationId));
    return { token, email };
  } catch (error) {
    if (!(error instanceof ConflictError) || !/pending invitation/.test(error.message)) throw error;
    // Already invited: add this list to what they'll get on accepting.
    const [pending] = await db()
      .select({
        id: workspaceInvitations.id,
        grants: workspaceInvitations.grants,
        role: workspaceInvitations.role,
      })
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, actor.workspaceId),
          eq(sql`lower(${workspaceInvitations.email})`, email),
          sql`${workspaceInvitations.acceptedAt} is null and ${workspaceInvitations.revokedAt} is null`,
        ),
      );
    if (!pending) throw error;
    if (pending.role !== "guest")
      throw new ConflictError("They're already invited as a member, so they'll see the project");
    const grants = [...pending.grants];
    const same = grants.find((g) => g.projectId === project.id);
    if (same) {
      same.listIds = [...new Set([...same.listIds, list.id])];
      same.role = role;
    } else grants.push(grant);
    await db().update(workspaceInvitations).set({ grants }).where(eq(workspaceInvitations.id, pending.id));
    return { token: null, email };
  }
}
