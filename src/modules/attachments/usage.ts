import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { attachments, pendingUploads, projects, tasks } from "@/server/db/schema";
import { assertWorkspace, type ActorContext } from "@/server/authz/policy";
import { env } from "@/server/env";

/** File storage used by the workspace: total against the plan's limit, per project, largest files. */
export async function getStorageUsage(actor: ActorContext) {
  assertWorkspace(actor, "workspace.update_settings");
  const ws = actor.workspaceId;
  const [[totals], [pending], byProject, largest] = await Promise.all([
    db()
      .select({
        bytes: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)::bigint`,
        files: sql<number>`count(*)::int`,
      })
      .from(attachments)
      .where(eq(attachments.workspaceId, ws)),
    db()
      .select({ bytes: sql<number>`coalesce(sum(${pendingUploads.sizeBytes}), 0)::bigint` })
      .from(pendingUploads)
      .where(and(eq(pendingUploads.workspaceId, ws), isNull(pendingUploads.usedAt))),
    db()
      .select({
        projectId: projects.id,
        key: projects.key,
        name: projects.name,
        bytes: sql<number>`sum(${attachments.sizeBytes})::bigint`,
        files: sql<number>`count(*)::int`,
      })
      .from(attachments)
      .innerJoin(tasks, eq(tasks.id, attachments.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(attachments.workspaceId, ws))
      .groupBy(projects.id, projects.key, projects.name)
      .orderBy(desc(sql`sum(${attachments.sizeBytes})`)),
    db()
      .select({
        id: attachments.id,
        name: attachments.originalName,
        bytes: attachments.sizeBytes,
        createdAt: attachments.createdAt,
        ref: sql<string>`${projects.key} || '-' || ${tasks.number}`,
        taskTitle: tasks.title,
      })
      .from(attachments)
      .innerJoin(tasks, eq(tasks.id, attachments.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(attachments.workspaceId, ws))
      .orderBy(desc(attachments.sizeBytes))
      .limit(20),
  ]);
  const used = Number(totals?.bytes ?? 0) + Number(pending?.bytes ?? 0);
  const limit = env().STORAGE_QUOTA_MB * 1024 * 1024;
  return {
    usedBytes: used,
    limitBytes: limit,
    files: totals?.files ?? 0,
    uploadingBytes: Number(pending?.bytes ?? 0),
    byProject: byProject.map((p) => ({ ...p, bytes: Number(p.bytes) })),
    largest: largest.map((f) => ({ ...f, bytes: Number(f.bytes) })),
  };
}
