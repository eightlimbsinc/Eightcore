import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import { discardStored } from "@/server/storage";
import { projectMembers, projects, taskLists, users, workspaceMembers } from "@/server/db/schema";
import {
  assertWorkspace,
  canProject,
  canWorkspace,
  effectiveProjectRole,
  listScopeFor,
  type ActorContext,
} from "@/server/authz/policy";
import {
  GUEST_MAX_PROJECT_ROLE,
  projectRoleAtMost,
  type ProjectAction,
  type ProjectRole,
} from "@/server/authz/matrix";
import { ForbiddenError, NotFoundError, ValidationError, assertId, pgErrorInfo } from "@/server/errors";
import { enqueueOutbox, recordActivity, recordAudit } from "@/modules/activity/service";
import {
  createProjectInput,
  setProjectMemberInput,
  updateProjectInput,
  type CreateProjectInput,
  type UpdateProjectInput,
} from "./validators";

const projectColumns = {
  id: projects.id,
  name: projects.name,
  key: projects.key,
  description: projects.description,
  visibility: projects.visibility,
  icon: projects.icon,
  color: projects.color,
  createdAt: projects.createdAt,
  archivedAt: projects.archivedAt,
};

/** Loads a project in the actor's workspace with the actor's effective role. Invisible → NotFound. Used by other modules. */
export async function loadProjectAccess(
  tx: DbOrTx,
  actor: ActorContext,
  where: { id: string } | { key: string },
) {
  if ("id" in where) assertId(where.id, "Project not found");
  const [row] = await tx
    .select({ ...projectColumns, explicitRole: projectMembers.role, listIds: projectMembers.listIds })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)),
    )
    .where(
      and(
        eq(projects.workspaceId, actor.workspaceId),
        "id" in where ? eq(projects.id, where.id) : eq(projects.key, where.key),
      ),
    );
  if (!row) throw new NotFoundError("Project not found");
  const { explicitRole, listIds, ...project } = row;
  const role = effectiveProjectRole(actor.workspaceRole, project.visibility, explicitRole);
  if (!role) throw new NotFoundError("Project not found");
  /** Null: every list. Otherwise the only lists the actor (a guest) may see. */
  const listScope = listScopeFor(actor.workspaceRole, listIds);
  return { project, role, listScope };
}

function assertProject(role: ProjectRole, action: ProjectAction): void {
  if (!canProject(role, action)) throw new ForbiddenError();
}

export async function createProject(actor: ActorContext, raw: CreateProjectInput) {
  assertWorkspace(actor, "project.create");
  const input = createProjectInput.parse(raw);
  try {
    return await db().transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({ ...input, workspaceId: actor.workspaceId, createdBy: actor.userId })
        .returning({ id: projects.id, key: projects.key, name: projects.name });
      if (!project) throw new Error("insert returned no row");
      // The creator manages the project (and keeps access if it's private).
      await tx.insert(projectMembers).values({
        workspaceId: actor.workspaceId,
        projectId: project.id,
        userId: actor.userId,
        role: "manager",
        addedBy: actor.userId,
      });
      await recordActivity(tx, actor, {
        entityType: "project",
        entityId: project.id,
        action: "created",
        metadata: { name: project.name, key: project.key, visibility: input.visibility },
      });
      await enqueueOutbox(tx, actor.workspaceId, "project.created", { projectId: project.id });
      return project;
    });
  } catch (error) {
    const { code, constraint } = pgErrorInfo(error);
    if (code === "23505" && constraint === "projects_workspace_key_uq") {
      throw new ValidationError("That key is in use", { key: "Another project already uses this key" });
    }
    throw error;
  }
}

