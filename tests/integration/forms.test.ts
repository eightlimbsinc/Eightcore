// List forms: build one, share its link, and each response becomes a task in the list.
import { describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { attachments, outboxEvents, tasks } from "@/server/db/schema";
import { createProject } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import { createField, getTaskFields } from "@/modules/fields/service";
import { getTaskByRef } from "@/modules/tasks/service";
import {
  FormClosedError,
  createForm,
  getFormForEditing,
  getPublicForm,
  regenerateFormLink,
  submitForm,
  updateForm,
} from "@/modules/forms/service";
import type { FormField } from "@/modules/forms/rules";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Blend", key: "BLD" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Website", template: "simple" });
  const other = await createList(ctx.actors.owner, project.id, { name: "Other", template: "simple" });
  const url = await createField(ctx.actors.owner, project.id, {
    name: "URL Affected",
    type: "url",
    listId: list.id,
  });
  const platform = await createField(ctx.actors.owner, project.id, {
    name: "Platform",
    type: "dropdown",
    options: ["Desktop", "Mobile"],
  });
  const elsewhere = await createField(ctx.actors.owner, project.id, {
    name: "Only other",
    type: "text",
    listId: other.id,
  });
  const { id } = await createForm(ctx.actors.member, list.id); // editors can make forms
  const statuses = await listStatusesFor(db(), list.id);
  const q = (kind: FormField["kind"], label: string, extra: Partial<FormField> = {}): FormField => ({
    key: `${kind.replace("_", "")}${label.length}abc`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 20)
      .padEnd(6, "x"),
    kind,
    label,
    help: "",
    required: false,
    multiline: false,
    ...extra,
  });
  const fields: FormField[] = [
    q("title", "Issue name", { key: "titlekey" }),
    q("description", "Issue detail", { key: "detailkey", required: true }),
    q("custom_field", "URL Affected", { key: "urlkey", fieldId: url.id, required: true }),
    q("custom_field", "Platform", { key: "platkey", fieldId: platform.id }),
    q("priority", "Priority", { key: "priokey" }),
    q("due_date", "Due date", { key: "duekey" }),
    q("question", "Requested by", { key: "whokey", required: true }),
    q("attachments", "Screenshots", { key: "fileskey" }),
  ];
  await updateForm(ctx.actors.owner, id, {
    name: "Website request",
    fields,
    statusId: statuses[1]!.id,
    assigneeIds: [ctx.users.member.id],
    submitMessage: "Thanks, the team has it.",
  });
  const { form } = await getFormForEditing(ctx.actors.owner, id);
  return {
    ...ctx,
    project,
    list,
    other,
    url,
    platform,
    elsewhere,
    formId: id,
    token: form.token,
    statuses,
    fields,
  };
}

describe("forms", () => {
  it("turns a response into a task in the list", async () => {
    const { actors, users, token, list, statuses, platform, url } = await setup();
    const shown = (await getPublicForm(token))!;
    expect(shown.name).toBe("Website request");
    expect(shown.fields.find((f) => f.key === "platkey")?.options.map((o) => o.label)).toEqual([
      "Desktop",
      "Mobile",
    ]);
    const mobile = shown.fields.find((f) => f.key === "platkey")!.options[1]!.id;

    const before = (await db().select({ n: count() }).from(outboxEvents))[0]!.n;
    const result = await submitForm(
      token,
      {
        titlekey: "Hero image is blurry",
        detailkey: "On the homepage",
        urlkey: "blend360.com/about",
        platkey: mobile,
        priokey: "high",
        duekey: "2026-12-01",
        whokey: "Sofia",
      },
      { fileskey: [new File(["png bytes"], "shot.png", { type: "image/png" })] },
      "203.0.113.9",
    );
    expect(result).toEqual({ ok: true, message: "Thanks, the team has it." });

    const [task] = await db().select().from(tasks).where(eq(tasks.listId, list.id));
    expect(task).toMatchObject({
      title: "Hero image is blurry",
      priority: "high",
      dueDate: "2026-12-01",
      statusId: statuses[1]!.id,
    });
    expect(task!.description).toContain("On the homepage");
    expect(task!.description).toContain("**Requested by:** Sofia");
    expect(task!.description).toContain("Submitted via the form “Website request”");
    const page = await getTaskByRef(actors.owner, `BLD-${task!.number}`);
    expect(page.assignees.map((a) => a.userId)).toEqual([users.member.id]);
    const values = (await getTaskFields(actors.owner, task!.id)).fields;
    expect(values.find((f) => f.id === url.id)?.display?.text).toContain("blend360.com/about");
    expect(values.find((f) => f.id === platform.id)?.display?.text).toBe("Mobile");
    expect(
      (await db().select().from(attachments).where(eq(attachments.taskId, task!.id))).map(
        (a) => a.originalName,
      ),
    ).toEqual(["shot.png"]);
    // Automations and webhooks hear about it like any new task.
    expect((await db().select({ n: count() }).from(outboxEvents))[0]!.n).toBeGreaterThan(before);
  });

  it("checks answers, stops spam, and closes with the link", async () => {
    const { actors, token, formId, list, elsewhere, fields } = await setup();
    const bad = await submitForm(
      token,
      { titlekey: "", urlkey: "not a link at all", whokey: "" },
      {},
      "1.1.1.1",
    );
    expect(bad.ok).toBe(false);
    expect(!bad.ok && Object.keys(bad.errors).sort()).toEqual(["detailkey", "titlekey", "urlkey", "whokey"]);

    // Bots fill the hidden field: told "thanks", nothing created.
    expect((await submitForm(token, { titlekey: "Spam", _website: "http://spam" }, {}, "1.1.1.1")).ok).toBe(
      true,
    );
    expect((await db().select({ n: count() }).from(tasks).where(eq(tasks.listId, list.id)))[0]!.n).toBe(0);

    const good = { titlekey: "Ok", detailkey: "d", urlkey: "https://x.io", whokey: "me" };
    for (let i = 0; i < 10; i++) expect((await submitForm(token, good, {}, "9.9.9.9")).ok).toBe(true);
    const limited = await submitForm(token, good, {}, "9.9.9.9");
    expect(limited).toMatchObject({ ok: false, message: expect.stringMatching(/Too many/) });

    await expect(
      updateForm(actors.owner, formId, {
        name: "x",
        fields: [...fields, { ...fields[2]!, key: "elsekey", fieldId: elsewhere.id }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createForm(actors.guest, list.id)).rejects.toThrow();
    await expect(getFormForEditing(actors.member, formId)).resolves.toBeTruthy();

    await regenerateFormLink(actors.owner, formId);
    expect(await getPublicForm(token)).toBeNull();
    await expect(submitForm(token, good, {}, "2.2.2.2")).rejects.toBeInstanceOf(FormClosedError);
    await updateForm(actors.owner, formId, { name: "x", fields, enabled: false });
    const { form } = await getFormForEditing(actors.owner, formId);
    expect(await getPublicForm(form.token)).toBeNull();
  });
});
