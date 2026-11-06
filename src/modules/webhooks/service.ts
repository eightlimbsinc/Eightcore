import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import { inboundHooks, projects, webhookDeliveries, webhookEndpoints } from "@/server/db/schema";
import { assertWorkspace, type ActorContext } from "@/server/authz/policy";
import { NotFoundError, ValidationError, assertId } from "@/server/errors";
import { recordAudit } from "@/modules/activity/service";

/** Events an endpoint can subscribe to (the outbox types). */
export const WEBHOOK_EVENTS = [
  "task.created",
  "task.updated",
  "task.assignees_changed",
  "comment.created",
  "qa.concluded",
] as const;

const MAX_ATTEMPTS = 6;
/** Minutes to wait after attempt n (1-based) before the next. */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];

// ── Address safety ───────────────────────────────────────────────────────────────────────

/** Private, loopback, link-local and other non-public addresses (IPv4 and IPv6). */
export function isPrivateAddress(address: string): boolean {
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  // "::…" covers unspecified, loopback and IPv4-mapped/compatible forms (e.g. ::ffff:7f00:1);
  // then NAT64, unique-local, link/site-local and multicast.
  return v6.startsWith("::") || v6.startsWith("64:ff9b:") || /^f[c-f]/.test(v6);
}

/** A webhook target: public https only (no internal machines, no IP literals in private ranges). */
export function checkWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ValidationError("Enter a full address starting with https://", { url: "Not a valid address" });
  }
  if (url.protocol !== "https:")
    throw new ValidationError("Webhook addresses must use https://", { url: "Use https" });
  if (url.username || url.password)
    throw new ValidationError("Remove the user name and password from the address");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    (isIP(host) && isPrivateAddress(host))
  ) {
    throw new ValidationError("That address points to a private network", { url: "Not a public address" });
  }
  return url;
}

/** Resolves the host and refuses private addresses at send time (DNS can change after saving). */
async function assertPublicHost(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("The address resolves to a private network");
  }
}

// ── Outgoing endpoints ───────────────────────────────────────────────────────────────────

const endpointInput = z.object({
  name: z.string().trim().min(1, "Name it").max(120),
  url: z.string().trim().max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).max(WEBHOOK_EVENTS.length).default([]),
  projectId: z.uuid().nullable().default(null),
});

export async function listWebhookEndpoints(actor: ActorContext) {
  assertWorkspace(actor, "integration.manage");
  const rows = await db()
    .select({
      id: webhookEndpoints.id,
      name: webhookEndpoints.name,
      url: webhookEndpoints.url,
      events: webhookEndpoints.events,
      enabled: webhookEndpoints.enabled,
      projectId: webhookEndpoints.projectId,
      createdAt: webhookEndpoints.createdAt,
    })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.workspaceId, actor.workspaceId))
    .orderBy(webhookEndpoints.createdAt);
  return rows;
}

/** Names of the workspace's endpoints, for choosing one in an automation (anyone who manages automations). */
export async function webhookEndpointChoices(tx: DbOrTx, workspaceId: string) {
  return tx
    .select({ id: webhookEndpoints.id, name: webhookEndpoints.name })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.workspaceId, workspaceId), eq(webhookEndpoints.enabled, true)))
    .orderBy(webhookEndpoints.name);
}

/** Adds an endpoint. Returns its signing secret, shown to the person once. */
export async function createWebhookEndpoint(actor: ActorContext, raw: z.input<typeof endpointInput>) {
  assertWorkspace(actor, "integration.manage");
  const input = endpointInput.parse(raw);
  const url = checkWebhookUrl(input.url);
  if (input.projectId) {
    assertId(input.projectId, "Project not found");
    const [p] = await db()
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.workspaceId, actor.workspaceId)));
    if (!p) throw new NotFoundError("Project not found");
  }
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(webhookEndpoints)
      .values({
        workspaceId: actor.workspaceId,
        projectId: input.projectId,
        name: input.name,
        url: url.toString(),
        secret,
        events: input.events,
        createdBy: actor.userId,
      })
      .returning({ id: webhookEndpoints.id });
    await recordAudit(tx, {
      event: "webhook.created",
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      metadata: { endpointId: row!.id, host: url.host, events: input.events },
    });
    return { id: row!.id, secret };
  });
}

