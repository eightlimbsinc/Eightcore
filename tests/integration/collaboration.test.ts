// Comments, mentions, watchers, notifications, tags and attachments (Phase 3b).
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { attachments, workspaceMembers } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { createProject, setProjectMember, updateProject } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import { createTask, setTaskAssignees, setWatching, updateTask, getTaskByRef } from "@/modules/tasks/service";
import { createComment, deleteComment, listComments, updateComment } from "@/modules/comments/service";
import {
  countUnread,
  listNotifications,
  markNotificationsRead,
  markTaskNotificationsRead,
} from "@/modules/notifications/service";
import { createTag, deleteTag, listProjectTags, setTaskTags, tagsForTasks } from "@/modules/tags/service";
import {
  deleteAttachment,
  detectMimeType,
  getAttachmentForDownload,
  listTaskAttachments,
  uploadTaskAttachments,
} from "@/modules/attachments/service";
import { count } from "../support/db";
import { actorFor, createUser, createWorkspaceWithRoles } from "../support/factories";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0,
  1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
]);
const text = (s: string) => new TextEncoder().encode(s);

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Build", template: "simple" });
  const statuses = await listStatusesFor(db(), list.id);
  const task = await createTask(ctx.actors.owner, list.id, { title: "Homepage" });
  return { ...ctx, project, list, statuses, task };
}

function storedPath(storageKey: string) {
  return path.resolve(env().STORAGE_LOCAL_DIR, storageKey);
}

async function storageKeyOf(attachmentId: string) {
  const [row] = await db()
    .select({ key: attachments.storageKey })
    .from(attachments)
    .where(eq(attachments.id, attachmentId));
  return row!.key;
}

