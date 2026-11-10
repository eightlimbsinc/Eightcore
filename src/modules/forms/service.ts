import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { formSubmissions, listForms, projects, taskLists, workspaces } from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import { resolveActorById } from "@/server/authz/actor";
import { env } from "@/server/env";
import { ForbiddenError, NotFoundError, ValidationError, assertId } from "@/server/errors";
import { recordActivity } from "@/modules/activity/service";
import { listStatusesFor, loadListAccess } from "@/modules/lists/service";
import { createTask, listAssignableMembers } from "@/modules/tasks/service";
import { listProjectFields, setTaskFieldValues } from "@/modules/fields/service";
import { parseFieldValue, type FieldType } from "@/modules/fields/validators";
import { uploadTaskAttachments } from "@/modules/attachments/service";
import { isClosedCategory } from "@/modules/lists/templates";
import {
  FORM_MAX_FILES,
  FORM_MAX_TOTAL_BYTES,
  formInput,
  newFieldKey,
  type FormField,
  type FormInput,
} from "./rules";

const newToken = () => randomBytes(18).toString("base64url");

async function manageable(actor: ActorContext, listId: string) {
  const access = await loadListAccess(db(), actor, listId);
  if (!canProject(access.role, "form.manage")) throw new ForbiddenError();
  return access;
}

async function loadForm(actor: ActorContext, formId: string) {
  assertId(formId, "Form not found");
  const [form] = await db()
    .select()
    .from(listForms)
    .where(and(eq(listForms.id, formId), eq(listForms.workspaceId, actor.workspaceId)));
  if (!form) throw new NotFoundError("Form not found");
  const access = await manageable(actor, form.listId);
  return { form, ...access };
}

/** The list's forms, for its view tabs (anyone who can see the list). */
export async function listFormsFor(actor: ActorContext, listId: string) {
  await loadListAccess(db(), actor, listId);
  return db()
    .select({ id: listForms.id, name: listForms.name, enabled: listForms.enabled })
    .from(listForms)
    .where(eq(listForms.listId, listId))
    .orderBy(asc(listForms.createdAt));
}

/** A new form with a title and details question; returns its id. */
export async function createForm(actor: ActorContext, listId: string, rawName?: string) {
  const { list, project } = await manageable(actor, listId);
  const fields: FormField[] = [
    { key: newFieldKey(), kind: "title", label: "Request title", help: "", required: true, multiline: false },
    { key: newFieldKey(), kind: "description", label: "Details", help: "", required: false, multiline: true },
  ];
  const name = (rawName ?? "").trim().slice(0, 120) || `${list.name} request form`;
  const [row] = await db()
    .insert(listForms)
    .values({
      workspaceId: actor.workspaceId,
      projectId: project.id,
      listId: list.id,
      name,
      fields,
      token: newToken(),
      createdBy: actor.userId,
    })
    .returning({ id: listForms.id });
  await recordActivity(db(), actor, {
    entityType: "form",
    entityId: row!.id,
    action: "created",
    metadata: { listId: list.id, name },
  });
  return { id: row!.id };
}

/** The form builder's data: the form, and what its questions can map to. */
export async function getFormForEditing(actor: ActorContext, formId: string) {
  const { form, list, project } = await loadForm(actor, formId);
  const [statuses, people, { fields }, responses] = await Promise.all([
    listStatusesFor(db(), list.id),
    listAssignableMembers(actor, project.id, list.id),
    listProjectFields(actor, project.id),
    db().select({ n: count() }).from(formSubmissions).where(eq(formSubmissions.formId, form.id)),
  ]);
  return {
    form: {
      id: form.id,
      name: form.name,
      description: form.description,
      fields: form.fields,
      statusId: form.statusId,
      assigneeIds: form.assigneeIds,
      submitMessage: form.submitMessage,
      enabled: form.enabled,
      token: form.token,
      responses: responses[0]?.n ?? 0,
    },
    list: { id: list.id, name: list.name },
    project: { id: project.id, key: project.key, name: project.name },
    statuses: statuses.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    people: people.map((p) => ({ id: p.userId, name: p.name })),
    customFields: fields
      .filter((f) => !f.listId || f.listId === list.id)
      .map((f) => ({ id: f.id, name: f.name, type: f.type })),
  };
}