export async function setWebhookEndpointEnabled(actor: ActorContext, endpointId: string, enabled: boolean) {
  assertWorkspace(actor, "integration.manage");
  assertId(endpointId, "Webhook not found");
  const updated = await db()
    .update(webhookEndpoints)
    .set({ enabled })
    .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.workspaceId, actor.workspaceId)))
    .returning({ id: webhookEndpoints.id });
  if (!updated.length) throw new NotFoundError("Webhook not found");
}

export async function deleteWebhookEndpoint(actor: ActorContext, endpointId: string) {
  assertWorkspace(actor, "integration.manage");
  assertId(endpointId, "Webhook not found");
  await db().transaction(async (tx) => {
    const removed = await tx
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.workspaceId, actor.workspaceId)))
      .returning({ id: webhookEndpoints.id });
    if (!removed.length) throw new NotFoundError("Webhook not found");
    await recordAudit(tx, {
      event: "webhook.deleted",
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      metadata: { endpointId },
    });
  });
}

/** The latest deliveries (all endpoints of the workspace). */
export async function listWebhookDeliveries(actor: ActorContext, limit = 30) {
  assertWorkspace(actor, "integration.manage");
  return db()
    .select({
      id: webhookDeliveries.id,
      endpointId: webhookDeliveries.endpointId,
      endpointName: webhookEndpoints.name,
      eventType: webhookDeliveries.eventType,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      responseStatus: webhookDeliveries.responseStatus,
      lastError: webhookDeliveries.lastError,
      createdAt: webhookDeliveries.createdAt,
      deliveredAt: webhookDeliveries.deliveredAt,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(eq(webhookDeliveries.workspaceId, actor.workspaceId))
    .orderBy(desc(webhookDeliveries.id))
    .limit(limit);
}

/** Sends a failed delivery again, now. */
export async function retryWebhookDelivery(actor: ActorContext, deliveryId: number) {
  assertWorkspace(actor, "integration.manage");
  const updated = await db()
    .update(webhookDeliveries)
    .set({ status: "pending", nextAttemptAt: sql`now()`, attempts: 0 })
    .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.workspaceId, actor.workspaceId)))
    .returning({ id: webhookDeliveries.id });
  if (!updated.length) throw new NotFoundError("Delivery not found");
  await deliverDueWebhooks({ ids: [deliveryId] });
}

// ── Delivery ─────────────────────────────────────────────────────────────────────────────

/** Queues one payload for one endpoint (inside the caller's transaction). */
export async function queueDelivery(
  tx: DbOrTx,
  workspaceId: string,
  endpointId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  await tx.insert(webhookDeliveries).values({ workspaceId, endpointId, eventType, payload });
}

