import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/errors";
import { db } from "@/server/db";
import { createProject } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import {
  TransitionError,
  deleteTransition,
  listTransitions,
  saveTransition,
  setTransitionsStrict,
} from "@/modules/lists/transitions";
import { createTask, getTaskByRef, moveTask, updateTask } from "@/modules/tasks/service";
import { bulkUpdateTasks } from "@/modules/tasks/bulk";
import { createField, setTaskFieldValues } from "@/modules/fields/service";
import { listComments } from "@/modules/comments/service";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Build", template: "agency" });
  const statuses = await listStatusesFor(db(), list.id);
  const s = (name: string) => statuses.find((x) => x.name === name)!;
  return { ...ctx, project, list, s };
}

const statusName = async (
  actor: Parameters<typeof getTaskByRef>[0],
  ref: string,
  s: (n: string) => { id: string; name: string },
) => {
  const { task } = await getTaskByRef(actor, ref);
  return ["Backlog", "To Do", "In Development", "Ready to Test", "Push to Production", "Accepted"].find(
    (n) => s(n).id === task.statusId,
  );
};

describe("status transition rules", () => {
  it("only lets managers make a manager-only move, everywhere", async () => {
    const { actors, list, s } = await setup();
    // Members (editors here) can set up rules.
    await saveTransition(actors.member, list.id, {
      fromStatusId: null,
      toStatusId: s("Push to Production").id,
      minRole: "manager",
    });
    const t = await createTask(actors.member, list.id, { title: "Hero" });
    await expect(
      updateTask(actors.member, t.id, 1, { statusId: s("Push to Production").id }),
    ).rejects.toBeInstanceOf(TransitionError);
    await expect(
      moveTask(actors.member, t.id, 1, { statusId: s("Push to Production").id }),
    ).rejects.toBeInstanceOf(TransitionError);
    const bulk = await bulkUpdateTasks(actors.member, list.id, [t.id], {
      kind: "status",
      statusId: s("Push to Production").id,
    });
    expect(bulk).toMatchObject({
      done: 0,
      skipped: 1,
      reason: expect.stringMatching(/Only project managers/),
    });
    await updateTask(actors.owner, t.id, 1, { statusId: s("Push to Production").id });
    expect(await statusName(actors.owner, t.ref, s)).toBe("Push to Production");
  });

  it("asks for a comment and posts it with the move", async () => {
    const { actors, list, s } = await setup();
    await saveTransition(actors.owner, list.id, {
      fromStatusId: null,
      toStatusId: s("Ready to Test").id,
      requireComment: true,
    });
    const t = await createTask(actors.member, list.id, { title: "Hero" });
    const err = await updateTask(actors.member, t.id, 1, { statusId: s("Ready to Test").id }).catch((e) => e);
    expect(err).toBeInstanceOf(TransitionError);
    expect((err as TransitionError).need).toBe("comment");
    await updateTask(actors.member, t.id, 1, {
      statusId: s("Ready to Test").id,
      comment: "Deployed to staging",
    });
    expect(await statusName(actors.member, t.ref, s)).toBe("Ready to Test");
    const { threads } = await listComments(actors.member, t.id);
    expect(threads.map((c) => c.body)).toContain("Deployed to staging");
  });

  it("needs required fields filled in first", async () => {
    const { actors, project, list, s } = await setup();
    const link = await createField(actors.owner, project.id, { name: "Staging Link", type: "url" });
    await saveTransition(actors.member, list.id, {
      fromStatusId: null,
      toStatusId: s("Accepted").id,
      requiredFieldIds: [link.id],
    });
    const t = await createTask(actors.member, list.id, { title: "Hero" });
    await expect(updateTask(actors.member, t.id, 1, { statusId: s("Accepted").id })).rejects.toThrow(
      /Fill in “Staging Link”/,
    );
    await setTaskFieldValues(actors.member, t.id, { [link.id]: "https://staging.example.test" });
    const { task } = await getTaskByRef(actors.member, t.ref);
    await updateTask(actors.member, t.id, task.version, { statusId: s("Accepted").id });
    expect(await statusName(actors.member, t.ref, s)).toBe("Accepted");
  });

  it("allows only listed moves in strict mode", async () => {
    const { actors, list, s } = await setup();
    const t = await createTask(actors.member, list.id, { title: "Hero", statusId: s("To Do").id });
    await saveTransition(actors.owner, list.id, {
      fromStatusId: s("To Do").id,
      toStatusId: s("In Development").id,
    });
    // Not strict yet: unlisted moves are fine.
    await updateTask(actors.member, t.id, 1, { statusId: s("Backlog").id });
    await updateTask(actors.member, t.id, 2, { statusId: s("To Do").id });
    await setTransitionsStrict(actors.member, list.id, true);
    await expect(updateTask(actors.member, t.id, 3, { statusId: s("Accepted").id })).rejects.toThrow(
      /doesn't allow moving/,
    );
    await updateTask(actors.member, t.id, 3, { statusId: s("In Development").id });
    expect((await listTransitions(actors.member, list.id)).strict).toBe(true);
  });

  it("lets editors and managers manage rules, nobody else", async () => {
    const { actors, workspace, users, project, list, s } = await setup();
    const { rules } = await listTransitions(actors.member, list.id);
    expect(rules).toEqual([]);
    const rule = await saveTransition(actors.member, list.id, {
      fromStatusId: null,
      toStatusId: s("Accepted").id,
    });
    // Saving the same pair again updates it instead of adding a second rule.
    await saveTransition(actors.member, list.id, {
      fromStatusId: null,
      toStatusId: s("Accepted").id,
      minRole: "manager",
    });
    expect((await listTransitions(actors.member, list.id)).rules).toEqual([
      expect.objectContaining({ id: rule.id, minRole: "manager" }),
    ]);
    const { setProjectMember } = await import("@/modules/projects/service");
    const { actorFor } = await import("../support/factories");
    await setProjectMember(actors.owner, project.id, { userId: users.guest.id, role: "commenter" });
    const guest = actorFor(users.guest, workspace, "guest");
    await expect(deleteTransition(guest, rule.id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteTransition(actors.member, rule.id);
    expect((await listTransitions(actors.member, list.id)).rules).toEqual([]);
  });
});
