// Direct uploads: the browser sends files straight to storage; they become attachments when used.
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { attachments, pendingUploads } from "@/server/db/schema";
import { createProject } from "@/modules/projects/service";
import { createList } from "@/modules/lists/service";
import { createTask } from "@/modules/tasks/service";
import { uploadTaskAttachments } from "@/modules/attachments/service";
import { createComment } from "@/modules/comments/service";
import { cleanupPendingUploads, receiveLocalUpload, startTaskUploads } from "@/modules/attachments/direct";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Web", key: "WEB" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Build", template: "simple" });
  const task = await createTask(ctx.actors.owner, list.id, { title: "Hero" });
  return { ...ctx, task };
}
const send = async (url: string, bytes: Uint8Array) => {
  const u = new URL(url, "http://local");
  const id = u.pathname.split("/").pop()!;
  return receiveLocalUpload(id, u.searchParams.get("sig") ?? "", async () => bytes.buffer as ArrayBuffer);
};
// A GIF (recognised from its first bytes), 6 MB: more than the host lets through the app.
const png = new Uint8Array([...new TextEncoder().encode("GIF89a"), ...new Uint8Array(6 * 1024 * 1024)]);

describe("direct uploads", () => {
  it("a 6 MB file goes to storage, then onto the task with its real type", async () => {
    const { actors, task } = await setup();
    const [up] = await startTaskUploads(actors.member, task.id, [{ name: "shot.gif", size: png.byteLength }]);
    expect(up!.url).toMatch(/^\/api\/uploads\/[0-9a-f-]{36}\?sig=/);
    expect(await send(up!.url, png)).toBe(204);
    await uploadTaskAttachments(actors.member, task.id, [{ name: "shot.gif", uploadId: up!.id }]);
    const [row] = await db().select().from(attachments).where(eq(attachments.taskId, task.id));
    expect(row).toMatchObject({ originalName: "shot.gif", mimeType: "image/gif", sizeBytes: png.byteLength });

    // Used once only.
    await expect(
      uploadTaskAttachments(actors.member, task.id, [{ name: "shot.gif", uploadId: up!.id }]),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("only the uploader can use it; limits and bad addresses are refused", async () => {
    const { actors, task } = await setup();
    await expect(
      startTaskUploads(actors.member, task.id, [{ name: "big.mov", size: 26 * 1024 * 1024 }]),
    ).rejects.toThrow(/25 MB/);
    await expect(startTaskUploads(actors.guest, task.id, [{ name: "a.png", size: 10 }])).rejects.toThrow();
    const [up] = await startTaskUploads(actors.member, task.id, [{ name: "a.txt", size: 5 }]);
    expect(await send(up!.url.replace(/sig=[^&]+/, "sig=forged"), new TextEncoder().encode("hello"))).toBe(
      404,
    );
    expect(await send(up!.url, new TextEncoder().encode("hello"))).toBe(204);
    await expect(
      createComment(actors.admin, task.id, { body: "mine now" }, [{ name: "a.txt", uploadId: up!.id }]),
    ).rejects.toBeInstanceOf(ValidationError);
    await createComment(actors.member, task.id, { body: "notes" }, [{ name: "a.txt", uploadId: up!.id }]);
    expect((await db().select().from(attachments).where(eq(attachments.taskId, task.id)))[0]?.mimeType).toBe(
      "text/plain",
    );
  });

  it("never-finished and abandoned uploads are cleaned up", async () => {
    const { actors, task } = await setup();
    const [missing] = await startTaskUploads(actors.member, task.id, [{ name: "gone.png", size: 10 }]);
    await expect(
      uploadTaskAttachments(actors.member, task.id, [{ name: "gone.png", uploadId: missing!.id }]),
    ).rejects.toThrow(/didn't finish uploading/);
    await db()
      .update(pendingUploads)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await cleanupPendingUploads()).toBeGreaterThanOrEqual(1);
    expect(await db().select().from(pendingUploads).where(eq(pendingUploads.id, missing!.id))).toEqual([]);
  });
});

describe("storage usage", () => {
  it("adds up files per project for owners and admins", async () => {
    const { actors, task } = await setup();
    const { getStorageUsage } = await import("@/modules/attachments/usage");
    await uploadTaskAttachments(actors.owner, task.id, [
      { name: "a.txt", bytes: new TextEncoder().encode("hello") },
    ]);
    const usage = await getStorageUsage(actors.admin);
    expect(usage).toMatchObject({ usedBytes: 5, files: 1, limitBytes: 1024 * 1024 * 1024 });
    expect(usage.byProject).toEqual([expect.objectContaining({ key: "WEB", bytes: 5, files: 1 })]);
    expect(usage.largest[0]).toMatchObject({ name: "a.txt", ref: "WEB-1" });
    await expect(getStorageUsage(actors.member)).rejects.toThrow();
  });
});
