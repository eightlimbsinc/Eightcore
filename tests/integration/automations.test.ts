// Automations, outgoing webhooks (Make) and incoming hooks.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { automationRuns, comments, webhookDeliveries } from "@/server/db/schema";
import { createProject } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import { createTask, getTaskByRef, updateTask } from "@/modules/tasks/service";
import { listAutomations, saveAutomation } from "@/modules/automations/service";
import { processOutbox } from "@/modules/automations/engine";
import {
  checkWebhookUrl,
  createInboundHook,
  createWebhookEndpoint,
  isPrivateAddress,
  listWebhookDeliveries,
  retryWebhookDelivery,
} from "@/modules/webhooks/service";
import { handleInboundHook } from "@/modules/webhooks/inbound";
import { changeMemberRole } from "@/modules/workspaces/service";
import { createWorkspaceWithRoles } from "../support/factories";

const dns = vi.hoisted(() => ({ address: "93.184.216.34" }));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: dns.address, family: 4 }]),
}));

type Sent = { url: string; headers: Record<string, string>; body: string };
let sent: Sent[] = [];
let answer = 200;
beforeEach(() => {
  sent = [];
  answer = 200;
  dns.address = "93.184.216.34";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      sent.push({
        url: String(url),
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      });
      return new Response(answer === 204 ? null : "ok", { status: answer });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Ops", key: "OPS" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Queue", template: "simple" });
  const statuses = await listStatusesFor(db(), list.id);
  return { ...ctx, project, list, statuses };
}

const commentsOn = async (taskId: string) =>
  (await db().select({ body: comments.body }).from(comments).where(eq(comments.taskId, taskId))).map(
    (c) => c.body,
  );

describe("automations", () => {
  it("runs matching automations as their creator and logs each run", async () => {
    const { actors, project, list, statuses } = await setup();
    const [todo, doing] = statuses;
    await saveAutomation(actors.owner, project.id, {
      name: "Welcome",
      trigger: { type: "task_created" },
      actions: [
        { type: "add_comment", body: "Picked up by the queue." },
        { type: "set_priority", priority: "high" },
      ],
    });
    await saveAutomation(actors.owner, project.id, {
      name: "Started",
      listId: list.id,
      trigger: { type: "status_changed", fromStatusId: null, toStatusId: doing!.id },
      conditions: [{ type: "priority_is", priorities: ["high"] }],
      actions: [{ type: "set_due", days: 2 }],
    });

    const task = await createTask(actors.member, list.id, { title: "Reset password" });
    await processOutbox();
    const after = (await getTaskByRef(actors.owner, task.ref)).task;
    expect(after.priority).toBe("high");
    expect(await commentsOn(task.id)).toEqual(["Picked up by the queue."]);

    await updateTask(actors.member, task.id, after.version, { statusId: doing!.id });
    await processOutbox();
    expect((await getTaskByRef(actors.owner, task.ref)).task.dueDate).not.toBeNull();
    expect(todo).toBeDefined();

    const [welcome, started] = await listAutomations(actors.owner, project.id);
    expect(welcome!.recentRuns.map((r) => [r.status, r.message])).toEqual([
      ["success", "commented, priority set"],
    ]);
    expect(started!.recentRuns[0]!.status).toBe("success");
  });

  it("stops automations that keep triggering each other", async () => {
    const { actors, project, list, statuses } = await setup();
    const [a, b] = statuses;
    await saveAutomation(actors.owner, project.id, {
      name: "Ping",
      listId: list.id,
      trigger: { type: "status_changed", toStatusId: b!.id },
      actions: [{ type: "set_status", statusId: a!.id }],
    });
    await saveAutomation(actors.owner, project.id, {
      name: "Pong",
      listId: list.id,
      trigger: { type: "status_changed", toStatusId: a!.id },
      actions: [{ type: "set_status", statusId: b!.id }],
    });
    const task = await createTask(actors.owner, list.id, { title: "Loop" });
    const { task: t } = await getTaskByRef(actors.owner, task.ref);
    await updateTask(actors.owner, task.id, t.version, { statusId: b!.id });
    for (let i = 0; i < 8; i++) await processOutbox();
    const runs = await db().select().from(automationRuns);
    expect(runs.filter((r) => r.status === "success")).toHaveLength(3);
    expect(runs.filter((r) => r.status === "skipped").map((r) => r.message)).toEqual([
      expect.stringMatching(/Stopped/),
    ]);
  });

  it("refuses ids from elsewhere and records failures without throwing", async () => {
    const { actors, project, list } = await setup();
    const other = await createProject(actors.owner, { name: "Other", key: "OTH" });
    const otherList = await createList(actors.owner, other.id, { name: "X", template: "simple" });
    const [foreign] = await listStatusesFor(db(), otherList.id);
    await expect(
      saveAutomation(actors.owner, project.id, {
        name: "Bad",
        trigger: { type: "task_created" },
        actions: [{ type: "set_status", statusId: foreign!.id }],
      }),
    ).rejects.toThrow(/Status not found/);
    await expect(
      saveAutomation(actors.member, project.id, {
        name: "Nope",
        trigger: { type: "task_created" },
        actions: [{ type: "add_comment", body: "x" }],
      }),
    ).rejects.toThrow();

    // Made by an admin who is later made a guest (no access to the project): the run fails, logged.
    const rule = await saveAutomation(actors.admin, project.id, {
      name: "Assign",
      listId: list.id,
      trigger: { type: "task_created" },
      actions: [{ type: "assign", userId: actors.member.userId }],
    });
    await changeMemberRole(actors.owner, actors.admin.userId, "guest");
    const task = await createTask(actors.owner, list.id, { title: "One" });
    await processOutbox();
    expect((await getTaskByRef(actors.owner, task.ref)).assignees).toEqual([]);
    const [run] = await db().select().from(automationRuns).where(eq(automationRuns.automationId, rule.id));
    expect(run).toMatchObject({ status: "failed", message: expect.stringMatching(/not found/i) });
  });
});

