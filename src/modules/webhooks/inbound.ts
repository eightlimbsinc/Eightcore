import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { users, workspaceMembers } from "@/server/db/schema";
import { resolveActorById } from "@/server/authz/actor";
import { DomainError } from "@/server/errors";
import { env } from "@/server/env";
import { listStatusesFor, loadListAccess } from "@/modules/lists/service";
import { createTask, getTaskByRef, updateTask } from "@/modules/tasks/service";
import { createComment } from "@/modules/comments/service";
import { findInboundHook } from "./service";

const date = z.iso.date({ message: "Use YYYY-MM-DD" });
const priority = z.enum(["urgent", "high", "normal", "low", "none"]);

const inboundBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_task"),
    list_id: z.uuid(),
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20_000).optional(),
    priority: priority.optional(),
    due_date: date.nullable().optional(),
    status: z.string().trim().max(40).optional(),
    assignees: z.array(z.email()).max(20).optional(),
  }),
  z.object({
    action: z.literal("update_task"),
    task: z.string().trim().max(30),
    status: z.string().trim().max(40).optional(),
    priority: priority.optional(),
    due_date: date.nullable().optional(),
    comment: z.string().trim().max(10_000).optional(),
  }),
]);

type Result = { ok: boolean; status: number; body: Record<string, unknown> };
const fail = (status: number, error: string): Result => ({ ok: false, status, body: { ok: false, error } });

async function statusIdByName(listId: string, name: string | undefined) {
  if (!name) return undefined;
  const match = (await listStatusesFor(db(), listId)).find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );
  if (!match) throw new DomainError(`No status called “${name}” in that list`, "validation");
  return match.id;
}

/** Runs one incoming webhook request. Never throws: answers with a status and JSON. */
export async function handleInboundHook(token: string, raw: unknown): Promise<Result> {
  const hook = await findInboundHook(token);
  if (!hook) return fail(404, "Unknown address");
  const parsed = inboundBody.safeParse(raw);
  if (!parsed.success) {
    return fail(
      400,
      parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
    );
  }
  const input = parsed.data;
  try {
    const actor = await resolveActorById(hook.createdBy, hook.workspaceId, "integration");
    const url = (ref: string) =>
      new URL(`/w/${actor.workspaceSlug}/t/${ref}`, env().BETTER_AUTH_URL).toString();
    if (input.action === "create_task") {
      await loadListAccess(db(), actor, input.list_id);
      const emails = (input.assignees ?? []).map((e) => e.toLowerCase());
      const people = emails.length
        ? await db()
            .select({ id: users.id })
            .from(users)
            .innerJoin(
              workspaceMembers,
              and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.workspaceId, hook.workspaceId)),
            )
            .where(inArray(sql`lower(${users.email})`, emails))
        : [];
      const task = await createTask(actor, input.list_id, {
        title: input.title,
        description: input.description ?? "",
        priority: input.priority ?? "none",
        dueDate: input.due_date ?? null,
        statusId: await statusIdByName(input.list_id, input.status),
        assigneeIds: people.map((p) => p.id),
      });
      return { ok: true, status: 201, body: { ok: true, task: { ref: task.ref, url: url(task.ref) } } };
    }
    const { task } = await getTaskByRef(actor, input.task);
    const statusId = await statusIdByName(task.listId, input.status);
    const patch = {
      ...(statusId ? { statusId } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.due_date !== undefined ? { dueDate: input.due_date } : {}),
    };
    if (Object.keys(patch).length)
      await updateTask(actor, task.id, task.version, { ...patch, comment: input.comment });
    else if (input.comment) await createComment(actor, task.id, { body: input.comment });
    const ref = input.task.toUpperCase();
    return { ok: true, status: 200, body: { ok: true, task: { ref, url: url(ref) } } };
  } catch (error) {
    if (error instanceof DomainError) {
      const status =
        error.code === "forbidden"
          ? 403
          : error.code === "not_found"
            ? 404
            : error.code === "conflict"
              ? 409
              : 400;
      return fail(status, error.message);
    }
    console.error("[inbound hook]", error);
    return fail(500, "Something went wrong");
  }
}
