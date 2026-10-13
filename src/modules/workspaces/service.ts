import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import {
  projectMembers,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";
import { assertWorkspace, type ActorContext } from "@/server/authz/policy";
import type { WorkspaceRole } from "@/server/authz/matrix";
import { ConflictError, NotFoundError, ValidationError, assertId, pgErrorInfo } from "@/server/errors";
import { enqueueOutbox, recordActivity, recordAudit } from "@/modules/activity/service";
import {
  createWorkspaceInput,
  inviteMemberInput,
  type CreateWorkspaceInput,
  type InviteMemberInput,
} from "./validators";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Maps the deferred "keep one owner" trigger failure to a domain error. */
async function withOwnerInvariant<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (pgErrorInfo(error).constraint === "workspace_members_owner_required") {
      throw new ConflictError("A workspace must keep at least one active owner");
    }
    throw error;
  }
}

// ── Workspaces ────────────────────────────────────────────────────────────────────────────

export async function createWorkspace(userId: string, raw: CreateWorkspaceInput) {
  const input = createWorkspaceInput.parse(raw);
  try {
    return await db().transaction(async (tx) => {
      const [workspace] = await tx
        .insert(workspaces)
        .values({ name: input.name, slug: input.slug, createdBy: userId })
        .returning({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name });
      if (!workspace) throw new Error("insert returned no row");
      await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: "owner" });
      const actor: ActorContext = {
        userId,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        workspaceRole: "owner",
        actorKind: "user",
      };
      await recordActivity(tx, actor, { entityType: "workspace", entityId: workspace.id, action: "created" });
      await recordAudit(tx, { event: "workspace.created", workspaceId: workspace.id, actorId: userId });
      await enqueueOutbox(tx, workspace.id, "workspace.created", { workspaceId: workspace.id });
      return workspace;
    });
  } catch (error) {
    const { code, constraint } = pgErrorInfo(error);
    if (code === "23505" && constraint === "workspaces_slug_unique") {
      throw new ValidationError("That address is taken", { slug: "That address is already taken" });
    }
    throw error;
  }
}

/** Workspaces the user is an active member of (for the switcher). */
export async function listWorkspacesForUser(userId: string) {
  return db()
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
        isNull(workspaces.archivedAt),
      ),
    )
    .orderBy(asc(workspaces.name));
}

export async function getWorkspace(actor: ActorContext) {
  assertWorkspace(actor, "workspace.view");
  const [workspace] = await db()
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, actor.workspaceId));
  if (!workspace) throw new NotFoundError();
  return workspace;
}

// ── Members ───────────────────────────────────────────────────────────────────────────────

export async function listMembers(actor: ActorContext) {
  assertWorkspace(actor, "member.view_directory");
  return db()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: workspaceMembers.role,
      status: workspaceMembers.status,
      joinedAt: workspaceMembers.joinedAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, actor.workspaceId))
    .orderBy(asc(workspaceMembers.status), asc(users.name));
}

async function loadMember(tx: DbOrTx, workspaceId: string, userId: string) {
  const [member] = await tx
    .select({ role: workspaceMembers.role, status: workspaceMembers.status })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .for("update");
  if (!member) throw new NotFoundError("Member not found");
  return member;
}

export async function changeMemberRole(actor: ActorContext, targetUserId: string, newRole: WorkspaceRole) {
  assertWorkspace(actor, "member.change_role");
  assertId(targetUserId, "Member not found");
  return withOwnerInvariant(() =>
    db().transaction(async (tx) => {
      const member = await loadMember(tx, actor.workspaceId, targetUserId);
      if (member.role === newRole) return;
      // Granting or removing ownership is owner-only.
      if (member.role === "owner" || newRole === "owner") assertWorkspace(actor, "member.manage_owners");
      await tx
        .update(workspaceMembers)
        .set({ role: newRole })
        .where(
          and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, targetUserId)),
        );
      await recordActivity(tx, actor, {
        entityType: "workspace_member",
        entityId: targetUserId,
        action: "role_changed",
        changes: { role: [member.role, newRole] },
      });
      await recordAudit(tx, {
        event: "member.role_changed",
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        metadata: { targetUserId, from: member.role, to: newRole },
      });
    }),
  );
}

export async function setMemberStatus(
  actor: ActorContext,
  targetUserId: string,
  status: "active" | "deactivated",
) {
  assertWorkspace(actor, "member.deactivate");
  assertId(targetUserId, "Member not found");
  return withOwnerInvariant(() =>
    db().transaction(async (tx) => {
      const member = await loadMember(tx, actor.workspaceId, targetUserId);
      if (member.status === status) return;
      if (member.role === "owner") assertWorkspace(actor, "member.manage_owners");
      await tx
        .update(workspaceMembers)
        .set({ status })
        .where(
          and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, targetUserId)),
        );
      if (status === "deactivated") {
        // Explicit project access goes with the membership; history stays attributed.
        await tx
          .delete(projectMembers)
          .where(
            and(eq(projectMembers.workspaceId, actor.workspaceId), eq(projectMembers.userId, targetUserId)),
          );
      }
      await recordActivity(tx, actor, {
        entityType: "workspace_member",
        entityId: targetUserId,
        action: status === "active" ? "reactivated" : "deactivated",
        changes: { status: [member.status, status] },
      });
      await recordAudit(tx, {
        event: status === "active" ? "member.reactivated" : "member.deactivated",
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        metadata: { targetUserId },
      });
    }),
  );
}

// ── Invitations ───────────────────────────────────────────────────────────────────────────

