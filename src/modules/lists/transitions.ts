import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import { customFields, statusTransitions, taskFieldValues, taskLists } from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import type { ProjectRole } from "@/server/authz/matrix";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  assertId,
  pgErrorInfo,
} from "@/server/errors";
import { recordActivity } from "@/modules/activity/service";
import { listStatusesFor, loadListAccess } from "./service";

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, commenter: 1, editor: 2, manager: 3 };

const ruleInput = z.object({
  fromStatusId: z.uuid().nullable(),
  toStatusId: z.uuid(),
  minRole: z.enum(["editor", "manager"]).default("editor"),
  requireComment: z.boolean().default(false),
  requiredFieldIds: z.array(z.uuid()).max(20).default([]),
  /** What the move does to QA. */
  qaAction: z.enum(["start", "pass", "fail"]).nullable().default(null),
});
export type TransitionRuleInput = z.input<typeof ruleInput>;

/** Why a move needs more before it can happen (shown to the person; `need` drives the UI). */
export class TransitionError extends ValidationError {
  constructor(
    message: string,
    readonly need: "comment" | "role" | "fields" | "not_allowed",
  ) {
    super(message, { transition: need });
  }
}

function assertManage(role: ProjectRole) {
  if (!canProject(role, "transition.manage")) throw new ForbiddenError();
}

/** A list's rules, for the settings page. Anyone who can see the list can read them. */
export async function listTransitions(actor: ActorContext, listId: string) {
  const { list, role } = await loadListAccess(db(), actor, listId);
  const rules = await db()
    .select()
    .from(statusTransitions)
    .where(eq(statusTransitions.listId, listId))
    .orderBy(statusTransitions.createdAt);
  return {
    strict: list.transitionsStrict,
    rules: rules.map((r) => ({
      id: r.id,
      fromStatusId: r.fromStatusId,
      toStatusId: r.toStatusId,
      minRole: r.minRole as "editor" | "manager",
      requireComment: r.requireComment,
      requiredFieldIds: r.requiredFieldIds,
      qaAction: r.qaAction as "start" | "pass" | "fail" | null,
    })),
    can: { manage: canProject(role, "transition.manage") },
  };
}

/** Adds a rule, or replaces the one for the same from → to pair. */
export async function saveTransition(actor: ActorContext, listId: string, raw: TransitionRuleInput) {
  const input = ruleInput.parse(raw);
  try {
    return await db().transaction(async (tx) => {
      const { list, role } = await loadListAccess(tx, actor, listId);
      assertManage(role);
      const statuses = await listStatusesFor(tx, listId);
      const ids = new Set(statuses.map((s) => s.id));
      if (!ids.has(input.toStatusId) || (input.fromStatusId && !ids.has(input.fromStatusId))) {
        throw new NotFoundError("Status not found in this list");
      }
      if (input.fromStatusId === input.toStatusId) throw new ValidationError("Pick two different statuses");
      const fieldIds = [...new Set(input.requiredFieldIds)];
      if (fieldIds.length) {
        // Fields of this project that apply to this list.
        const fields = await tx
          .select({ id: customFields.id })
          .from(customFields)
          .where(
            and(
              inArray(customFields.id, fieldIds),
              eq(customFields.projectId, list.projectId),
              or(isNull(customFields.listId), eq(customFields.listId, listId)),
            ),
          );
        if (fields.length !== fieldIds.length) throw new NotFoundError("Field not found on this list");
      }
      const values = {
        workspaceId: actor.workspaceId,
        listId,
        fromStatusId: input.fromStatusId,
        toStatusId: input.toStatusId,
        minRole: input.minRole,
        requireComment: input.requireComment,
        requiredFieldIds: fieldIds,
        qaAction: input.qaAction,
      };
      const [row] = await tx
        .insert(statusTransitions)
        .values(values)
        .onConflictDoUpdate({
          target: [statusTransitions.listId, statusTransitions.fromStatusId, statusTransitions.toStatusId],
          set: {
            minRole: values.minRole,
            requireComment: values.requireComment,
            requiredFieldIds: fieldIds,
            qaAction: values.qaAction,
          },
        })
        .returning({ id: statusTransitions.id });
      await recordActivity(tx, actor, {
        entityType: "list",
        entityId: listId,
        action: "transition_saved",
        metadata: values,
      });
      return row!;
    });
  } catch (error) {
    if (pgErrorInfo(error).constraint === "status_transitions_pair_uq") {
      throw new ConflictError("There is already a rule for that move");
    }
    throw error;
  }
}