/** Projects the actor can see, in SQL (never filtered after fetching). */
export async function listVisibleProjects(actor: ActorContext) {
  const explicit = and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId));
  const visibility = canWorkspace(actor.workspaceRole, "project.view_all")
    ? undefined
    : actor.workspaceRole === "member"
      ? or(eq(projects.visibility, "workspace"), sql`${projectMembers.userId} is not null`)
      : sql`${projectMembers.userId} is not null`; // guests: explicitly shared only
  const rows = await db()
    .select({ ...projectColumns, explicitRole: projectMembers.role })
    .from(projects)
    .leftJoin(projectMembers, explicit)
    .where(and(eq(projects.workspaceId, actor.workspaceId), isNull(projects.archivedAt), visibility))
    .orderBy(asc(projects.name));
  return rows.map(({ explicitRole, ...project }) => ({
    ...project,
    role: effectiveProjectRole(actor.workspaceRole, project.visibility, explicitRole)!,
  }));
}

export async function getProjectByKey(actor: ActorContext, key: string) {
  const { project, role } = await loadProjectAccess(db(), actor, { key: key.toUpperCase() });
  assertProject(role, "project.view");
  return {
    ...project,
    role,
    can: {
      update: canProject(role, "project.update"),
      archive: canProject(role, "project.archive"),
      manageMembers: canProject(role, "project.manage_members"),
      manageFields: canProject(role, "custom_field.manage"),
      manageAutomations: canProject(role, "automation.manage"),
      delete: canWorkspace(actor.workspaceRole, "project.delete"),
    },
  };
}

export async function updateProject(actor: ActorContext, projectId: string, raw: UpdateProjectInput) {
  const input = updateProjectInput.parse(raw);
  await db().transaction(async (tx) => {
    const { project, role } = await loadProjectAccess(tx, actor, { id: projectId });
    assertProject(role, "project.update");
    const changes: Record<string, [unknown, unknown]> = {};
    for (const field of ["name", "description", "visibility"] as const) {
      const next = input[field];
      if (next !== undefined && next !== project[field]) changes[field] = [project[field], next];
    }
    if (Object.keys(changes).length === 0) return;
    await tx
      .update(projects)
      .set(input)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, actor.workspaceId)));
    await recordActivity(tx, actor, {
      entityType: "project",
      entityId: projectId,
      action: "updated",
      changes,
    });
    await enqueueOutbox(tx, actor.workspaceId, "project.updated", {
      projectId,
      fields: Object.keys(changes),
    });
  });
}

export async function setProjectArchived(actor: ActorContext, projectId: string, archived: boolean) {
  await db().transaction(async (tx) => {
    const { project, role } = await loadProjectAccess(tx, actor, { id: projectId });
    assertProject(role, "project.archive");
    if (Boolean(project.archivedAt) === archived) return;
    await tx
      .update(projects)
      .set({ archivedAt: archived ? new Date() : null })
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, actor.workspaceId)));
    await recordActivity(tx, actor, {
      entityType: "project",
      entityId: projectId,
      action: archived ? "archived" : "restored",
    });
  });
}

export async function listProjectMembers(actor: ActorContext, projectId: string) {
  const { role } = await loadProjectAccess(db(), actor, { id: projectId });
  assertProject(role, "project.view");
  return db()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: projectMembers.role,
      listIds: projectMembers.listIds,
      workspaceRole: workspaceMembers.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projectMembers.workspaceId),
        eq(workspaceMembers.userId, projectMembers.userId),
      ),
    )
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.workspaceId, actor.workspaceId)))
    .orderBy(asc(users.name));
}

