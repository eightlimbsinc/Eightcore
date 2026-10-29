import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import { listStatuses, statusTemplates, tasks } from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  assertId,
  pgErrorInfo,
} from "@/server/errors";
import { recordActivity } from "@/modules/activity/service";
import { STATUS_TEMPLATES, isClosedCategory, type StatusCategory, type StatusTemplateKey } from "./templates";
import { statusInput } from "./validators";
import { listStatusesFor, loadListAccess } from "./service";

const templateName = z.string().trim().min(1, "Name is required").max(60, "Use at most 60 characters");
const templateStatuses = z.array(statusInput).min(1).max(30);

export type TemplateStatus = { name: string; category: StatusCategory; color: string };

/** A template to apply: a built-in one by key, or a saved one by id. */
export type TemplateSource = { builtin: StatusTemplateKey } | { id: string };

/** The workspace's saved templates (anyone in the workspace can see and use them). */
export async function listStatusTemplates(actor: ActorContext) {
  const rows = await db()
    .select({
      id: statusTemplates.id,
      name: statusTemplates.name,
      statuses: statusTemplates.statuses,
      createdBy: statusTemplates.createdBy,
    })
    .from(statusTemplates)
    .where(eq(statusTemplates.workspaceId, actor.workspaceId))
    .orderBy(asc(sql`lower(${statusTemplates.name})`));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    statuses: templateStatuses.catch([]).parse(r.statuses) as TemplateStatus[],
    canDelete: r.createdBy === actor.userId || ["owner", "admin"].includes(actor.workspaceRole),
  }));
}

/** The statuses of a template, checked (a saved one must belong to the actor's workspace). */
export async function templateStatusesFor(tx: DbOrTx, actor: ActorContext, source: TemplateSource) {
  if ("builtin" in source) {
    const builtin = STATUS_TEMPLATES[source.builtin];
    if (!builtin) throw new NotFoundError("Template not found");
    return builtin.statuses as readonly TemplateStatus[];
  }
  assertId(source.id, "Template not found");
  const [row] = await tx
    .select({ statuses: statusTemplates.statuses })
    .from(statusTemplates)
    .where(and(eq(statusTemplates.id, source.id), eq(statusTemplates.workspaceId, actor.workspaceId)));
  if (!row) throw new NotFoundError("Template not found");
  return templateStatuses.parse(row.statuses) as TemplateStatus[];
}

/** Saves a list's current statuses as a named template for the workspace (list managers). */
export async function saveStatusTemplate(actor: ActorContext, listId: string, rawName: string) {
  const name = templateName.parse(rawName);
  try {
    return await db().transaction(async (tx) => {
      const { role } = await loadListAccess(tx, actor, listId);
      if (!canProject(role, "list.manage")) throw new ForbiddenError();
      const statuses = (await listStatusesFor(tx, listId)).map(({ name, category, color }) => ({
        name,
        category,
        color,
      }));
      const [row] = await tx
        .insert(statusTemplates)
        .values({ workspaceId: actor.workspaceId, name, statuses, createdBy: actor.userId })
        .returning({ id: statusTemplates.id });
      await recordActivity(tx, actor, {
        entityType: "status_template",
        entityId: row!.id,
        action: "created",
        metadata: { name, fromListId: listId },
      });
      return row!;
    });
  } catch (error) {
    if (pgErrorInfo(error).constraint === "status_templates_workspace_name_uq") {
      throw new ConflictError(`A template called “${name}” already exists. Pick another name.`);
    }
    throw error;
  }
}

