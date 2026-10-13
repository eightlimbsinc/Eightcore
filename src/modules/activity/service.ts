import "server-only";
import type { DbOrTx } from "@/server/db";
import { activityEvents, auditLog, outboxEvents } from "@/server/db/schema";
import type { ActorContext } from "@/server/authz/policy";

export interface ActivityInput {
  entityType: string;
  entityId: string;
  action: string;
  changes?: Record<string, [unknown, unknown]>;
  metadata?: Record<string, unknown>;
}

/** Record a domain change. Call inside the same transaction as the change itself. */
export async function recordActivity(tx: DbOrTx, actor: ActorContext, input: ActivityInput): Promise<void> {
  await tx.insert(activityEvents).values({
    workspaceId: actor.workspaceId,
    actorId: actor.actorKind === "user" ? actor.userId : null,
    actorKind: actor.actorKind,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changes: input.changes ?? {},
    metadata: input.metadata ?? {},
    requestId: actor.requestId,
  });
}

/** Enqueue an event for asynchronous consumers (automations, notifications, webhooks). */
export async function enqueueOutbox(
  tx: DbOrTx,
  workspaceId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(outboxEvents).values({ workspaceId, type, payload });
}

export interface AuditInput {
  event: string;
  workspaceId?: string | null;
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/** Security-relevant event (sign-in, role change, invitation...). */
export async function recordAudit(tx: DbOrTx, input: AuditInput): Promise<void> {
  await tx.insert(auditLog).values({
    event: input.event,
    workspaceId: input.workspaceId ?? null,
    actorId: input.actorId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata ?? {},
  });
}