/** Grants, changes (role) or removes (null) a user's explicit project role. */
export async function setProjectMember(
  actor: ActorContext,
  projectId: string,
  raw: { userId: string; role: ProjectRole | null; listIds?: string[] | null },
) {
  const input = setProjectMemberInput.parse(raw);
  await db().transaction(async (tx) => {
    const { role } = await loadProjectAccess(tx, actor, { id: projectId });
    assertProject(role, "project.manage_members");

    if (input.role === null) {
      const removed = await tx
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.workspaceId, actor.workspaceId),
            eq(projectMembers.userId, input.userId),
          ),
        )
        .returning({ userId: projectMembers.userId });
      if (removed.length === 0) throw new NotFoundError("Member not found");
    } else {
      const [target] = await tx
        .select({ role: workspaceMembers.role, status: workspaceMembers.status })
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, input.userId)),
        );
      if (!target || target.status !== "active") throw new NotFoundError("Member not found");
      const guest = target.role === "guest";
      const granted = guest ? projectRoleAtMost(input.role, GUEST_MAX_PROJECT_ROLE) : input.role;
      // Only guests can be limited to some lists; the lists must be this project's.
      let listIds: string[] | null | undefined = guest ? input.listIds : null;
      if (listIds) {
        listIds = [...new Set(listIds)];
        const found = listIds.length
          ? await tx
              .select({ id: taskLists.id })
              .from(taskLists)
              .where(and(eq(taskLists.projectId, projectId), inArray(taskLists.id, listIds)))
          : [];
        if (found.length !== listIds.length) throw new NotFoundError("List not found in this project");
      }
      await tx
        .insert(projectMembers)
        .values({
          workspaceId: actor.workspaceId,
          projectId,
          userId: input.userId,
          role: granted,
          listIds: listIds ?? null,
          addedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target: [projectMembers.projectId, projectMembers.userId],
          set: listIds === undefined ? { role: granted } : { role: granted, listIds },
        });
    }
    await recordActivity(tx, actor, {
      entityType: "project_member",
      entityId: projectId,
      action: input.role === null ? "member_removed" : "member_set",
      metadata: { userId: input.userId, role: input.role, listIds: input.listIds },
    });
    await recordAudit(tx, {
      event: "project.member_changed",
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      metadata: { projectId, userId: input.userId, role: input.role, listIds: input.listIds },
    });
  });
}

/**
 * Permanently deletes a project with its folders, lists, tasks, comments, files, docs, fields,
 * tags and automations. Owners and admins only; `confirmKey` must be the project's key.
 * Import records for it are cleared too, so the project can be imported again.
 */
export async function deleteProject(actor: ActorContext, projectId: string, confirmKey: string) {
  assertWorkspace(actor, "project.delete");
  const keys = await db().transaction(async (tx) => {
    const { project } = await loadProjectAccess(tx, actor, { id: projectId });
    if (confirmKey.trim().toUpperCase() !== project.key) {
      throw new ValidationError(`Type ${project.key} to confirm`, { confirm: "That isn't the project key" });
    }
    const files = await tx.execute<{ storage_key: string }>(sql`
      select a.storage_key from attachments a join tasks t on t.id = a.task_id where t.project_id = ${projectId}::uuid`);
    const counts = await tx.execute<{ tasks: number; lists: number }>(sql`
      select (select count(*)::int from tasks where project_id = ${projectId}::uuid) as tasks,
             (select count(*)::int from task_lists where project_id = ${projectId}::uuid) as lists`);
    await tx.execute(sql`
      delete from import_mappings where workspace_id = ${actor.workspaceId}::uuid and entity_id in (
        select ${projectId}::uuid
        union all select id from folders where project_id = ${projectId}::uuid
        union all select id from task_lists where project_id = ${projectId}::uuid
        union all select s.id from list_statuses s join task_lists l on l.id = s.list_id where l.project_id = ${projectId}::uuid
        union all select id from custom_fields where project_id = ${projectId}::uuid
        union all select o.id from custom_field_options o join custom_fields f on f.id = o.field_id where f.project_id = ${projectId}::uuid
        union all select id from tasks where project_id = ${projectId}::uuid
        union all select c.id from comments c join tasks t on t.id = c.task_id where t.project_id = ${projectId}::uuid)`);
    await tx
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, actor.workspaceId)));
    const summary = { key: project.key, name: project.name, ...counts.rows[0] };
    await recordActivity(tx, actor, {
      entityType: "project",
      entityId: projectId,
      action: "deleted",
      metadata: summary,
    });
    await recordAudit(tx, {
      event: "project.deleted",
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      metadata: { projectId, ...summary },
    });
    return files.rows.map((r) => ({ storageKey: r.storage_key }));
  });
  await discardStored(keys);
}