export async function updateForm(actor: ActorContext, formId: string, raw: FormInput) {
  const { form, list, project } = await loadForm(actor, formId);
  const input = formInput.parse(raw);
  const { fields } = await listProjectFields(actor, project.id);
  const usable = new Set(fields.filter((f) => !f.listId || f.listId === list.id).map((f) => f.id));
  for (const f of input.fields) {
    if (f.kind === "custom_field" && (!f.fieldId || !usable.has(f.fieldId)))
      throw new ValidationError(`“${f.label}”: that custom field isn't on this list`);
  }
  if (input.statusId) {
    const statuses = await listStatusesFor(db(), list.id);
    if (!statuses.some((s) => s.id === input.statusId))
      throw new ValidationError("Pick a status from this list");
  }
  if (input.assigneeIds.length) {
    const allowed = new Set((await listAssignableMembers(actor, project.id, list.id)).map((p) => p.userId));
    if (input.assigneeIds.some((id) => !allowed.has(id)))
      throw new ValidationError("Someone picked to assign can't see this list");
  }
  await db()
    .update(listForms)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(listForms.id, form.id));
}

/** A new public link; the old one stops working. */
export async function regenerateFormLink(actor: ActorContext, formId: string) {
  const { form } = await loadForm(actor, formId);
  await db()
    .update(listForms)
    .set({ token: newToken(), updatedAt: new Date() })
    .where(eq(listForms.id, form.id));
}

export async function deleteForm(actor: ActorContext, formId: string) {
  const { form } = await loadForm(actor, formId);
  await db().delete(listForms).where(eq(listForms.id, form.id));
  await recordActivity(db(), actor, {
    entityType: "form",
    entityId: form.id,
    action: "deleted",
    metadata: { listId: form.listId, name: form.name },
  });
  return { listId: form.listId };
}

// ── Public side ───────────────────────────────────────────────────────────────────────

/** A form by its link, ready to show to anyone (null when off, missing, or its list is gone). */
export async function getPublicForm(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const [row] = await db()
    .select({
      form: listForms,
      workspaceName: workspaces.name,
      projectArchived: projects.archivedAt,
      listArchived: taskLists.archivedAt,
    })
    .from(listForms)
    .innerJoin(taskLists, eq(taskLists.id, listForms.listId))
    .innerJoin(projects, eq(projects.id, listForms.projectId))
    .innerJoin(workspaces, eq(workspaces.id, listForms.workspaceId))
    .where(eq(listForms.token, token));
  if (!row || !row.form.enabled || row.projectArchived || row.listArchived) return null;
  const { form } = row;
  // Options and types for custom-field questions (read directly: there's no signed-in person here).
  const ids = form.fields.filter((f) => f.kind === "custom_field" && f.fieldId).map((f) => f.fieldId!);
  const custom = ids.length
    ? await db().execute<{
        id: string;
        type: FieldType;
        options: { id: string; label: string }[] | null;
      }>(sql`
        select f.id, f.type,
               (select json_agg(json_build_object('id', o.id, 'label', o.label) order by o.position)
                  from custom_field_options o where o.field_id = f.id) as options
          from custom_fields f
         where f.id in (${sql.join(
           ids.map((id) => sql`${id}::uuid`),
           sql`, `,
         )}) and f.project_id = ${form.projectId}::uuid`)
    : { rows: [] };
  const byId = new Map(custom.rows.map((r) => [r.id, r]));
  return {
    workspaceName: row.workspaceName,
    name: form.name,
    description: form.description,
    fields: form.fields
      .map((f) => {
        if (f.kind !== "custom_field")
          return { ...f, type: null as FieldType | null, options: [] as { id: string; label: string }[] };
        const cf = byId.get(f.fieldId!);
        return cf ? { ...f, type: cf.type, options: cf.options ?? [] } : null;
      })
      .filter((f): f is NonNullable<typeof f> => f !== null),
  };
}

export type PublicForm = NonNullable<Awaited<ReturnType<typeof getPublicForm>>>;

export class FormClosedError extends Error {}

const hashIp = (ip: string) => createHash("sha256").update(`${env().BETTER_AUTH_SECRET}:${ip}`).digest("hex");

/**
 * One response: checked against the form, rate-limited per sender, then created as a task in the
 * form's list by the form's owner (so automations and webhooks see it like any other task).
 * Field errors come back as `errors` (keyed by question); nothing is created then.
 */
