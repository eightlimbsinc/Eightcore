// Guests limited to some lists of a project see nothing of the others.
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { createProject, listProjectMembers, setProjectMember } from "@/modules/projects/service";
import { createFolder, createList, getProjectTree, getSidebarTree, getList } from "@/modules/lists/service";
import {
  createTask,
  getTaskByRef,
  listAssignableMembers,
  listTasks,
  setTaskAssignees,
} from "@/modules/tasks/service";
import { addDependency, getTaskDependencies } from "@/modules/dependencies/service";
import { createComment } from "@/modules/comments/service";
import { listNotifications } from "@/modules/notifications/service";
import { EMPTY_FILTER } from "@/modules/tasks/filters";
import { searchTasks } from "@/modules/tasks/search";
import { getDashboard } from "@/modules/dashboard/service";
import { projectMembers } from "@/server/db/schema";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const { owner } = ctx.actors;
  const project = await createProject(owner, { name: "Client work", key: "CLI" });
  const folder = await createFolder(owner, project.id, { name: "Internal" });
  const shared = await createList(owner, project.id, { name: "Client review", template: "simple" });
  const secret = await createList(owner, project.id, {
    name: "Margins",
    template: "simple",
    folderId: folder.id,
  });
  const open = await createTask(owner, shared.id, { title: "Review homepage" });
  const hidden = await createTask(owner, secret.id, { title: "Pricing notes" });
  await setProjectMember(owner, project.id, {
    userId: ctx.users.guest.id,
    role: "editor",
    listIds: [shared.id],
  });
  return { ...ctx, project, folder, shared, secret, open, hidden };
}

describe("guest list access", () => {
  it("shows a limited guest only their lists, everywhere", async () => {
    const { actors, project, shared, secret, open, hidden } = await setup();
    const { guest } = actors;

    const tree = await getProjectTree(guest, project.id);
    expect(tree.rootLists.map((l) => l.name)).toEqual(["Client review"]);
    expect(tree.folders).toEqual([]); // the folder holds nothing they can see
    const sidebar = (await getSidebarTree(guest, [project.id])).get(project.id)!;
    expect(sidebar.rootLists.map((l) => l.name)).toEqual(["Client review"]);
    expect(sidebar.folders).toEqual([]);

    expect((await listTasks(guest, shared.id)).map((t) => t.title)).toEqual(["Review homepage"]);
    await expect(listTasks(guest, secret.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getList(guest, secret.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTaskByRef(guest, hidden.ref)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createTask(guest, secret.id, { title: "Sneaky" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createComment(guest, hidden.id, { body: "hi" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await getTaskByRef(guest, open.ref)).task.title).toBe("Review homepage");

    const found = await searchTasks(guest, EMPTY_FILTER, { today: "2026-11-06" });
    expect(found.tasks.map((t) => t.title)).toEqual(["Review homepage"]);
    const dash = await getDashboard(guest, { today: "2026-11-06", timeZone: "UTC" });
    expect(dash.totals.open).toBe(1); // the hidden list's task isn't counted

    // Dependencies on a hidden task: can't be linked by the guest, and don't show to them.
    await expect(addDependency(guest, open.id, { ref: hidden.ref, relation: "blocked_by" })).rejects.toThrow(
      /that you can see/,
    );
    await addDependency(actors.owner, open.id, { ref: hidden.ref, relation: "blocked_by" });
    expect((await getTaskDependencies(guest, open.id)).blockedBy).toEqual([]);
    expect((await getTaskDependencies(actors.owner, open.id)).blockedBy).toHaveLength(1);
  });

  it("can't be assigned or notified on lists they can't see", async () => {
    const { actors, users, project, shared, secret, open, hidden } = await setup();
    const ids = async (listId?: string) =>
      (await listAssignableMembers(actors.owner, project.id, listId)).map((m) => m.userId);
    expect(await ids(shared.id)).toContain(users.guest.id);
    expect(await ids(secret.id)).not.toContain(users.guest.id);
    await expect(setTaskAssignees(actors.owner, hidden.id, [users.guest.id])).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await setTaskAssignees(actors.owner, open.id, [users.guest.id]);
    const inbox = await listNotifications(actors.guest);
    expect(inbox.map((n) => n.taskTitle)).toEqual(["Review homepage"]);
  });

  it("all lists, changing the scope, and only guests are limited", async () => {
    const { actors, users, project, shared, secret } = await setup();
    await setProjectMember(actors.owner, project.id, {
      userId: users.guest.id,
      role: "editor",
      listIds: null,
    });
    expect((await getProjectTree(actors.guest, project.id)).folders).toHaveLength(1);
    await expect(listTasks(actors.guest, secret.id)).resolves.toHaveLength(1);

    // A role change alone keeps the lists.
    await setProjectMember(actors.owner, project.id, {
      userId: users.guest.id,
      role: "editor",
      listIds: [secret.id],
    });
    await setProjectMember(actors.owner, project.id, { userId: users.guest.id, role: "viewer" });
    const row = (await listProjectMembers(actors.owner, project.id)).find(
      (m) => m.userId === users.guest.id,
    )!;
    expect(row).toMatchObject({ role: "viewer", listIds: [secret.id] });
    await expect(listTasks(actors.guest, shared.id)).rejects.toBeInstanceOf(NotFoundError);

    // Lists must be this project's.
    const other = await createProject(actors.owner, { name: "Other", key: "OTH" });
    const elsewhere = await createList(actors.owner, other.id, { name: "Elsewhere", template: "simple" });
    await expect(
      setProjectMember(actors.owner, project.id, {
        userId: users.guest.id,
        role: "viewer",
        listIds: [elsewhere.id],
      }),
    ).rejects.toThrow(/List not found/);

    // Members are never limited, even if asked.
    await setProjectMember(actors.owner, project.id, {
      userId: users.member.id,
      role: "editor",
      listIds: [shared.id],
    });
    const [m] = await db()
      .select({ listIds: projectMembers.listIds })
      .from(projectMembers)
      .where((await import("drizzle-orm")).eq(projectMembers.userId, users.member.id));
    expect(m!.listIds).toBeNull();
    await expect(listTasks(actors.member, secret.id)).resolves.toHaveLength(1);
  });
});
