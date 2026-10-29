// Task dependencies and custom fields (Phase 3c).
import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { db } from "@/server/db";
import { createProject, setProjectMember, updateProject } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import { createTask, getTaskByRef, updateTask } from "@/modules/tasks/service";
import {
  addDependency,
  getTaskDependencies,
  openBlockerCounts,
  removeDependency,
} from "@/modules/dependencies/service";
import {
  addFieldOption,
  createField,
  deleteField,
  deleteFieldOption,
  fieldValuesForTasks,
  getTaskFields,
  listProjectFields,
  moveField,
  setTaskFieldValues,
} from "@/modules/fields/service";
import { parseFieldValue } from "@/modules/fields/validators";
import { adminPool, count } from "../support/db";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Build", template: "simple" });
  const statuses = await listStatusesFor(db(), list.id);
  const a = await createTask(ctx.actors.owner, list.id, { title: "Design" });
  const b = await createTask(ctx.actors.owner, list.id, { title: "Build" });
  const c = await createTask(ctx.actors.owner, list.id, { title: "Launch" });
  return { ...ctx, project, list, statuses, a, b, c };
}

describe("dependencies", () => {
  it("links tasks both ways and counts unfinished blockers", async () => {
    const { actors, a, b, c, statuses } = await setup();
    await addDependency(actors.member, b.id, { ref: a.ref, relation: "blocked_by" });
    await addDependency(actors.member, b.id, { ref: "web-3", relation: "blocking" });
    const deps = await getTaskDependencies(actors.member, b.id);
    expect(deps.blockedBy.map((t) => t.ref)).toEqual(["WEB-1"]);
    expect(deps.blocking.map((t) => t.ref)).toEqual(["WEB-3"]);
    expect(deps.openBlockers).toBe(1);
    expect((await openBlockerCounts(db(), actors.member, [b.id, c.id])).get(c.id)).toBe(1);

    // Finishing the blocker unblocks.
    const done = statuses.find((s) => s.category === "done")!;
    const { task } = await getTaskByRef(actors.owner, a.ref);
    await updateTask(actors.owner, a.id, task.version, { statusId: done.id });
    expect((await getTaskDependencies(actors.member, b.id)).openBlockers).toBe(0);
  });

  it("refuses self-links, duplicates and loops", async () => {
    const { actors, a, b, c } = await setup();
    await expect(
      addDependency(actors.owner, a.id, { ref: a.ref, relation: "blocked_by" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await addDependency(actors.owner, b.id, { ref: a.ref, relation: "blocked_by" });
    await expect(addDependency(actors.owner, b.id, { ref: a.ref, relation: "blocked_by" })).rejects.toThrow(
      /already linked/,
    );
    await addDependency(actors.owner, c.id, { ref: b.ref, relation: "blocked_by" });
    // a ← b ← c; making a wait on c would be a loop.
    await expect(addDependency(actors.owner, a.id, { ref: c.ref, relation: "blocked_by" })).rejects.toThrow(
      /loop/,
    );
  });

  it("blocks loops in the database too", async () => {
    const { workspace, a, b } = await setup();
    const insert = (blocking: string, blocked: string) =>
      adminPool().query(
        "insert into task_dependencies (workspace_id, blocking_task_id, blocked_task_id) values ($1, $2, $3)",
        [workspace.id, blocking, blocked],
      );
    await insert(a.id, b.id);
    await expect(insert(b.id, a.id)).rejects.toMatchObject({ constraint: "task_dependencies_no_cycles" });
  });

  it("can't link to a task the actor can't see, and hides links into invisible projects", async () => {
    const { actors, a } = await setup();
    const secret = await createProject(actors.owner, { name: "Secret", key: "SEC", visibility: "private" });
    const secretList = await createList(actors.owner, secret.id, { name: "L" });
    const hidden = await createTask(actors.owner, secretList.id, { title: "Hidden" });
    await expect(
      addDependency(actors.member, a.id, { ref: hidden.ref, relation: "blocked_by" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // The owner links them; the member sees no trace of the hidden task.
    await addDependency(actors.owner, a.id, { ref: hidden.ref, relation: "blocked_by" });
    expect((await getTaskDependencies(actors.member, a.id)).blockedBy).toEqual([]);
    expect((await openBlockerCounts(db(), actors.member, [a.id])).get(a.id)).toBeUndefined();
    expect((await getTaskDependencies(actors.owner, a.id)).blockedBy.map((t) => t.ref)).toEqual(["SEC-1"]);
  });

  it("needs edit rights to link or unlink", async () => {
    const { actors, users, project, a, b } = await setup();
    await setProjectMember(actors.owner, project.id, { userId: users.guest.id, role: "viewer" });
    await expect(
      addDependency(actors.guest, b.id, { ref: a.ref, relation: "blocked_by" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await addDependency(actors.owner, b.id, { ref: a.ref, relation: "blocked_by" });
    await expect(removeDependency(actors.guest, a.id, b.id)).rejects.toBeInstanceOf(ForbiddenError);
    await removeDependency(actors.member, a.id, b.id);
    expect(await count("task_dependencies")).toBe(0);
    await expect(removeDependency(actors.member, a.id, b.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("goes away when either task is deleted with its project", async () => {
    const { actors, a, b, project } = await setup();
    await addDependency(actors.owner, b.id, { ref: a.ref, relation: "blocked_by" });
    await adminPool().query("delete from projects where id = $1", [project.id]);
    expect(await count("task_dependencies")).toBe(0);
  });
});

describe("custom field values", () => {
  it("parses each type strictly", () => {
    expect(parseFieldValue("number", "1,250.50")).toEqual({ valueNumber: "1250.50" });
    expect(() => parseFieldValue("number", "12abc")).toThrow();
    expect(parseFieldValue("date", "2030-02-01")).toEqual({ valueDate: "2030-02-01" });
    expect(() => parseFieldValue("date", "2030-02-31")).toThrow();
    expect(parseFieldValue("checkbox", "on")).toEqual({ valueBool: true });
    expect(parseFieldValue("checkbox", "")).toBeNull();
    expect(parseFieldValue("url", "example.com/brief")).toEqual({ valueText: "https://example.com/brief" });
    expect(() => parseFieldValue("url", "javascript:alert(1)")).toThrow();
    expect(() => parseFieldValue("url", "data:text/html,hi")).toThrow();
    expect(parseFieldValue("text", "  ")).toBeNull();
  });
});

describe("custom fields", () => {
  it("lets managers define fields; others may not", async () => {
    const { actors, project } = await setup();
    await expect(
      createField(actors.member, project.id, { name: "Budget", type: "number" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await createField(actors.owner, project.id, { name: "Budget", type: "number" });
    await expect(
      createField(actors.owner, project.id, { name: "budget", type: "text" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createField(actors.owner, project.id, { name: "Channel", type: "dropdown" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await listProjectFields(actors.member, project.id)).canManage).toBe(false);
  });

  it("stores, shows and clears values of every type", async () => {
    const { actors, users, project, a } = await setup();
    const budget = await createField(actors.owner, project.id, { name: "Budget", type: "number" });
    const channel = await createField(actors.owner, project.id, {
      name: "Channel",
      type: "dropdown",
      options: ["Social", "Email"],
    });
    const due = await createField(actors.owner, project.id, { name: "Go-live", type: "date" });
    const approved = await createField(actors.owner, project.id, { name: "Approved", type: "checkbox" });
    const owner = await createField(actors.owner, project.id, { name: "Account lead", type: "person" });
    const link = await createField(actors.owner, project.id, { name: "Brief", type: "url" });

    const { fields } = await getTaskFields(actors.member, a.id);
    const social = fields.find((f) => f.id === channel.id)!.options[0]!;
    await setTaskFieldValues(actors.member, a.id, {
      [budget.id]: "1500",
      [channel.id]: social.id,
      [due.id]: "2030-03-01",
      [approved.id]: "on",
      [owner.id]: users.admin.id,
      [link.id]: "https://example.com/brief",
    });
    const shown = (await fieldValuesForTasks(db(), [a.id])).get(a.id)!;
    expect(shown.map((f) => [f.name, f.text])).toEqual([
      ["Budget", "1500"],
      ["Channel", "Social"],
      ["Go-live", "2030-03-01"],
      ["Approved", "Yes"],
      ["Account lead", users.admin.name],
      ["Brief", "https://example.com/brief"],
    ]);

    // Clearing: empty values and an unticked checkbox.
    await setTaskFieldValues(actors.member, a.id, { [budget.id]: "", [approved.id]: "" });
    expect((await fieldValuesForTasks(db(), [a.id])).get(a.id)!.map((f) => f.name)).not.toContain("Budget");
    expect(await count("task_field_values")).toBe(4);

    // Removing an option empties tasks that used it; deleting a field removes its values.
    await deleteFieldOption(actors.owner, social.id);
    expect(await count("task_field_values")).toBe(3);
    await deleteField(actors.owner, link.id);
    expect(await count("task_field_values")).toBe(2);
    await addFieldOption(actors.owner, channel.id, { label: "Print" });
    expect(
      (await getTaskFields(actors.member, a.id)).fields.find((f) => f.id === channel.id)!.options,
    ).toHaveLength(2);
  });

  it("rejects bad values, foreign options and people who can't see the project", async () => {
    const { actors, users, project, a } = await setup();
    const budget = await createField(actors.owner, project.id, { name: "Budget", type: "number" });
    const lead = await createField(actors.owner, project.id, { name: "Lead", type: "person" });
    const channel = await createField(actors.owner, project.id, {
      name: "Channel",
      type: "dropdown",
      options: ["A"],
    });
    const other = await createField(actors.owner, project.id, {
      name: "Other",
      type: "dropdown",
      options: ["B"],
    });
    const otherOption = (await listProjectFields(actors.owner, project.id)).fields.find(
      (f) => f.id === other.id,
    )!.options[0]!;
    await expect(setTaskFieldValues(actors.member, a.id, { [budget.id]: "lots" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      setTaskFieldValues(actors.member, a.id, { [channel.id]: otherOption.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await updateProject(actors.owner, project.id, { visibility: "private" });
    // The guest isn't in this private project.
    await expect(
      setTaskFieldValues(actors.owner, a.id, { [lead.id]: users.guest.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await count("task_field_values")).toBe(0);
  });

  it("applies list-only fields to that list's tasks, and refuses fields from elsewhere", async () => {
    const { actors, project, a } = await setup();
    const other = await createList(actors.owner, project.id, { name: "QA" });
    const qaTask = await createTask(actors.owner, other.id, { title: "Test" });
    const onlyQa = await createField(actors.owner, project.id, {
      name: "Browser",
      type: "text",
      listId: other.id,
    });
    expect((await getTaskFields(actors.member, a.id)).fields).toEqual([]);
    expect((await getTaskFields(actors.member, qaTask.id)).fields.map((f) => f.name)).toEqual(["Browser"]);
    await expect(setTaskFieldValues(actors.member, a.id, { [onlyQa.id]: "Chrome" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const elsewhere = await createProject(actors.owner, { name: "Ops", key: "OPS" });
    const foreign = await createField(actors.owner, elsewhere.id, { name: "Cost", type: "number" });
    await expect(setTaskFieldValues(actors.member, a.id, { [foreign.id]: "1" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("enforces one value per row and same-project fields in the database", async () => {
    const { workspace, actors, project, a } = await setup();
    const budget = await createField(actors.owner, project.id, { name: "Budget", type: "number" });
    await expect(
      adminPool().query(
        "insert into task_field_values (workspace_id, project_id, task_id, field_id, value_text, value_number) values ($1,$2,$3,$4,'x',1)",
        [workspace.id, project.id, a.id, budget.id],
      ),
    ).rejects.toMatchObject({ constraint: "task_field_values_one_value" });
    const elsewhere = await createProject(actors.owner, { name: "Ops", key: "OPS" });
    const foreign = await createField(actors.owner, elsewhere.id, { name: "Cost", type: "number" });
    await expect(
      adminPool().query(
        "insert into task_field_values (workspace_id, project_id, task_id, field_id, value_number) values ($1,$2,$3,$4,1)",
        [workspace.id, project.id, a.id, foreign.id],
      ),
    ).rejects.toMatchObject({ constraint: "task_field_values_field_fk" });
  });
});

describe("field order", () => {
  it("moves fields up and down, and the order shows on tasks", async () => {
    const { actors, project, a } = await setup();
    const budget = await createField(actors.owner, project.id, { name: "Budget", type: "number" });
    const client = await createField(actors.owner, project.id, { name: "Client", type: "text" });
    const channel = await createField(actors.owner, project.id, { name: "Channel", type: "text" });
    const names = async () => (await listProjectFields(actors.owner, project.id)).fields.map((f) => f.name);
    expect(await names()).toEqual(["Budget", "Client", "Channel"]);
    // Channel to the top, then Budget to the bottom.
    await moveField(actors.owner, channel.id, { afterFieldId: null, beforeFieldId: budget.id });
    expect(await names()).toEqual(["Channel", "Budget", "Client"]);
    await moveField(actors.owner, budget.id, { afterFieldId: client.id, beforeFieldId: null });
    expect(await names()).toEqual(["Channel", "Client", "Budget"]);
    expect((await getTaskFields(actors.owner, a.id)).fields.map((f) => f.name)).toEqual([
      "Channel",
      "Client",
      "Budget",
    ]);
  });

  it("refuses non-managers and fields from another project", async () => {
    const { actors, project } = await setup();
    const one = await createField(actors.owner, project.id, { name: "One", type: "text" });
    const two = await createField(actors.owner, project.id, { name: "Two", type: "text" });
    await expect(
      moveField(actors.member, two.id, { afterFieldId: null, beforeFieldId: one.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await createProject(actors.owner, { name: "Other", key: "OTH" });
    const foreign = await createField(actors.owner, other.id, { name: "Foreign", type: "text" });
    await expect(
      moveField(actors.owner, two.id, { afterFieldId: null, beforeFieldId: foreign.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
