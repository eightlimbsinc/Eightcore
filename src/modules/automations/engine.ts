import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  automationRuns,
  automations,
  listStatuses,
  projects,
  taskAssignees,
  taskLists,
  taskTags,
  tasks,
  users,
  workspaces,
} from "@/server/db/schema";
import { resolveActorById } from "@/server/authz/actor";
import { withCausationDepth } from "@/server/causation";
import { env } from "@/server/env";
import { DomainError } from "@/server/errors";
import { getTaskByRef, setTaskAssignees, updateTask } from "@/modules/tasks/service";
import { createComment } from "@/modules/comments/service";
import { setTaskTags } from "@/modules/tags/service";
import { deliverDueWebhooks, endpointsFor, queueDelivery } from "@/modules/webhooks/service";
import { MAX_CHAIN_DEPTH, actionSchema, conditionSchema, triggerSchema, type Action } from "./rules";

type OutboxRow = {
  id: number;
  workspace_id: string;
  type: string;
  payload: Record<string, unknown>;
  causation_depth: number;
  created_at: string;
};

/** The task as automations and webhooks see it. */
async function taskSnapshot(taskId: string) {
  const [t] = await db()
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      statusId: tasks.statusId,
      statusName: listStatuses.name,
      statusCategory: listStatuses.category,
      listId: tasks.listId,
      listName: taskLists.name,
      projectId: tasks.projectId,
      workspaceId: tasks.workspaceId,
      projectKey: projects.key,
      projectName: projects.name,
      workspaceSlug: workspaces.slug,
      archivedAt: tasks.archivedAt,
    })
    .from(tasks)
    .innerJoin(listStatuses, eq(listStatuses.id, tasks.statusId))
    .innerJoin(taskLists, eq(taskLists.id, tasks.listId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .where(eq(tasks.id, taskId));
  if (!t) return null;
  const [assignees, tagRows] = await Promise.all([
    db()
      .select({ userId: users.id, name: users.name, email: users.email })
      .from(taskAssignees)
      .innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(eq(taskAssignees.taskId, taskId)),
    db().select({ tagId: taskTags.tagId }).from(taskTags).where(eq(taskTags.taskId, taskId)),
  ]);
  const ref = `${t.projectKey}-${t.number}`;
  return {
    ...t,
    ref,
    url: new URL(`/w/${t.workspaceSlug}/t/${ref}`, env().BETTER_AUTH_URL).toString(),
    assignees,
    tagIds: tagRows.map((r) => r.tagId),
  };
}
type Snapshot = NonNullable<Awaited<ReturnType<typeof taskSnapshot>>>;

/** What webhooks receive: the event, the task as it is now, and the event's own details. */
function webhookPayload(
  eventType: string,
  task: Snapshot,
  data: Record<string, unknown>,
  occurredAt: string,
) {
  return {
    event: eventType,
    occurredAt,
    workspace: task.workspaceSlug,
    task: {
      id: task.id,
      ref: task.ref,
      title: task.title,
      url: task.url,
      status: { name: task.statusName, category: task.statusCategory },
      priority: task.priority,
      dueDate: task.dueDate,
      list: task.listName,
      project: { key: task.projectKey, name: task.projectName },
      assignees: task.assignees.map((a) => ({ name: a.name, email: a.email })),
    },
    data,
  };
}

/** Does this automation's trigger match the event? */
function triggerMatches(rawTrigger: unknown, event: OutboxRow) {
  const trigger = triggerSchema.safeParse(rawTrigger);
  if (!trigger.success) return false;
  const t = trigger.data;
  const p = event.payload;
  const fields = Array.isArray(p.fields) ? (p.fields as string[]) : [];
  switch (t.type) {
    case "task_created":
      return event.type === "task.created";
    case "status_changed":
      return (
        event.type === "task.updated" &&
        fields.includes("status") &&
        (!t.toStatusId || p.toStatusId === t.toStatusId) &&
        (!t.fromStatusId || p.fromStatusId === t.fromStatusId)
      );
    case "assignee_added": {
      const added = Array.isArray(p.added) ? (p.added as string[]) : [];
      return (
        event.type === "task.assignees_changed" && added.length > 0 && (!t.userId || added.includes(t.userId))
      );
    }
    case "priority_changed":
      return (
        event.type === "task.updated" &&
        fields.includes("priority") &&
        (!t.priority || p.priority === t.priority)
      );
    case "comment_added":
      return event.type === "comment.created";
    case "qa_concluded":
      return event.type === "qa.concluded" && (!t.result || p.result === t.result);
  }
}

function conditionsHold(rawConditions: unknown[], task: Snapshot) {
  return rawConditions.every((raw) => {
    const parsed = conditionSchema.safeParse(raw);
    if (!parsed.success) return false;
    const c = parsed.data;
    switch (c.type) {
      case "status_is":
        return c.statusIds.includes(task.statusId);
      case "priority_is":
        return c.priorities.includes(task.priority);
      case "has_tag":
        return task.tagIds.includes(c.tagId);
      case "assignee_is":
        return c.userId === "none"
          ? task.assignees.length === 0
          : task.assignees.some((a) => a.userId === c.userId);
    }
  });
}

/** Runs one action as the automation's creator. Uses the same services (and checks) as a person. */
async function runAction(
  actor: Awaited<ReturnType<typeof resolveActorById>>,
  action: Action,
  task: Snapshot,
  automation: { id: string; name: string },
  event: OutboxRow,
) {
  const version = async () => (await getTaskByRef(actor, task.ref)).task.version;
  switch (action.type) {
    case "set_status":
      if (task.statusId === action.statusId) return "already in that status";
      await updateTask(actor, task.id, await version(), {
        statusId: action.statusId,
        comment: `Moved by the automation “${automation.name}”.`,
      });
      return "status changed";
    case "set_priority":
      await updateTask(actor, task.id, await version(), { priority: action.priority });
      return "priority set";
    case "set_due": {
      const due = new Date(Date.now() + action.days * 86_400_000).toISOString().slice(0, 10);
      await updateTask(actor, task.id, await version(), { dueDate: due });
      return `due ${due}`;
    }
    case "assign": {
      const ids = new Set(task.assignees.map((a) => a.userId));
      if (ids.has(action.userId)) return "already assigned";
      await setTaskAssignees(actor, task.id, [...ids, action.userId]);
      return "assigned";
    }
    case "unassign_all":
      await setTaskAssignees(actor, task.id, []);
      return "unassigned";
    case "add_comment":
      await createComment(actor, task.id, { body: action.body });
      return "commented";
    case "add_tag":
      await setTaskTags(actor, task.id, [...new Set([...task.tagIds, action.tagId])]);
      return "tag added";
    case "send_webhook":
      await queueDelivery(
        db(),
        task.workspaceId,
        action.endpointId,
        "automation",
        webhookPayload(
          "automation",
          task,
          { automation: automation.name, cause: event.type },
          event.created_at,
        ),
      );
      return "webhook queued";
  }
}

async function handleEvent(event: OutboxRow) {
  const taskId = typeof event.payload.taskId === "string" ? event.payload.taskId : null;
  if (!taskId) return;
  const task = await taskSnapshot(taskId);
  if (!task || task.archivedAt) return;

  // Webhooks subscribed to this event type.
  const endpoints = await endpointsFor(db(), event.workspace_id, event.type, task.projectId);
  for (const e of endpoints) {
    await queueDelivery(
      db(),
      event.workspace_id,
      e.id,
      event.type,
      webhookPayload(event.type, task, event.payload, event.created_at),
    );
  }

  // Automations of the task's project (and list).
  const rules = await db()
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.projectId, task.projectId),
        eq(automations.enabled, true),
        or(isNull(automations.listId), eq(automations.listId, task.listId)),
      ),
    );
  for (const rule of rules) {
    if (!triggerMatches(rule.trigger, event)) continue;
    const record = async (status: "success" | "failed" | "skipped", message: string) => {
      await db()
        .insert(automationRuns)
        .values({
          workspaceId: rule.workspaceId,
          automationId: rule.id,
          taskId,
          outboxEventId: event.id,
          status,
          message,
        })
        .onConflictDoNothing();
    };
    if (!conditionsHold(rule.conditions, task)) continue;
    if (event.causation_depth >= MAX_CHAIN_DEPTH) {
      await record("skipped", `Stopped: automations triggered each other ${MAX_CHAIN_DEPTH} times in a row`);
      continue;
    }
    const done: string[] = [];
    try {
      const actor = await resolveActorById(rule.createdBy, rule.workspaceId, "automation");
      // Whatever the actions cause is one level deeper (the loop guard counts it).
      await withCausationDepth(event.causation_depth + 1, async () => {
        for (const raw of rule.actions) {
          const action = actionSchema.parse(raw);
          // Re-read between actions so each sees the effect of the last.
          const current = (await taskSnapshot(taskId)) ?? task;
          done.push(await runAction(actor, action, current, rule, event));
        }
      });
      await record("success", done.join(", "));
    } catch (error) {
      const reason = error instanceof DomainError ? error.message : "Something went wrong";
      if (!(error instanceof DomainError)) console.error("[automation]", rule.id, error);
      await record("failed", [...done, reason].join(" · ").slice(0, 500));
    }
  }
}

/**
 * Works through new events: runs matching automations, queues webhook deliveries, then sends
 * what's due. Safe to call often and in parallel (events are claimed with SKIP LOCKED).
 */
export async function processOutbox(options: { limit?: number } = {}) {
  const claimed = await db().execute<OutboxRow>(sql`
    update outbox_events set dispatched_at = now()
     where id in (
       select id from outbox_events where dispatched_at is null order by id limit ${options.limit ?? 50}
       for update skip locked)
    returning id, workspace_id, type, payload, causation_depth, created_at`);
  const events = [...claimed.rows].sort((a, b) => Number(a.id) - Number(b.id));
  for (const event of events) {
    try {
      await handleEvent({ ...event, id: Number(event.id), causation_depth: Number(event.causation_depth) });
    } catch (error) {
      console.error("[outbox] event", event.id, error);
    }
  }
  const sent = await deliverDueWebhooks();
  return { events: events.length, deliveries: sent };
}
