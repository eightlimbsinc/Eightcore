// Docs: rich-text pages in projects, with sub-pages, list ties, and safe saves.
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { createProject, setProjectMember } from "@/modules/projects/service";
import { createList } from "@/modules/lists/service";
import { createDoc, deleteDoc, getDoc, listDocs, updateDoc } from "@/modules/docs/service";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Client", key: "CLI" });
  const shared = await createList(ctx.actors.owner, project.id, { name: "Review", template: "simple" });
  const internal = await createList(ctx.actors.owner, project.id, { name: "Internal", template: "simple" });
  return { ...ctx, project, shared, internal };
}

const para = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("docs", () => {
  it("creates, saves with versions, and nests sub-pages", async () => {
    const { actors, project, shared } = await setup();
    const brief = await createDoc(actors.member, project.id, { title: "Brief" });
    const sub = await createDoc(actors.member, project.id, { title: "Copy", parentId: brief.id });
    const inList = await createDoc(actors.member, project.id, { title: "Review notes", listId: shared.id });

    const v2 = await updateDoc(actors.member, brief.id, 1, {
      title: "Client brief",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Go", marks: [{ type: "link", attrs: { href: "javascript:x" } }] },
            ],
          },
          { type: "script", content: [] },
        ],
      },
    });
    expect(v2.version).toBe(2);
    // An editor working from version 1 can't overwrite version 2.
    await expect(updateDoc(actors.admin, brief.id, 1, { content: para("Mine") })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const page = await getDoc(actors.owner, brief.id);
    expect(page.doc).toMatchObject({ title: "Client brief", version: 2 });
    expect(page.doc.content).toEqual(para("Go")); // the bad link and the unknown node are gone
    expect(page.children.map((c) => c.title)).toEqual(["Copy"]);
    expect((await getDoc(actors.owner, sub.id)).ancestors.map((a) => a.title)).toEqual(["Client brief"]);

    const { docs } = await listDocs(actors.owner, project.id);
    expect(docs.map((d) => [d.title, d.parentId === brief.id, d.listName]).sort()).toEqual([
      ["Client brief", false, null],
      ["Copy", true, null],
      ["Review notes", false, "Review"],
    ]);
    expect(inList).toBeDefined();
    const [{ text }] = (
      await db().execute<{ text: string }>(sql`select plain_text as text from docs where id = ${brief.id}`)
    ).rows as [{ text: string }];
    expect(text).toBe("Go");
  });

  it("guests limited to lists see only those lists' docs", async () => {
    const { actors, users, project, shared, internal } = await setup();
    const general = await createDoc(actors.owner, project.id, { title: "Pricing" });
    const review = await createDoc(actors.owner, project.id, { title: "Review notes", listId: shared.id });
    const secret = await createDoc(actors.owner, project.id, { title: "Margins", listId: internal.id });
    await setProjectMember(actors.owner, project.id, {
      userId: users.guest.id,
      role: "editor",
      listIds: [shared.id],
    });
    const { guest } = actors;

    expect((await listDocs(guest, project.id)).docs.map((d) => d.title)).toEqual(["Review notes"]);
    await expect(getDoc(guest, general.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getDoc(guest, secret.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateDoc(guest, secret.id, 1, { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createDoc(guest, project.id, { title: "Mine" })).rejects.toThrow(/Choose one of your lists/);
    await expect(createDoc(guest, project.id, { title: "Mine", listId: internal.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(createDoc(guest, project.id, { title: "Sub", parentId: general.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const mine = await createDoc(guest, project.id, { title: "Feedback", parentId: review.id });
    expect((await getDoc(guest, mine.id)).doc.list?.name).toBe("Review"); // inherited from the parent

    // Guests on the whole project see everything; a viewer reads but can't edit.
    await setProjectMember(actors.owner, project.id, {
      userId: users.guest.id,
      role: "viewer",
      listIds: null,
    });
    expect((await listDocs(guest, project.id)).docs).toHaveLength(4);
    expect((await getDoc(guest, general.id)).can).toEqual({ edit: false, delete: false });
    await expect(updateDoc(guest, general.id, 1, { title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("deletes: managers any, editors their own (sub-pages go too)", async () => {
    const { actors, project } = await setup();
    const owners = await createDoc(actors.owner, project.id, { title: "Owner's" });
    await expect(deleteDoc(actors.member, owners.id)).rejects.toBeInstanceOf(ForbiddenError);

    const mine = await createDoc(actors.member, project.id, { title: "Member's" });
    const mineSub = await createDoc(actors.member, project.id, { title: "Sub", parentId: mine.id });
    const othersSub = await createDoc(actors.owner, project.id, { title: "Owner's sub", parentId: mine.id });
    await expect(deleteDoc(actors.member, mine.id)).rejects.toThrow(/sub-pages by other people/);
    await deleteDoc(actors.owner, othersSub.id);
    await deleteDoc(actors.member, mine.id);
    await expect(getDoc(actors.owner, mineSub.id)).rejects.toBeInstanceOf(NotFoundError);
    await deleteDoc(actors.admin, owners.id);
    expect((await listDocs(actors.owner, project.id)).docs).toEqual([]);
  });

  it("keeps docs inside their project at the database level", async () => {
    const { actors, project } = await setup();
    const other = await createProject(actors.owner, { name: "Other", key: "OTH" });
    const otherList = await createList(actors.owner, other.id, { name: "X", template: "simple" });
    const doc = await createDoc(actors.owner, project.id, { title: "Here" });
    const error = await db()
      .execute(sql`update docs set list_id = ${otherList.id} where id = ${doc.id}`)
      .catch((e: Error) => e);
    expect(String((error as Error & { cause?: Error }).cause?.message)).toMatch(/same project/);
    await expect(createDoc(actors.owner, other.id, { title: "x", parentId: doc.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("doc search", () => {
  it("finds by title or text, only where the person can look", async () => {
    const { actors, users, project, shared, internal } = await setup();
    const { searchDocs } = await import("@/modules/docs/service");
    const a = await createDoc(actors.owner, project.id, { title: "Launch plan", listId: shared.id });
    await updateDoc(actors.owner, a.id, 1, { content: para("Hero video goes live Friday") });
    const b = await createDoc(actors.owner, project.id, { title: "Hero budget", listId: internal.id });
    expect(b).toBeDefined();
    expect((await searchDocs(actors.member, "hero")).map((d) => d.title).sort()).toEqual([
      "Hero budget",
      "Launch plan",
    ]);
    expect((await searchDocs(actors.member, "video friday")).map((d) => d.title)).toEqual(["Launch plan"]);
    expect(await searchDocs(actors.member, "%")).toEqual([]);
    await setProjectMember(actors.owner, project.id, {
      userId: users.guest.id,
      role: "viewer",
      listIds: [shared.id],
    });
    expect((await searchDocs(actors.guest, "hero")).map((d) => d.title)).toEqual(["Launch plan"]);
  });
});