/** Deletes a saved template: whoever saved it, or a workspace owner/admin. Lists keep their statuses. */
export async function deleteStatusTemplate(actor: ActorContext, templateId: string) {
  assertId(templateId, "Template not found");
  await db().transaction(async (tx) => {
    const [row] = await tx
      .select({ name: statusTemplates.name, createdBy: statusTemplates.createdBy })
      .from(statusTemplates)
      .where(and(eq(statusTemplates.id, templateId), eq(statusTemplates.workspaceId, actor.workspaceId)));
    if (!row) throw new NotFoundError("Template not found");
    if (row.createdBy !== actor.userId && !["owner", "admin"].includes(actor.workspaceRole)) {
      throw new ForbiddenError();
    }
    await tx.delete(statusTemplates).where(eq(statusTemplates.id, templateId));
    await recordActivity(tx, actor, {
      entityType: "status_template",
      entityId: templateId,
      action: "deleted",
      metadata: { name: row.name },
    });
  });
}

/**
 * Replaces a list's statuses with a template's, keeping every task:
 * a status whose name is in the template is kept (updated to the template's category,
 * colour and place); other statuses are removed and their tasks move to the first template
 * status of the same category, else the same kind (finished or not), else the first one.
 */
export async function applyStatusTemplate(actor: ActorContext, listId: string, source: TemplateSource) {
  return db().transaction(async (tx) => {
    const { role } = await loadListAccess(tx, actor, listId);
    if (!canProject(role, "list.manage")) throw new ForbiddenError();
    const template = await templateStatusesFor(tx, actor, source);
    const lowerNames = template.map((s) => s.name.toLowerCase());
    if (new Set(lowerNames).size !== lowerNames.length) {
      throw new ValidationError("The template has two statuses with the same name");
    }
    const current = await listStatusesFor(tx, listId);
    const positions = generateNKeysBetween(null, null, template.length);

    // Kept or new statuses, in template order.
    const result: { id: string; category: StatusCategory }[] = [];
    for (const [i, s] of template.entries()) {
      const match = current.find((c) => c.name.toLowerCase() === s.name.toLowerCase());
      if (match) {
        await tx
          .update(listStatuses)
          .set({ name: s.name, category: s.category, color: s.color, position: positions[i]! })
          .where(eq(listStatuses.id, match.id));
        if (isClosedCategory(match.category) !== isClosedCategory(s.category)) {
          await tx
            .update(tasks)
            .set({
              completedAt: isClosedCategory(s.category) ? sql`coalesce(${tasks.completedAt}, now())` : null,
            })
            .where(eq(tasks.statusId, match.id));
        }
        result.push({ id: match.id, category: s.category });
      } else {
        const [row] = await tx
          .insert(listStatuses)
          .values({
            workspaceId: actor.workspaceId,
            listId,
            name: s.name,
            category: s.category,
            color: s.color,
            position: positions[i]!,
          })
          .returning({ id: listStatuses.id });
        result.push({ id: row!.id, category: s.category });
      }
    }

    // Statuses not in the template: move their tasks, then remove them.
    const keptIds = new Set(result.map((r) => r.id));
    let moved = 0;
    const removed = current.filter((c) => !keptIds.has(c.id));
    for (const old of removed) {
      const target =
        result.find((r) => r.category === old.category) ??
        result.find((r) => isClosedCategory(r.category) === isClosedCategory(old.category)) ??
        result[0]!;
      const closed = isClosedCategory(target.category);
      const updated = await tx
        .update(tasks)
        .set({
          statusId: target.id,
          completedAt: closed ? sql`coalesce(${tasks.completedAt}, now())` : null,
          version: sql`${tasks.version} + 1`,
        })
        .where(eq(tasks.statusId, old.id))
        .returning({ id: tasks.id });
      moved += updated.length;
    }
    if (removed.length) {
      await tx.delete(listStatuses).where(
        inArray(
          listStatuses.id,
          removed.map((r) => r.id),
        ),
      );
    }
    await recordActivity(tx, actor, {
      entityType: "list",
      entityId: listId,
      action: "status_template_applied",
      metadata: {
        template: "builtin" in source ? source.builtin : source.id,
        removed: removed.map((r) => r.name),
        movedTasks: moved,
      },
    });
    return { removed: removed.map((r) => r.name), movedTasks: moved };
  });
}
