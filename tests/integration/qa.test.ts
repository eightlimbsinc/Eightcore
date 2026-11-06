import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { db } from "@/server/db";
import { qaCycles } from "@/server/db/schema";
import { createProject, setProjectMember } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import { saveTransition } from "@/modules/lists/transitions";
import { createTask, updateTask, getTaskByRef } from "@/modules/tasks/service";
import {
  addQaEvidence,
  concludeQaCycle,
  listQaCycles,
  startQaCycle,
  updateQaCycle,
} from "@/modules/qa/service";
import { adminPool } from "../support/db";
import { actorFor, createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Build", template: "agency" });
  const statuses = await listStatusesFor(db(), list.id);
  const s = (name: string) => statuses.find((x) => x.name === name)!;
  const task = await createTask(ctx.actors.member, list.id, { title: "Hero" });
  return { ...ctx, project, list, s, task };
}

const file = (name = "screenshot.png") => ({
  name,
  type: "image/png",
  // A real PNG signature, so the type check accepts it.
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
});

describe("QA rounds", () => {
  it("runs rounds by hand: fail with a note and evidence, then a passing retest", async () => {
    const { actors, task } = await setup();
    const first = await startQaCycle(actors.member, task.id, {
      environmentUrl: "https://staging.example.test",
    });
    await expect(startQaCycle(actors.member, task.id)).rejects.toBeInstanceOf(ConflictError);
    await addQaEvidence(actors.member, first!.id, [file()]);
    await expect(concludeQaCycle(actors.member, task.id, { result: "fail" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await concludeQaCycle(actors.member, task.id, { result: "fail", summary: "Button misaligned on mobile" });
    await startQaCycle(actors.member, task.id, { buildRef: "v1.2.1" });
    await concludeQaCycle(actors.owner, task.id, { result: "pass" });

    const { rounds } = await listQaCycles(actors.member, task.id);
    expect(rounds.map((r) => [r.cycleNumber, r.result])).toEqual([
      [2, "pass"],
      [1, "fail"],
    ]);
    expect(rounds[1]).toMatchObject({
      summary: "Button misaligned on mobile",
      environmentUrl: "https://staging.example.test",
    });
    expect(rounds[1]!.evidence.map((e) => e.originalName)).toEqual(["screenshot.png"]);
  });

  it("locks concluded rounds, in the service and in the database", async () => {
    const { actors, task } = await setup();
    const round = await startQaCycle(actors.member, task.id);
    await concludeQaCycle(actors.member, task.id, { result: "pass" });
    await expect(updateQaCycle(actors.member, round!.id, { buildRef: "changed" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(addQaEvidence(actors.member, round!.id, [file()])).rejects.toBeInstanceOf(ConflictError);
    await expect(
      adminPool().query("update qa_cycles set summary = 'rewritten' where id = $1", [round!.id]),
    ).rejects.toMatchObject({ constraint: "qa_cycles_concluded_locked" });
    // Deleting the task still removes its rounds.
    const [row] = await db().select().from(qaCycles).where(eq(qaCycles.id, round!.id));
    expect(row?.summary).toBe("");
  });

  it("starts, fails and passes rounds from status rules", async () => {
    const { actors, list, s, task } = await setup();
    await saveTransition(actors.member, list.id, {
      fromStatusId: null,
      toStatusId: s("Ready to Test").id,
      qaAction: "start",
    });
    await saveTransition(actors.member, list.id, {
      fromStatusId: s("Ready to Test").id,
      toStatusId: s("In Development").id,
      qaAction: "fail",
    });
    await saveTransition(actors.member, list.id, {
      fromStatusId: s("Ready to Test").id,
      toStatusId: s("Final Review").id,
      qaAction: "pass",
    });

    await updateTask(actors.member, task.id, 1, { statusId: s("Ready to Test").id });
    expect((await listQaCycles(actors.member, task.id)).rounds[0]).toMatchObject({
      cycleNumber: 1,
      result: "pending",
    });
    // Failing QA needs a note, which becomes the round's summary (and a comment).
    await expect(updateTask(actors.member, task.id, 2, { statusId: s("In Development").id })).rejects.toThrow(
      /fails QA/,
    );
    await updateTask(actors.member, task.id, 2, {
      statusId: s("In Development").id,
      comment: "Form doesn't submit",
    });
    await updateTask(actors.member, task.id, 3, { statusId: s("Ready to Test").id });
    const { task: now } = await getTaskByRef(actors.member, task.ref);
    await updateTask(actors.member, task.id, now.version, { statusId: s("Final Review").id });
    const { rounds } = await listQaCycles(actors.member, task.id);
    expect(rounds.map((r) => [r.cycleNumber, r.result, r.summary])).toEqual([
      [2, "pass", ""],
      [1, "fail", "Form doesn't submit"],
    ]);
  });

  it("lets viewers see rounds but not run them", async () => {
    const { actors, users, workspace, project, task } = await setup();
    await setProjectMember(actors.owner, project.id, { userId: users.guest.id, role: "viewer" });
    const viewer = actorFor(users.guest, workspace, "guest");
    await expect(startQaCycle(viewer, task.id)).rejects.toBeInstanceOf(ForbiddenError);
    await startQaCycle(actors.member, task.id);
    const seen = await listQaCycles(viewer, task.id);
    expect(seen.rounds).toHaveLength(1);
    expect(seen.can.conduct).toBe(false);
  });
});