export async function deleteTransition(actor: ActorContext, transitionId: string) {
  assertId(transitionId, "Rule not found");
  await db().transaction(async (tx) => {
    const [rule] = await tx
      .select({ listId: statusTransitions.listId })
      .from(statusTransitions)
      .where(
        and(eq(statusTransitions.id, transitionId), eq(statusTransitions.workspaceId, actor.workspaceId)),
      );
    if (!rule) throw new NotFoundError("Rule not found");
    const { role } = await loadListAccess(tx, actor, rule.listId);
    assertManage(role);
    await tx.delete(statusTransitions).where(eq(statusTransitions.id, transitionId));
    await recordActivity(tx, actor, {
      entityType: "list",
      entityId: rule.listId,
      action: "transition_deleted",
      metadata: { transitionId },
    });
  });
}

/** Strict mode: only listed moves are allowed. */
export async function setTransitionsStrict(actor: ActorContext, listId: string, strict: boolean) {
  await db().transaction(async (tx) => {
    const { role } = await loadListAccess(tx, actor, listId);
    assertManage(role);
    await tx.update(taskLists).set({ transitionsStrict: strict }).where(eq(taskLists.id, listId));
  });
}

/**
 * Checks a move against the list's rules. Rules for "from → to" and "any → to" both apply;
 * their requirements add up (highest role, any comment requirement, all fields). In strict
 * mode a move needs at least one matching rule. Throws TransitionError when something is missing.
 */
export async function checkTransition(
  tx: DbOrTx,
  move: {
    listId: string;
    strict: boolean;
    role: ProjectRole;
    taskId: string;
    from: { id: string; name: string } | undefined;
    to: { id: string; name: string };
    comment?: string;
  },
) {
  const rules = await tx
    .select()
    .from(statusTransitions)
    .where(
      and(
        eq(statusTransitions.listId, move.listId),
        eq(statusTransitions.toStatusId, move.to.id),
        move.from
          ? or(isNull(statusTransitions.fromStatusId), eq(statusTransitions.fromStatusId, move.from.id))
          : isNull(statusTransitions.fromStatusId),
      ),
    );
  if (!rules.length) {
    if (move.strict) {
      throw new TransitionError(
        `This list doesn't allow moving tasks from “${move.from?.name ?? "?"}” to “${move.to.name}”.`,
        "not_allowed",
      );
    }
    return { qa: null };
  }
  const needsManager = rules.some((r) => r.minRole === "manager");
  if (needsManager && ROLE_RANK[move.role] < ROLE_RANK.manager) {
    throw new TransitionError(`Only project managers can move tasks to “${move.to.name}”.`, "role");
  }
  const fieldIds = [...new Set(rules.flatMap((r) => r.requiredFieldIds))];
  if (fieldIds.length) {
    const filled = await tx
      .select({ fieldId: taskFieldValues.fieldId })
      .from(taskFieldValues)
      .where(
        and(
          eq(taskFieldValues.taskId, move.taskId),
          inArray(taskFieldValues.fieldId, fieldIds),
          sql`(coalesce(${taskFieldValues.valueText}, '') <> '' or ${taskFieldValues.valueNumber} is not null
               or ${taskFieldValues.valueDate} is not null or ${taskFieldValues.valueBool} = true
               or ${taskFieldValues.valueOptionId} is not null or ${taskFieldValues.valueUserId} is not null)`,
        ),
      );
    const have = new Set(filled.map((f) => f.fieldId));
    const missing = fieldIds.filter((id) => !have.has(id));
    if (missing.length) {
      const names = await tx
        .select({ name: customFields.name })
        .from(customFields)
        .where(inArray(customFields.id, missing));
      throw new TransitionError(
        `Fill in ${names.map((n) => `“${n.name}”`).join(", ")} before moving to “${move.to.name}”.`,
        "fields",
      );
    }
  }
  // A QA fail beats a pass, which beats starting a round.
  const qa = (["fail", "pass", "start"] as const).find((a) => rules.some((r) => r.qaAction === a)) ?? null;
  if ((rules.some((r) => r.requireComment) || qa === "fail") && !move.comment?.trim()) {
    throw new TransitionError(
      qa === "fail"
        ? `Moving to “${move.to.name}” fails QA: say what failed.`
        : `Moving to “${move.to.name}” needs a comment.`,
      "comment",
    );
  }
  return { qa };
}
