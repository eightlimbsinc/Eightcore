// Deleting a project: owners/admins only, confirmed by key, takes everything with it.
import { describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { docs, importMappings, projects, tasks, taskLists } from "@/server/db/schema";
import { createProject, deleteProject } from "@/modules/projects/service";
import { createList } from "@/modules/lists/service";
import { createTask } from "@/modules/tasks/service";
import { createComment } from "@/modules/comments/service";
import { createDoc } from "@/modules/docs/service";
import { createField } from "@/modules/fields/service";
import { uploadTaskAttachments } from "@/modules/attachments/service";
import { createWorkspaceWithRoles } from "../support/factories";

const n = async (table: typeof tasks | typeof taskLists | typeof docs, projectId?: string) =>
  (
    await db()
      .select({ n: count() })
      .from(table)
      .where(projectId && "projectId" in table ? eq(table.projectId, projectId) : undefined)
  )[0]!.n;

describe("delete project", () => {
  it("removes the project and everything in it, and nothing else", async () => {
    const { actors, workspace } = await createWorkspaceWithRoles();
    const doomed = await createProject(actors.owner, { name: "Old client", key: "OLD" });
    const kept = await createProject(actors.owner, { name: "Keep", key: "KEEP" });
    const list = await createList(actors.owner, doomed.id, { name: "Work", template: "simple" });
    const keptList = await createList(actors.owner, kept.id, { name: "Work", template: "simple" });
    const task = await createTask(actors.owner, list.id, { title: "Old task" });
    await createTask(actors.owner, list.id, { title: "Sub", parentTaskId: task.id });
    await createTask(actors.owner, keptList.id, { title: "Kept task" });
    await createComment(actors.owner, task.id, { body: "hello" });
    await uploadTaskAttachments(actors.owner, task.id, [
      { name: "a.txt", bytes: new TextEncoder().encode("x") },
    ]);
    await createDoc(actors.owner, doomed.id, { title: "Brief" });
    await createField(actors.owner, doomed.id, { name: "Budget", type: "number" });
    await db()
      .insert(importMappings)
      .values([
        {
          workspaceId: workspace.id,
          source: "clickup",
          entityType: "project",
          externalId: "S1",
          entityId: doomed.id,
        },
        {
          workspaceId: workspace.id,
          source: "clickup",
          entityType: "task",
          externalId: "t1",
          entityId: task.id,
        },
        {
          workspaceId: workspace.id,
          source: "clickup",
          entityType: "project",
          externalId: "S2",
          entityId: kept.id,
        },
      ]);

    await expect(deleteProject(actors.member, doomed.id, "OLD")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteProject(actors.owner, doomed.id, "old client")).rejects.toBeInstanceOf(
      ValidationError,
    );

    await deleteProject(actors.admin, doomed.id, "old");
    expect(await db().select().from(projects).where(eq(projects.id, doomed.id))).toEqual([]);
    expect(await n(tasks, doomed.id)).toBe(0);
    expect(await n(taskLists, doomed.id)).toBe(0);
    expect(await n(docs, doomed.id)).toBe(0);
    expect(await n(tasks, kept.id)).toBe(1);
    // Import records for it are gone (so it can be imported again); others stay.
    expect((await db().select().from(importMappings)).map((m) => m.externalId)).toEqual(["S2"]);
  });
});