export async function submitForm(
  token: string,
  answers: Record<string, string>,
  files: Record<string, File[]>,
  ip: string,
): Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string>; message?: string }> {
  const [form] = await db().select().from(listForms).where(eq(listForms.token, token));
  const shown = form ? await getPublicForm(token) : null;
  if (!form || !shown) throw new FormClosedError();

  // Spam: a hidden field people never fill in, and a cap per sender and per form.
  if ((answers["_website"] ?? "").trim())
    return { ok: true, message: form.submitMessage || "Thanks! We got it." };
  const ipHash = hashIp(ip || "unknown");
  const since = new Date(Date.now() - 10 * 60_000);
  const [[mine], [all]] = await Promise.all([
    db()
      .select({ n: count() })
      .from(formSubmissions)
      .where(and(eq(formSubmissions.ipHash, ipHash), gt(formSubmissions.createdAt, since))),
    db()
      .select({ n: count() })
      .from(formSubmissions)
      .where(
        and(
          eq(formSubmissions.formId, form.id),
          gt(formSubmissions.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      ),
  ]);
  if (mine!.n >= 10 || all!.n >= 300)
    return {
      ok: false,
      errors: {},
      message: "Too many responses just now. Please try again in a few minutes.",
    };

  const errors: Record<string, string> = {};
  const text = (key: string) => (answers[key] ?? "").trim();
  let title = "";
  let details = "";
  const extras: string[] = [];
  let priority: "urgent" | "high" | "normal" | "low" | "none" = "none";
  let dueDate: string | undefined;
  const fieldValues: Record<string, string> = {};
  const upload: File[] = [];

  for (const f of shown.fields) {
    const v = text(f.key);
    switch (f.kind) {
      case "title":
        if (!v) errors[f.key] = "Required";
        else if (v.length > 500) errors[f.key] = "Keep it under 500 characters";
        title = v;
        break;
      case "description":
        if (f.required && !v) errors[f.key] = "Required";
        details = v.slice(0, 15_000);
        break;
      case "question":
        if (f.required && !v) errors[f.key] = "Required";
        if (v) extras.push(`**${f.label}:** ${v.slice(0, 3000)}`);
        break;
      case "priority":
        if (f.required && !v) errors[f.key] = "Required";
        else if (v && !["urgent", "high", "normal", "low"].includes(v)) errors[f.key] = "Pick a priority";
        else if (v) priority = v as typeof priority;
        break;
      case "due_date":
        if (f.required && !v) errors[f.key] = "Required";
        else if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[f.key] = "Pick a date";
        else if (v) dueDate = v;
        break;
      case "custom_field":
        if (f.required && !v && f.type !== "checkbox") errors[f.key] = "Required";
        else if (v || f.type === "checkbox") {
          try {
            const value = f.type === "checkbox" ? (v ? "on" : "") : v;
            if (f.type === "dropdown" && !f.options.some((o) => o.id === value))
              throw new Error("Pick one of the options");
            parseFieldValue(f.type!, value);
            if (value) fieldValues[f.fieldId!] = value;
          } catch (error) {
            errors[f.key] = (error as Error).message;
          }
        }
        break;
      case "attachments": {
        const list = (files[f.key] ?? []).filter((x) => x.size > 0);
        if (f.required && !list.length) errors[f.key] = "Add at least one file";
        else if (list.length > FORM_MAX_FILES) errors[f.key] = `At most ${FORM_MAX_FILES} files`;
        else if (list.reduce((s, x) => s + x.size, 0) > FORM_MAX_TOTAL_BYTES)
          errors[f.key] = `Files can be at most ${FORM_MAX_TOTAL_BYTES / 1024 / 1024} MB together`;
        upload.push(...list);
        break;
      }
    }
  }
  if (Object.keys(errors).length)
    return { ok: false, errors, message: "Please check the highlighted answers." };

  let owner: ActorContext;
  try {
    owner = await resolveActorById(form.createdBy, form.workspaceId, "integration");
  } catch {
    throw new FormClosedError();
  }
  const statuses = await listStatusesFor(db(), form.listId);
  const statusId =
    (form.statusId && statuses.find((s) => s.id === form.statusId)?.id) ??
    statuses.find((s) => !isClosedCategory(s.category))?.id;
  const description = [details, extras.join("\n\n"), `---\nSubmitted via the form “${form.name}”.`]
    .filter(Boolean)
    .join("\n\n");
  const task = await createTask(owner, form.listId, {
    title,
    description: description.slice(0, 20_000),
    statusId,
    priority,
    dueDate,
    assigneeIds: form.assigneeIds,
  }).catch((error: Error) => {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) throw new FormClosedError();
    throw error;
  });
  for (const [fieldId, value] of Object.entries(fieldValues)) {
    await setTaskFieldValues(owner, task.id, { [fieldId]: value }).catch(() => undefined);
  }
  if (upload.length) {
    await uploadTaskAttachments(
      owner,
      task.id,
      await Promise.all(
        upload.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
      ),
    ).catch(() => undefined);
  }
  await db().insert(formSubmissions).values({ formId: form.id, taskId: task.id, ipHash });
  return { ok: true, message: form.submitMessage || "Thanks! We got your request." };
}
