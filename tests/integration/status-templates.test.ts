import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { db } from "@/server/db";
import { createProject } from "@/modules/projects/service";
import { addStatus, createList, listStatusesFor, updateStatus } from "@/modules/lists/service";
import {
  applyStatusTemplate,
  deleteStatusTemplate,
  listStatusTemplates,
  saveStatusTemplate,
} from "@/modules/lists/status-templates";
import { createTask, getTaskByRef } from "@/modules/tasks/service";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  return { ...ctx, project };
}
const names = async (listId: string) => (await listStatusesFor(db(), listId)).map((s) => s.name);

describe("status templates", () => {
  it("saves a list's statuses as a template and creates new lists from it", async () => {
    const { actors, project } = await setup();
    const source = await createList(actors.owner, project.id, { name: "Podcasts", template: "simple" });
    await addStatus(actors.owner, source.id, { name: "Recording", category: "active", color: "#F59E0B" });
    await saveStatusTemplate(actors.owner, source.id, "Podcast flow");
    const [saved] = await listStatusTemplates(actors.member);
    expect(saved).toMatchObject({ name: "Podcast flow", canDelete: false });
    expect(saved!.statuses.map((s) => s.name)).toEqual([
      "To Do",
      "In Progress",
      "Done",
      "Recording",
      "Completed",
    ]);

    const copy = await createList(actors.owner, project.id, { name: "Season 2", templateId: saved!.id });
    expect(await names(copy.id)).toEqual(["To Do", "In Progress", "Done", "Recording", "Completed"]);
    await expect(saveStatusTemplate(actors.owner, source.id, "podcast FLOW")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("applies a template to a list, keeping every task", async () => {
    const { actors, project } = await setup();
    const list = await createList(actors.owner, project.id, { name: "Build", template: "agency" });
    const statuses = await listStatusesFor(db(), list.id);
    const byName = (n: string) => statuses.find((s) => s.name === n)!;
    const testing = await createTask(actors.owner, list.id, {
      title: "Testing",
      statusId: byName("Ready to Test").id,
    });
    const accepted = await createTask(actors.owner, list.id, {
      title: "Shipped",
      statusId: byName("Accepted").id,
    });
    const todo = await createTask(actors.owner, list.id, { title: "Later", statusId: byName("To Do").id });

    const result = await applyStatusTemplate(actors.owner, list.id, { builtin: "simple" });
    expect(await names(list.id)).toEqual(["To Do", "In Progress", "Done", "Completed"]);
    expect(result.movedTasks).toBe(2);
    const statusOf = async (ref: string) => {
      const { task } = await getTaskByRef(actors.owner, ref);
      return {
        name: (await listStatusesFor(db(), list.id)).find((s) => s.id === task.statusId)?.name,
        done: Boolean(task.completedAt),
      };
    };
    // Same name kept; "review" has no match, so it goes to the first unfinished status.
    expect(await statusOf(todo.ref)).toEqual({ name: "To Do", done: false });
    expect(await statusOf(testing.ref)).toEqual({ name: "To Do", done: false });
    // Done stays done.
    expect(await statusOf(accepted.ref)).toEqual({ name: "Done", done: true });
  });

  it("keeps a renamed status's tasks finished or open to match its new category", async () => {
    const { actors, project } = await setup();
    const list = await createList(actors.owner, project.id, { name: "A", template: "simple" });
    await saveStatusTemplate(actors.owner, list.id, "Simple copy");
    const [doing] = (await listStatusesFor(db(), list.id)).slice(1);
    await updateStatus(actors.owner, doing!.id, { name: "In Progress", category: "done", color: "#22C55E" });
    const task = await createTask(actors.owner, list.id, { title: "T", statusId: doing!.id });
    expect((await getTaskByRef(actors.owner, task.ref)).task.completedAt).not.toBeNull();
    const [tpl] = await listStatusTemplates(actors.owner);
    await applyStatusTemplate(actors.owner, list.id, { id: tpl!.id });
    expect((await getTaskByRef(actors.owner, task.ref)).task.completedAt).toBeNull();
  });

  it("limits who can save, apply and delete templates", async () => {
    const { actors, project } = await setup();
    const list = await createList(actors.owner, project.id, { name: "A", template: "simple" });
    // Members are editors of workspace-visible projects: they can't manage statuses.
    await expect(saveStatusTemplate(actors.member, list.id, "Mine")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(applyStatusTemplate(actors.member, list.id, { builtin: "agency" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await saveStatusTemplate(actors.owner, list.id, "Owner's");
    const [tpl] = await listStatusTemplates(actors.owner);
    await expect(deleteStatusTemplate(actors.member, tpl!.id)).rejects.toBeInstanceOf(ForbiddenError);
    // Another workspace can't see or use it.
    const other = await createWorkspaceWithRoles();
    const otherProject = await createProject(other.actors.owner, { name: "X", key: "XX" });
    const otherList = await createList(other.actors.owner, otherProject.id, { name: "L" });
    await expect(
      applyStatusTemplate(other.actors.owner, otherList.id, { id: tpl!.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await listStatusTemplates(other.actors.owner)).toEqual([]);
    await deleteStatusTemplate(actors.owner, tpl!.id);
    expect(await listStatusTemplates(actors.owner)).toEqual([]);
  });
});
