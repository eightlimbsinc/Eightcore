// The ClickUp API importer, against a fake ClickUp (no network): dry run, import, re-run.
import { describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { importMappings, outboxEvents, projects, tasks } from "@/server/db/schema";
import { runClickUpImport, type ClickUpClient } from "@/modules/imports/clickup-run";
import { getProjectTree, listStatusesFor } from "@/modules/lists/service";
import { getTaskByRef } from "@/modules/tasks/service";
import { listComments } from "@/modules/comments/service";
import { getTaskFields } from "@/modules/fields/service";
import { getTaskDependencies } from "@/modules/dependencies/service";
import { tagsForTasks } from "@/modules/tags/service";
import { createWorkspaceWithRoles } from "../support/factories";

const ms = (iso: string) => String(Date.parse(iso));

function fakeClickUp(owner: { email: string }, member: { email: string }) {
  const statuses = [
    { status: "to do", type: "open", color: "#d3d3d3", orderindex: 0 },
    { status: "in development", type: "custom", color: "#4194f6", orderindex: 1 },
    { status: "client review", type: "custom", color: "#f9d900", orderindex: 2 },
    { status: "live", type: "done", color: "#6bc950", orderindex: 3 },
    { status: "complete", type: "closed", color: "#6bc950", orderindex: 4 },
  ];
  const fields = [
    {
      id: "f-stage",
      name: "Stage",
      type: "drop_down",
      type_config: {
        options: [
          { id: "o-1", name: "Design", orderindex: 0 },
          { id: "o-2", name: "Build", orderindex: 1 },
        ],
      },
    },
    { id: "f-designer", name: "Designer", type: "users" },
    { id: "f-button", name: "Do it", type: "button" },
    { id: "f-site", name: "Site", type: "url" },
  ];
  const u = {
    owner: { id: 1, username: "Raf", email: owner.email },
    member: { id: 2, username: "Mica", email: member.email },
    gone: { id: 3, username: "Former Freelancer", email: "freelancer@old.test" },
  };
  const base = {
    list: { id: "L1" },
    tags: [],
    assignees: [],
    watchers: [],
    custom_fields: [],
    dependencies: [],
  };
  const listTasks = [
    {
      ...base,
      id: "t-parent",
      name: "Homepage",
      text_content: "Build the homepage",
      status: statuses[2]!,
      priority: { priority: "high" },
      due_date: ms("2026-11-20T04:00:00Z"),
      date_created: ms("2026-01-05T00:00:00Z"),
      assignees: [u.member, u.gone],
      watchers: [u.member],
      tags: [{ name: "Client", tag_bg: "#ff0000" }],
      time_estimate: 7_200_000,
      custom_fields: [
        { ...fields[0]!, value: 1 },
        { ...fields[1]!, value: [u.member] },
        { ...fields[3]!, value: "not a web address" },
      ],
      dependencies: [{ task_id: "t-parent", depends_on: "t-done" }],
      checklists: [{ name: "QA", items: [{ name: "Mobile", resolved: true }] }],
      attachments: [{ title: "brief.pdf", url: "https://files.clickup.test/brief.pdf", size: 4096 }],
      url: "https://app.clickup.com/t/t-parent",
    },
    { ...base, id: "t-sub", name: "Hero image", parent: "t-parent", status: statuses[1]! },
    {
      ...base,
      id: "t-done",
      name: "Wireframes",
      status: statuses[3]!,
      date_done: ms("2026-02-01T00:00:00Z"),
    },
  ];
  // A task in another list carrying the Website list's field (ClickUp allows that).
  const opsTasks = [
    {
      ...base,
      list: { id: "L2" },
      id: "t-ops",
      name: "Invoices",
      status: statuses[0]!,
      custom_fields: [{ ...fields[0]!, value: "o-1" }],
    },
  ];
  const otherTasks = [
    {
      ...base,
      list: { id: "L3" },
      id: "t-other",
      name: "Shared field task",
      status: statuses[0]!,
      custom_fields: [{ ...fields[0]!, value: "o-2" }],
    },
  ];
  const archived = [{ ...base, id: "t-old", name: "Old idea", status: statuses[0]!, archived: true }];
  const routes: Record<string, unknown> = {
    "/team": {
      teams: [
        { id: "T1", name: "Workspace", members: [{ user: u.owner }, { user: u.member }, { user: u.gone }] },
      ],
    },
    "/team/T1/space?archived=false": {
      spaces: [
        { id: "S1", name: "8limbs INC" },
        { id: "S2", name: "Other" },
      ],
    },
    "/space/S1/folder?archived=false": {
      folders: [{ id: "F1", name: "Management", lists: [{ id: "L1", name: "Website" }] }],
    },
    "/space/S1/list?archived=false": { lists: [{ id: "L2", name: "Operations" }] },
    "/list/L1": { id: "L1", statuses },
    "/list/L2": { id: "L2", statuses: statuses.slice(0, 1).concat(statuses[4]!) },
    "/list/L1/field": { fields },
    "/list/L2/field": { fields: [] },
    // Another space whose list uses the same (workspace-wide) "Stage" field.
    "/space/S2/folder?archived=false": { folders: [] },
    "/space/S2/list?archived=false": { lists: [{ id: "L3", name: "Inbox" }] },
    "/list/L3": { id: "L3", statuses: statuses.slice(0, 1) },
    "/list/L3/field": { fields: [fields[0]] },
    "/task/t-parent/comment": {
      comments: [
        {
          id: "c2",
          comment_text: "Approved",
          user: u.gone,
          date: ms("2026-01-07T00:00:00Z"),
          reply_count: 0,
        },
        {
          id: "c1",
          comment_text: "Looks good",
          user: u.member,
          date: ms("2026-01-06T00:00:00Z"),
          reply_count: 1,
        },
      ],
    },
    "/comment/c1/reply": {
      comments: [{ id: "c1r", comment_text: "Thanks!", user: u.owner, date: ms("2026-01-06T01:00:00Z") }],
    },
  };
  const calls: string[] = [];
  const client: ClickUpClient = {
    async get<T>(path: string) {
      calls.push(path);
      const listPage = /^\/list\/(L\d)\/task\?.*archived=(true|false)&page=(\d+)$/.exec(path);
      if (listPage) {
        const [, list, arch, page] = listPage;
        const items =
          page !== "0"
            ? []
            : list === "L1"
              ? arch === "true"
                ? archived.map((t) => ({ ...t, list: { id: "L1" } }))
                : listTasks
              : arch === "true"
                ? []
                : list === "L3"
                  ? otherTasks
                  : opsTasks;
        return { tasks: items, last_page: true } as T;
      }
      const detail = /^\/task\/([\w-]+)\?/.exec(path);
      if (detail)
        return [...listTasks, ...archived, ...opsTasks, ...otherTasks].find((t) => t.id === detail[1]) as T;
      if (/^\/task\/[\w-]+\/comment$/.test(path)) return (routes[path] ?? { comments: [] }) as T;
      if (!(path in routes)) throw new Error(`unexpected ${path}`);
      return routes[path] as T;
    },
  };
  return { client, calls };
}

describe("ClickUp import", () => {
  it("dry-runs, imports everything quietly, and re-runs without duplicates", async () => {
    const { actors, users, workspace } = await createWorkspaceWithRoles();
    const actor = { ...actors.owner, actorKind: "import" as const };
    const { client, calls } = fakeClickUp(users.owner, users.member);
    const opts = { client, actor, timeZone: "Asia/Manila", spaces: ["8limbs inc"] };

    const dry = await runClickUpImport({ ...opts, apply: false });
    expect(dry.spaces).toEqual([
      { name: "8limbs INC", key: "LI", lists: 2, tasks: 5, closed: 1, archived: 1, subtasks: 1 },
    ]);
    expect(dry.people.find((p) => p.name === "Former Freelancer")?.matched).toBeNull();
    expect(dry.people.find((p) => p.name === "Mica")?.matched).toBe(users.member.name);
    expect(dry.skippedFields).toEqual(["8limbs INC › Do it (button)"]);
    expect(dry.lossyFields).toEqual(["8limbs INC › Designer: only the first person is kept"]);
    expect(calls.some((c) => c.includes("/task/t-parent?"))).toBe(false); // details only on import
    expect(
      (await db().select({ n: count() }).from(projects).where(eq(projects.workspaceId, workspace.id)))[0]!.n,
    ).toBe(0);

    const outboxBefore = (await db().select({ n: count() }).from(outboxEvents))[0]!.n;
    const result = await runClickUpImport({ ...opts, apply: true });
    // A value that isn't a web address turns that link field into text, keeping it.
    expect(result.warnings).toEqual([
      expect.stringMatching(/^Field "Site": some values aren't single web addresses/),
    ]);
    expect(result.created).toMatchObject({
      projects: 1,
      folders: 1,
      lists: 2,
      tasks: 5,
      comments: 3,
      dependencies: 1,
    });
    // Nothing for automations or webhooks to react to.
    expect((await db().select({ n: count() }).from(outboxEvents))[0]!.n).toBe(outboxBefore);

    const [project] = await db().select().from(projects).where(eq(projects.workspaceId, workspace.id));
    expect(project!.key).toBe("LI");
    const tree = await getProjectTree(actors.owner, project!.id);
    expect(tree.folders.map((f) => [f.name, f.lists.map((l) => l.name)])).toEqual([
      ["Management", ["Website"]],
    ]);
    expect(tree.rootLists.map((l) => l.name)).toEqual(["Operations"]);
    const website = tree.folders[0]!.lists[0]!;
    expect((await listStatusesFor(db(), website.id)).map((s) => [s.name, s.category])).toEqual([
      ["to do", "unstarted"],
      ["in development", "active"],
      ["client review", "review"],
      ["live", "done"],
      ["complete", "closed"],
    ]);

    const rows = await db().select().from(tasks).where(eq(tasks.projectId, project!.id));
    const byTitle = new Map(rows.map((r) => [r.title, r]));
    const home = byTitle.get("Homepage")!;
    expect(home).toMatchObject({ priority: "high", dueDate: "2026-11-20", timeEstimateMinutes: 120 });
    expect(home.createdAt.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(home.description).toContain("- [x] Mobile");
    expect(byTitle.get("Hero image")!.parentTaskId).toBe(home.id);
    expect(byTitle.get("Wireframes")!.completedAt?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(byTitle.get("Old idea")!.archivedAt).not.toBeNull();

    const ref = `LI-${home.number}`;
    const page = await getTaskByRef(actors.owner, ref);
    expect(page.assignees.map((a) => a.userId)).toEqual([users.member.id]); // the freelancer has no account
    expect(page.watchers.map((w) => w.userId)).toEqual([users.member.id]); // the importer doesn't follow it
    expect((await tagsForTasks(db(), [home.id])).get(home.id)?.map((t) => t.name)).toEqual([
      "ClickUp: Former Freelancer",
      "Client",
    ]);
    expect(home.description).toContain(
      "Assigned in ClickUp to: Former Freelancer (not in Eightcore at import)",
    );
    const fields = (await getTaskFields(actors.owner, home.id)).fields;
    expect(fields.map((f) => [f.name, f.display?.text])).toEqual([
      ["Stage", "Build"],
      ["Designer", users.member.name],
      ["Site", "not a web address"], // kept: the field became text
    ]);
    // A field ClickUp uses on another list too is widened to the whole project.
    const ops = byTitle.get("Invoices")!;
    expect(
      (await getTaskFields(actors.owner, ops.id)).fields.find((f) => f.name === "Stage")?.display?.text,
    ).toBe("Design");
    const { threads } = await listComments(actors.owner, home.id);
    expect(threads.map((t) => [t.authorName, t.body.split("\n")[0]])).toEqual([
      [users.member.name, "Looks good"],
      [users.owner.name, "**Former Freelancer** (2026-01-07) in ClickUp:"],
      [users.owner.name, "Attachments from ClickUp:"],
    ]);
    expect(threads[0]!.replies.map((r) => r.body)).toEqual(["Thanks!"]);
    expect(threads[0]!.createdAt.toISOString()).toBe("2026-01-06T00:00:00.000Z");
    expect((await getTaskDependencies(actors.owner, home.id)).blockedBy.map((d) => d.title)).toEqual([
      "Wireframes",
    ]);

    const mappings = (await db().select({ n: count() }).from(importMappings))[0]!.n;
    const again = await runClickUpImport({ ...opts, apply: true });
    expect(again.created).toEqual({});
    expect((await db().select({ n: count() }).from(importMappings))[0]!.n).toBe(mappings);
    expect(
      (await db().select({ n: count() }).from(tasks).where(eq(tasks.projectId, project!.id)))[0]!.n,
    ).toBe(5);

    // The other space shares the "Stage" field: it gets its own copy, and the value lands.
    const other = await runClickUpImport({ ...opts, spaces: ["Other"], apply: true });
    expect(other.warnings).toEqual([]);
    const [otherProject] = await db().select().from(projects).where(eq(projects.name, "Other"));
    const [shared] = await db().select().from(tasks).where(eq(tasks.projectId, otherProject!.id));
    expect(
      (await getTaskFields(actors.owner, shared!.id)).fields.map((f) => [f.name, f.display?.text]),
    ).toEqual([["Stage", "Build"]]);
  });
});