/** Endpoints subscribed to an event type (optionally only those for one project). */
export async function endpointsFor(
  tx: DbOrTx,
  workspaceId: string,
  eventType: string,
  projectId: string | null,
) {
  return tx
    .select({ id: webhookEndpoints.id, projectId: webhookEndpoints.projectId })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.workspaceId, workspaceId),
        eq(webhookEndpoints.enabled, true),
        sql`${eventType} = any(${webhookEndpoints.events})`,
        projectId
          ? sql`(${webhookEndpoints.projectId} is null or ${webhookEndpoints.projectId} = ${projectId}::uuid)`
          : undefined,
      ),
    );
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, the way Stripe-style receivers check it. */
export function signPayload(secret: string, body: string, timestamp: number) {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/** Sends pending deliveries that are due (or the given ones). Retries with backoff; gives up after six tries. */
export async function deliverDueWebhooks(options: { ids?: number[]; limit?: number } = {}) {
  const claimed = await db().transaction(async (tx) => {
    const rows = await tx.execute<{ id: number }>(sql`
      select id from webhook_deliveries
       where status = 'pending' and (next_attempt_at <= now() ${options.ids?.length ? sql`or true` : sql``})
         ${
           options.ids?.length
             ? sql`and id in (${sql.join(
                 options.ids.map((i) => sql`${i}`),
                 sql`, `,
               )})`
             : sql``
         }
       order by id limit ${options.limit ?? 20}
       for update skip locked`);
    const ids = rows.rows.map((r) => Number(r.id));
    if (!ids.length) return [];
    // Claim them: push the next attempt out so a parallel run doesn't send them too.
    return tx.execute<{
      id: number;
      attempts: number;
      event_type: string;
      payload: Record<string, unknown>;
      url: string;
      secret: string;
      enabled: boolean;
    }>(sql`
      update webhook_deliveries d set attempts = d.attempts + 1, next_attempt_at = now() + interval '10 minutes'
        from webhook_endpoints e
       where d.endpoint_id = e.id and d.id in (${sql.join(
         ids.map((i) => sql`${i}`),
         sql`, `,
       )})
      returning d.id, d.attempts, d.event_type, d.payload, e.url, e.secret, e.enabled`);
  });
  const rows = Array.isArray(claimed) ? claimed : claimed.rows;
  for (const d of rows) {
    let ok = false;
    let status: number | null = null;
    let error: string | null = null;
    if (!d.enabled) error = "The webhook is switched off";
    else {
      try {
        const url = new URL(d.url);
        await assertPublicHost(url);
        const body = JSON.stringify(d.payload);
        const timestamp = Math.floor(Date.now() / 1000);
        const res = await fetch(url, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
          headers: {
            "content-type": "application/json",
            "user-agent": "Eightcore-Webhooks/1",
            "x-eightcore-event": d.event_type,
            "x-eightcore-delivery": String(d.id),
            "x-eightcore-signature": signPayload(d.secret, body, timestamp),
          },
          body,
        });
        status = res.status;
        ok = res.status >= 200 && res.status < 300;
        if (!ok) error = `The receiver answered ${res.status}`;
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 300) : "Could not send";
      }
    }
    const attempts = Number(d.attempts);
    const giveUp = !ok && (attempts >= MAX_ATTEMPTS || !d.enabled);
    await db()
      .update(webhookDeliveries)
      .set({
        status: ok ? "delivered" : giveUp ? "failed" : "pending",
        responseStatus: status,
        lastError: ok ? null : error,
        deliveredAt: ok ? new Date() : null,
        nextAttemptAt: new Date(Date.now() + (BACKOFF_MINUTES[attempts - 1] ?? 360) * 60_000),
      })
      .where(eq(webhookDeliveries.id, Number(d.id)));
  }
  return rows.length;
}

// ── Incoming hooks ───────────────────────────────────────────────────────────────────────

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function listInboundHooks(actor: ActorContext) {
  assertWorkspace(actor, "integration.manage");
  return db()
    .select({
      id: inboundHooks.id,
      name: inboundHooks.name,
      tokenHint: inboundHooks.tokenHint,
      enabled: inboundHooks.enabled,
      createdAt: inboundHooks.createdAt,
      lastUsedAt: inboundHooks.lastUsedAt,
    })
    .from(inboundHooks)
    .where(eq(inboundHooks.workspaceId, actor.workspaceId))
    .orderBy(inboundHooks.createdAt);
}

/** Creates an incoming address. The token is returned once; only its hash is kept. */
export async function createInboundHook(actor: ActorContext, rawName: string) {
  assertWorkspace(actor, "integration.manage");
  const name = z.string().trim().min(1, "Name it").max(120).parse(rawName);
  const token = `ecin_${randomBytes(24).toString("base64url")}`;
  await db().transaction(async (tx) => {
    const [row] = await tx
      .insert(inboundHooks)
      .values({
        workspaceId: actor.workspaceId,
        name,
        tokenHash: hashToken(token),
        tokenHint: token.slice(0, 9),
        createdBy: actor.userId,
      })
      .returning({ id: inboundHooks.id });
    await recordAudit(tx, {
      event: "inbound_hook.created",
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      metadata: { hookId: row!.id },
    });
  });
  return { token };
}

export async function deleteInboundHook(actor: ActorContext, hookId: string) {
  assertWorkspace(actor, "integration.manage");
  assertId(hookId, "Address not found");
  const removed = await db()
    .delete(inboundHooks)
    .where(and(eq(inboundHooks.id, hookId), eq(inboundHooks.workspaceId, actor.workspaceId)))
    .returning({ id: inboundHooks.id });
  if (!removed.length) throw new NotFoundError("Address not found");
}

/** The hook a token belongs to (enabled only), and marks it used. */
export async function findInboundHook(token: string) {
  if (!/^ecin_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const [hook] = await db()
    .update(inboundHooks)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(inboundHooks.tokenHash, hashToken(token)), eq(inboundHooks.enabled, true)))
    .returning({
      id: inboundHooks.id,
      workspaceId: inboundHooks.workspaceId,
      createdBy: inboundHooks.createdBy,
    });
  return hook ?? null;
}
