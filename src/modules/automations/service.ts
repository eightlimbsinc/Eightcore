import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import {
  automationRuns,
  automations,
  listStatuses,
  tags,
  taskLists,
  webhookEndpoints,
} from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import { ForbiddenError, NotFoundError, ValidationError, assertId } from "@/server/errors";
import { recordActivity } from "@/modules/activity/service";
import { loadProjectAccess } from "@/modules/projects/service";
import { assignableUserIds } from "@/modules/tasks/service";
import { automationInput, type AutomationInput } from "./rules";

async function projectAccess(actor: ActorContext, projectId: string) {
  assertId(projectId, "Project not found");
  const access = await loadProjectAccess(db(), actor, { id: projectId });
  if (!canProject(access.role, "automation.manage")) throw new ForbiddenError();
  return access;
}

/** Every id an automation names must belong to its project (or workspace, for webhooks). */
async function checkReferences(
  actor: ActorContext,
  projectId: string,
  project: { visibility: "workspace" | "private" },
  input: ReturnType<typeof automationInput.parse>,
) {
  const lists = await db()
    .select({ id: taskLists.id })
    .from(taskLists)
    .where(eq(taskLists.projectId, projectId));
  const listIds = new Set(lists.map((l) => l.id));
  if (input.listId && !listIds.has(input.listId)) throw new NotFoundError("List not found in this project");

  const statusIds = new Set<string>();
  const tagIds = new Set<string>();
  const userIds = new Set<string>();
  const endpointIds = new Set<string>();
  const t = input.trigger;
  if (t.type === "status_changed") [t.fromStatusId, t.toStatusId].forEach((id) => id && statusIds.add(id));
  if (t.type === "assignee_added" && t.userId) userIds.add(t.userId);
  for (const c of input.conditions) {
    if (c.type === "status_is") c.statusIds.forEach((id) => statusIds.add(id));
    if (c.type === "has_tag") tagIds.add(c.tagId);
    if (c.type === "assignee_is" && c.userId !== "none") userIds.add(c.userId);
  }
  for (const a of input.actions) {
    if (a.type === "set_status") statusIds.add(a.statusId);
    if (a.type === "assign") userIds.add(a.userId);
    if (a.type === "add_tag") tagIds.add(a.tagId);
    if (a.type === "send_webhook") endpointIds.add(a.endpointId);
  }
  if (statusIds.size) {
    const rows = await db()
      .select({ id: listStatuses.id, listId: listStatuses.listId })
      .from(listStatuses)
      .where(inArray(listStatuses.id, [...statusIds]));
    const ok =
      rows.length === statusIds.size &&
      rows.every((r) => listIds.has(r.listId) && (!input.listId || r.listId === input.listId));
    if (!ok)
      throw new NotFoundError(
        input.listId ? "Status not found in this list" : "Status not found in this project",
      );
    if (!input.listId && new Set(rows.map((r) => r.listId)).size > 1) {
      throw new ValidationError("Statuses from different lists: choose one list for this automation");
    }
  }
  if (tagIds.size) {
    const rows = await db()
      .select({ id: tags.id })
      .from(tags)
      .where(and(inArray(tags.id, [...tagIds]), eq(tags.projectId, projectId)));
    if (rows.length !== tagIds.size) throw new NotFoundError("Tag not found in this project");
  }
  if (userIds.size) {
    const allowed = await assignableUserIds(db(), actor, projectId, project.visibility, input.listId);
    if ([...userIds].some((id) => !allowed.has(id)))
      throw new NotFoundError("That person can't be assigned in this project");
  }
  if (endpointIds.size) {
    const rows = await db()
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(
        and(
          inArray(webhookEndpoints.id, [...endpointIds]),
          eq(webhookEndpoints.workspaceId, actor.workspaceId),
        ),
      );
    if (rows.length !== endpointIds.size) throw new NotFoundError("Webhook not found");
  }
}

export async function listAutomations(actor: ActorContext, projectId: string) {
  await projectAccess(actor, projectId);
  const rows = await db()
    .select()
    .from(automations)
    .where(eq(automations.projectId, projectId))
    .orderBy(automations.createdAt);
  const runs = rows.length
    ? await db()
        .select({
          automationId: automationRuns.automationId,
          status: automationRuns.status,
          message: automationRuns.message,
          createdAt: automationRuns.createdAt,
        })
        .from(automationRuns)
        .where(
          inArray(
            automationRuns.automationId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(desc(automationRuns.id))
        .limit(200)
    : [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    listId: r.listId,
    enabled: r.enabled,
    definition: automationInput.parse({
      name: r.name,
      listId: r.listId,
      enabled: r.enabled,
      trigger: r.trigger,
      conditions: r.conditions,
      actions: r.actions,
    }),
    recentRuns: runs.filter((x) => x.automationId === r.id).slice(0, 10),
  }));
}

/** Creates an automation, or replaces one (with `automationId`). */
export async function saveAutomation(
  actor: ActorContext,
  projectId: string,
  raw: AutomationInput,
  automationId?: string,
) {
  const { project } = await projectAccess(actor, projectId);
  const input = automationInput.parse(raw);
  await checkReferences(actor, projectId, project, input);
  const values = {
    name: input.name,
    listId: input.listId,
    enabled: input.enabled,
    trigger: input.trigger,
    conditions: input.conditions,
    actions: input.actions,
  };
  return db().transaction(async (tx) => {
    let id = automationId;
    if (id) {
      assertId(id, "Automation not found");
      const updated = await tx
        .update(automations)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(automations.id, id), eq(automations.projectId, projectId)))
        .returning({ id: automations.id });
      if (!updated.length) throw new NotFoundError("Automation not found");
    } else {
      const [row] = await tx
        .insert(automations)
        .values({ workspaceId: actor.workspaceId, projectId, createdBy: actor.userId, ...values })
        .returning({ id: automations.id });
      id = row!.id;
    }
    await recordActivity(tx, actor, {
      entityType: "automation",
      entityId: id,
      action: automationId ? "updated" : "created",
      metadata: { name: input.name, projectId },
    });
    return { id };
  });
}

async function loadAutomation(actor: ActorContext, automationId: string) {
  assertId(automationId, "Automation not found");
  const [row] = await db()
    .select({ id: automations.id, projectId: automations.projectId, name: automations.name })
    .from(automations)
    .where(and(eq(automations.id, automationId), eq(automations.workspaceId, actor.workspaceId)));
  if (!row) throw new NotFoundError("Automation not found");
  await projectAccess(actor, row.projectId);
  return row;
}

export async function setAutomationEnabled(actor: ActorContext, automationId: string, enabled: boolean) {
  await loadAutomation(actor, automationId);
  await db()
    .update(automations)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(automations.id, automationId));
}

export async function deleteAutomation(actor: ActorContext, automationId: string) {
  const row = await loadAutomation(actor, automationId);
  await db().transaction(async (tx) => {
    await tx.delete(automations).where(eq(automations.id, automationId));
    await recordActivity(tx, actor, {
      entityType: "automation",
      entityId: automationId,
      action: "deleted",
      metadata: { name: row.name, projectId: row.projectId },
    });
  });
}