describe("comments", () => {
  it("threads one level of replies, oldest first", async () => {
    const { actors, task } = await setup();
    const first = await createComment(actors.owner, task.id, { body: "First" });
    await createComment(actors.member, task.id, { body: "Reply", parentCommentId: first.id });
    await createComment(actors.member, task.id, { body: "Second" });
    const { threads } = await listComments(actors.member, task.id);
    expect(threads.map((t) => [t.body, t.replies.map((r) => r.body)])).toEqual([
      ["First", ["Reply"]],
      ["Second", []],
    ]);
  });

  it("refuses replies to replies and parents from another task", async () => {
    const { actors, list, task } = await setup();
    const top = await createComment(actors.owner, task.id, { body: "Top" });
    const reply = await createComment(actors.owner, task.id, { body: "Reply", parentCommentId: top.id });
    await expect(
      createComment(actors.owner, task.id, { body: "Deep", parentCommentId: reply.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    const other = await createTask(actors.owner, list.id, { title: "Other" });
    await expect(
      createComment(actors.owner, other.id, { body: "Wrong", parentCommentId: top.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets only the author edit; author or manager delete", async () => {
    const { actors, task } = await setup();
    const c = await createComment(actors.member, task.id, { body: "Mine" });
    await expect(updateComment(actors.owner, c.id, { body: "Not yours" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await updateComment(actors.member, c.id, { body: "Edited" });
    const [thread] = (await listComments(actors.member, task.id)).threads;
    expect(thread).toMatchObject({ body: "Edited", can: { edit: true, delete: true } });
    expect(thread!.editedAt).not.toBeNull();
    // The owner is a manager on every project.
    await deleteComment(actors.owner, c.id);
    expect((await listComments(actors.member, task.id)).threads).toEqual([]);
  });

  it("keeps a placeholder for a deleted comment that has replies, without its text", async () => {
    const { actors, task } = await setup();
    const top = await createComment(actors.member, task.id, { body: "Secret plan" });
    await createComment(actors.owner, task.id, { body: "Reply", parentCommentId: top.id });
    await deleteComment(actors.member, top.id);
    const [thread] = (await listComments(actors.owner, task.id)).threads;
    expect(thread).toMatchObject({ deleted: true, body: "" });
    expect(thread!.replies).toHaveLength(1);
    await expect(updateComment(actors.member, top.id, { body: "Back" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("does not let viewers comment, and hides comments from people outside the project", async () => {
    const { actors, users, task, project } = await setup();
    await setProjectMember(actors.owner, project.id, { userId: users.guest.id, role: "viewer" });
    await expect(createComment(actors.guest, task.id, { body: "Hi" })).rejects.toBeInstanceOf(ForbiddenError);
    const outsiderWs = await createWorkspaceWithRoles();
    await expect(listComments(outsiderWs.actors.owner, task.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("mentions and notifications", () => {
  it("notifies mentioned people who can see the project, only while @Name is in the text", async () => {
    const { actors, users, task, project, workspace } = await setup();
    await updateProjectVisibilityPrivate(actors.owner, project.id);
    const outsider = await createUser({ name: "Nora Nosee" });
    await db()
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: outsider.id, role: "member" });

    await createComment(actors.owner, task.id, {
      body: `Hey @${users.admin.name}, see this`,
      // The member is picked but not named in the text; the outsider can't see this private project.
      mentionIds: [users.admin.id, users.member.id, outsider.id],
    });
    expect(await countUnread(actors.admin)).toBe(1);
    expect((await listNotifications(actors.admin))[0]).toMatchObject({ type: "mentioned", taskRef: "WEB-1" });
    expect(await countUnread(actors.member)).toBe(0);
    expect(await countUnread(actorFor(outsider, workspace, "member"))).toBe(0);
  });

  it("notifies watchers about comments, but never the author, and mentioned people only once", async () => {
    const { actors, users, task } = await setup();
    await setWatching(actors.member, task.id, true);
    await createComment(actors.admin, task.id, {
      body: `@${users.member.name} please check`,
      mentionIds: [users.member.id],
    });
    const memberInbox = await listNotifications(actors.member);
    expect(memberInbox.map((n) => n.type)).toEqual(["mentioned"]);
    // The owner created the task, so watches it; the admin now watches because they commented.
    expect((await listNotifications(actors.owner)).map((n) => n.type)).toEqual(["commented"]);
    expect(await listNotifications(actors.admin)).toEqual([]);
    await createComment(actors.owner, task.id, { body: "Thanks" });
    expect((await listNotifications(actors.admin)).map((n) => n.type)).toEqual(["commented"]);
  });

  it("notifies assignees and watchers of status changes", async () => {
    const { actors, users, task, statuses } = await setup();
    await setTaskAssignees(actors.owner, task.id, [users.member.id]);
    expect((await listNotifications(actors.member)).map((n) => n.type)).toEqual(["assigned"]);
    const { task: loaded } = await getTaskByRef(actors.owner, task.ref);
    await updateTask(actors.owner, task.id, loaded.version, { statusId: statuses[1]!.id });
    const [latest] = await listNotifications(actors.member);
    expect(latest).toMatchObject({ type: "status_changed", data: { to: statuses[1]!.name } });
    // Unwatching stops further notifications.
    await setWatching(actors.member, task.id, false);
    const { task: again } = await getTaskByRef(actors.owner, task.ref);
    await updateTask(actors.owner, task.id, again.version, { statusId: statuses[0]!.id });
    expect(await listNotifications(actors.member)).toHaveLength(2);
  });

  it("hides notifications about projects the user can no longer see", async () => {
    const { actors, users, task, project } = await setup();
    await setTaskAssignees(actors.owner, task.id, [users.member.id]);
    expect(await countUnread(actors.member)).toBe(1);
    await updateProjectVisibilityPrivate(actors.owner, project.id);
    expect(await countUnread(actors.member)).toBe(0);
    expect(await listNotifications(actors.member)).toEqual([]);
  });

  it("marks only the reader's own notifications as read", async () => {
    const { actors, users, task } = await setup();
    await setTaskAssignees(actors.owner, task.id, [users.member.id, users.admin.id]);
    const [mine] = await listNotifications(actors.member);
    await markNotificationsRead(actors.admin, [mine!.id]);
    expect(await countUnread(actors.member)).toBe(1);
    await markTaskNotificationsRead(actors.member, task.id);
    expect(await countUnread(actors.member)).toBe(0);
    expect(await countUnread(actors.admin)).toBe(1);
    await markNotificationsRead(actors.admin);
    expect(await countUnread(actors.admin)).toBe(0);
  });
});

async function updateProjectVisibilityPrivate(owner: Parameters<typeof createProject>[0], projectId: string) {
  await updateProject(owner, projectId, { visibility: "private" });
}

describe("tags", () => {
  it("keeps names unique per project, case-insensitively", async () => {
    const { actors, project } = await setup();
    await createTag(actors.member, project.id, { name: "Bug" });
    await expect(createTag(actors.member, project.id, { name: "bug" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const other = await createProject(actors.owner, { name: "Ops", key: "OPS" });
    await createTag(actors.member, other.id, { name: "Bug" });
    expect((await listProjectTags(actors.member, project.id)).map((t) => t.name)).toEqual(["Bug"]);
  });

  it("tags tasks only with their own project's tags", async () => {
    const { actors, project, task } = await setup();
    const bug = await createTag(actors.member, project.id, { name: "Bug", color: "#ef4444" });
    const other = await createProject(actors.owner, { name: "Ops", key: "OPS" });
    const foreign = await createTag(actors.member, other.id, { name: "Infra" });
    await expect(setTaskTags(actors.member, task.id, [foreign.id])).rejects.toBeInstanceOf(NotFoundError);
    await setTaskTags(actors.member, task.id, [bug.id]);
    expect((await tagsForTasks(db(), [task.id])).get(task.id)).toEqual([
      { id: bug.id, name: "Bug", color: "#ef4444" },
    ]);
    await deleteTag(actors.member, bug.id);
    expect((await tagsForTasks(db(), [task.id])).get(task.id)).toBeUndefined();
  });

  it("rejects colours that aren't #rrggbb", async () => {
    const { actors, project } = await setup();
    await expect(createTag(actors.member, project.id, { name: "X", color: "red; x" })).rejects.toThrow();
  });
});

describe("attachments", () => {
  it("detects the type from the content, not the name", async () => {
    expect(await detectMimeType(PNG)).toBe("image/png");
    expect(await detectMimeType(text("<html><script>alert(1)</script></html>"))).toBe("text/plain");
    expect(await detectMimeType(Uint8Array.from([0, 1, 2, 3, 255]))).toBe("application/octet-stream");
  });

  it("stores files, lists them, and removes the bytes on delete", async () => {
    const { actors, users, task, project } = await setup();
    await setProjectMember(actors.owner, project.id, { userId: users.guest.id, role: "editor" });
    const [file] = await uploadTaskAttachments(actors.member, task.id, [
      { name: "../../evil.html", bytes: PNG },
    ]);
    const [listed] = await listTaskAttachments(actors.member, task.id);
    expect(listed).toMatchObject({ originalName: "evil.html", mimeType: "image/png", canDelete: true });
    const stored = await getAttachmentForDownload(actors.member, file!.id);
    expect(stored.storageKey).toMatch(/^ws\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    expect(existsSync(storedPath(stored.storageKey))).toBe(true);
    // Another editor may not delete it; managers (owner, admin) may.
    await expect(deleteAttachment(actors.guest, file!.id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteAttachment(actors.member, file!.id);
    expect(existsSync(storedPath(stored.storageKey))).toBe(false);
  });

  it("refuses empty and oversized files, and stores nothing for refused uploads", async () => {
    const { actors, users, task, project } = await setup();
    await expect(
      uploadTaskAttachments(actors.member, task.id, [{ name: "empty.txt", bytes: new Uint8Array() }]),
    ).rejects.toBeInstanceOf(ValidationError);
    const big = new Uint8Array(env().MAX_UPLOAD_BYTES + 1);
    await expect(
      uploadTaskAttachments(actors.member, task.id, [{ name: "big.bin", bytes: big }]),
    ).rejects.toBeInstanceOf(ValidationError);
    await setProjectMember(actors.owner, project.id, { userId: users.guest.id, role: "commenter" });
    // Commenters attach files to comments, not to the task itself.
    await expect(
      uploadTaskAttachments(actors.guest, task.id, [{ name: "a.txt", bytes: text("a") }]),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await count("attachments")).toBe(0);
  });

  it("never serves a file to another workspace or to someone who lost access", async () => {
    const { actors, task, project } = await setup();
    const [file] = await uploadTaskAttachments(actors.owner, task.id, [{ name: "a.txt", bytes: text("a") }]);
    const other = await createWorkspaceWithRoles();
    await expect(getAttachmentForDownload(other.actors.owner, file!.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getAttachmentForDownload(actors.member, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAttachmentForDownload(actors.member, file!.id)).resolves.toBeTruthy();
    await updateProjectVisibilityPrivate(actors.owner, project.id);
    await expect(getAttachmentForDownload(actors.member, file!.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("attaches files to comments and removes them with the comment", async () => {
    const { actors, task } = await setup();
    const c = await createComment(actors.member, task.id, { body: "Screenshot" }, [
      { name: "shot.png", bytes: PNG },
    ]);
    const [thread] = (await listComments(actors.member, task.id)).threads;
    expect(thread!.attachments.map((a) => a.originalName)).toEqual(["shot.png"]);
    const key = await storageKeyOf(thread!.attachments[0]!.id);
    await deleteComment(actors.member, c.id);
    expect(await count("attachments")).toBe(0);
    expect(existsSync(storedPath(key))).toBe(false);
  });
});