export async function inviteMember(actor: ActorContext, raw: InviteMemberInput) {
  const input = inviteMemberInput.parse(raw);
  assertWorkspace(actor, "member.invite");
  if (input.role === "admin") assertWorkspace(actor, "member.invite_admin");

  const token = randomBytes(32).toString("base64url");
  try {
    return await db().transaction(async (tx) => {
      const [existing] = await tx
        .select({ status: workspaceMembers.status })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, actor.workspaceId),
            eq(sql`lower(${users.email})`, input.email),
          ),
        );
      if (existing?.status === "active") throw new ConflictError("That person is already a member");

      const [invitation] = await tx
        .insert(workspaceInvitations)
        .values({
          workspaceId: actor.workspaceId,
          email: input.email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedBy: actor.userId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        })
        .returning({ id: workspaceInvitations.id });
      if (!invitation) throw new Error("insert returned no row");
      await recordAudit(tx, {
        event: "member.invited",
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        metadata: { invitationId: invitation.id, email: input.email, role: input.role },
      });
      return { invitationId: invitation.id, token };
    });
  } catch (error) {
    if (pgErrorInfo(error).constraint === "workspace_invitations_pending_email_uq") {
      throw new ConflictError("There is already a pending invitation for that email");
    }
    throw error;
  }
}

export async function listPendingInvitations(actor: ActorContext) {
  assertWorkspace(actor, "member.invite");
  return db()
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      createdAt: workspaceInvitations.createdAt,
    })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, actor.workspaceId),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.revokedAt),
        gt(workspaceInvitations.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(workspaceInvitations.createdAt));
}

export async function revokeInvitation(actor: ActorContext, invitationId: string) {
  assertWorkspace(actor, "member.invite");
  assertId(invitationId, "Invitation not found");
  await db().transaction(async (tx) => {
    const [row] = await tx
      .update(workspaceInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(workspaceInvitations.id, invitationId),
          // Scoped to the actor's workspace: an ID from elsewhere matches nothing.
          eq(workspaceInvitations.workspaceId, actor.workspaceId),
          isNull(workspaceInvitations.acceptedAt),
          isNull(workspaceInvitations.revokedAt),
        ),
      )
      .returning({ id: workspaceInvitations.id });
    if (!row) throw new NotFoundError("Invitation not found");
    await recordAudit(tx, {
      event: "member.invitation_revoked",
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      metadata: { invitationId },
    });
  });
}

export type InvitationPreview =
  { status: "valid"; workspaceName: string; email: string; role: WorkspaceRole } | { status: "invalid" };

/** What the invite page may show for a token. Unknown, used, revoked and expired all look the same. */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const [row] = await db()
    .select({
      workspaceName: workspaces.name,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      acceptedAt: workspaceInvitations.acceptedAt,
      revokedAt: workspaceInvitations.revokedAt,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .where(eq(workspaceInvitations.tokenHash, hashToken(token)));
  if (!row || row.acceptedAt || row.revokedAt || row.expiresAt <= new Date()) return { status: "invalid" };
  return { status: "valid", workspaceName: row.workspaceName, email: row.email, role: row.role };
}

/**
 * Accepts an invitation for a signed-in user. The invitation is bound to its email
 * address, which must match the user's verified email.
 */
export async function acceptInvitation(
  user: { id: string; email: string; emailVerified: boolean },
  token: string,
): Promise<{ workspaceSlug: string }> {
  if (!user.emailVerified)
    throw new ValidationError("Verify your email address before accepting invitations");
  return db().transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.tokenHash, hashToken(token)))
      .for("update");
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
      throw new NotFoundError("This invitation is invalid or has expired");
    }
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenInvitationEmail(invitation.email);
    }

    const [existing] = await tx
      .select({ status: workspaceMembers.status })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, invitation.workspaceId), eq(workspaceMembers.userId, user.id)),
      )
      .for("update");
    if (!existing) {
      await tx.insert(workspaceMembers).values({
        workspaceId: invitation.workspaceId,
        userId: user.id,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
      });
    } else if (existing.status === "deactivated") {
      await tx
        .update(workspaceMembers)
        .set({ status: "active", role: invitation.role })
        .where(
          and(eq(workspaceMembers.workspaceId, invitation.workspaceId), eq(workspaceMembers.userId, user.id)),
        );
    }
    await tx
      .update(workspaceInvitations)
      .set({ acceptedAt: new Date(), acceptedBy: user.id })
      .where(eq(workspaceInvitations.id, invitation.id));

    const [workspace] = await tx
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, invitation.workspaceId));
    if (!workspace) throw new NotFoundError();
    const actor: ActorContext = {
      userId: user.id,
      workspaceId: invitation.workspaceId,
      workspaceSlug: workspace.slug,
      workspaceRole: invitation.role,
      actorKind: "user",
    };
    await recordActivity(tx, actor, {
      entityType: "workspace_member",
      entityId: user.id,
      action: "joined",
      metadata: { role: invitation.role, invitationId: invitation.id },
    });
    await recordAudit(tx, {
      event: "member.invitation_accepted",
      workspaceId: invitation.workspaceId,
      actorId: user.id,
      metadata: { invitationId: invitation.id, role: invitation.role },
    });
    await enqueueOutbox(tx, invitation.workspaceId, "member.joined", {
      userId: user.id,
      role: invitation.role,
    });
    return { workspaceSlug: workspace.slug };
  });
}

/** The invitation exists but was sent to a different address than the signed-in user's. */
export class ForbiddenInvitationEmail extends ValidationError {
  constructor(readonly invitedEmail: string) {
    super("This invitation was sent to a different email address. Sign in with that address to accept it.");
  }
}