describe("outgoing webhooks", () => {
  it("only accepts public https addresses", () => {
    expect(() => checkWebhookUrl("http://hook.example.com")).toThrow(/https/);
    expect(() => checkWebhookUrl("https://localhost/x")).toThrow(/private/);
    expect(() => checkWebhookUrl("https://10.0.0.5/x")).toThrow(/private/);
    expect(() => checkWebhookUrl("https://[::1]/x")).toThrow(/private/);
    expect(() => checkWebhookUrl("https://user:pw@hook.example.com")).toThrow(/password/);
    expect(checkWebhookUrl("https://hook.eu1.make.com/abc").host).toBe("hook.eu1.make.com");
    for (const a of ["127.0.0.1", "169.254.169.254", "192.168.1.1", "::ffff:7f00:1", "fd00::1", "fe80::1"])
      expect(isPrivateAddress(a)).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });

  it("signs deliveries, retries failures and never sends to private networks", async () => {
    const { actors, list } = await setup();
    const { secret } = await createWebhookEndpoint(actors.owner, {
      name: "Make",
      url: "https://hook.eu1.make.com/abc",
      events: ["task.created"],
    });
    await expect(
      createWebhookEndpoint(actors.member, { name: "x", url: "https://hook.eu1.make.com/x" }),
    ).rejects.toThrow();

    const task = await createTask(actors.owner, list.id, { title: "Ship it" });
    await processOutbox();
    expect(sent).toHaveLength(1);
    const { headers, body } = sent[0]!;
    expect(headers["x-eightcore-event"]).toBe("task.created");
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers["x-eightcore-signature"]!)!;
    expect(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")).toBe(v1);
    expect(JSON.parse(body)).toMatchObject({
      event: "task.created",
      task: { ref: task.ref, title: "Ship it" },
    });

    // Failure → pending with backoff; a manual retry sends again.
    answer = 500;
    await createTask(actors.owner, list.id, { title: "Second" });
    await processOutbox();
    let [latest] = await listWebhookDeliveries(actors.owner);
    expect(latest).toMatchObject({ status: "pending", attempts: 1, responseStatus: 500 });
    answer = 204;
    await retryWebhookDelivery(actors.owner, latest!.id);
    [latest] = await listWebhookDeliveries(actors.owner);
    expect(latest).toMatchObject({ status: "delivered" });

    // DNS that now points inside the network: nothing is sent.
    dns.address = "10.1.2.3";
    const before = sent.length;
    await createTask(actors.owner, list.id, { title: "Third" });
    await processOutbox();
    expect(sent.length).toBe(before);
    const [blocked] = await db()
      .select()
      .from(webhookDeliveries)
      .orderBy(webhookDeliveries.id)
      .then((rows) => rows.slice(-1));
    expect(blocked!.lastError).toMatch(/private network/);
  });
});

describe("incoming hooks (Make → Eightcore)", () => {
  it("creates and updates tasks with the creator's permissions", async () => {
    const { actors, users, list, statuses } = await setup();
    const { token } = await createInboundHook(actors.owner, "Make: support form");
    expect((await handleInboundHook("ecin_wrongwrongwrongwrongwrong", {})).status).toBe(404);
    expect((await handleInboundHook(token, { action: "create_task" })).status).toBe(400);

    const created = await handleInboundHook(token, {
      action: "create_task",
      list_id: list.id,
      title: "Form: website down",
      priority: "urgent",
      assignees: [users.member.email.toUpperCase()],
    });
    expect(created.status).toBe(201);
    const ref = (created.body.task as { ref: string }).ref;
    const { task, assignees } = await getTaskByRef(actors.owner, ref);
    expect(task).toMatchObject({ title: "Form: website down", priority: "urgent" });
    expect(assignees.map((a) => a.userId)).toEqual([users.member.id]);

    const done = statuses.find((s) => s.category === "done")!;
    const updated = await handleInboundHook(token, {
      action: "update_task",
      task: ref.toLowerCase(),
      status: done.name.toUpperCase(),
      comment: "Fixed by the vendor",
    });
    expect(updated.status).toBe(200);
    expect((await getTaskByRef(actors.owner, ref)).task.statusId).toBe(done.id);
    expect(await commentsOn(task.id)).toContain("Fixed by the vendor");

    expect(
      (await handleInboundHook(token, { action: "update_task", task: ref, status: "Nope" })).body,
    ).toMatchObject({ ok: false, error: expect.stringMatching(/No status/) });
  });
});
