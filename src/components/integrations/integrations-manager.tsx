"use client";
import { useState, useTransition } from "react";
import { Copy, RotateCw, Trash2 } from "lucide-react";
import {
  createInboundHookAction,
  createWebhookEndpointAction,
  deleteInboundHookAction,
  deleteWebhookEndpointAction,
  retryWebhookDeliveryAction,
  setWebhookEndpointEnabledAction,
} from "@/modules/webhooks/actions";
import type { ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const EVENT_LABELS: Record<string, string> = {
  "task.created": "Task created",
  "task.updated": "Task changed (status, priority, dates…)",
  "task.assignees_changed": "Assignees changed",
  "comment.created": "Comment added",
  "qa.concluded": "QA round concluded",
};

function useRun() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>, onOk?: (r: ActionState) => void) =>
    startTransition(async () => {
      const r = await fn();
      setError(r && !r.ok ? r.message : null);
      if (r?.ok) onOk?.(r);
    });
  return { pending, error, run };
}

/** Shown once: a secret or address, with a copy button. */
function OneTime({ label, value, note }: { label: string; value: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="bg-accent-soft grid min-w-0 grid-cols-1 gap-2 rounded-md p-3 text-[13px]">
      <p className="font-medium">{label}</p>
      <div className="flex min-w-0 items-center gap-2">
        <code className="bg-surface min-w-0 flex-1 truncate rounded px-2 py-1 font-mono text-[12px]">
          {value}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true))}
        >
          <Copy /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-muted-foreground">{note}</p>
    </div>
  );
}

export function OutgoingWebhooks({
  workspaceSlug,
  endpoints,
  events,
  projects,
}: {
  workspaceSlug: string;
  endpoints: {
    id: string;
    name: string;
    url: string;
    events: string[];
    enabled: boolean;
    projectId: string | null;
    fromAutomation?: boolean;
  }[];
  events: string[];
  projects: { id: string; name: string; key: string }[];
}) {
  const { pending, error, run } = useRun();
  const [secret, setSecret] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>(["task.created", "task.updated"]);
  return (
    <div className="grid min-w-0 gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {secret ? (
        <OneTime
          label="Signing secret (shown once)"
          value={secret}
          note="Each request carries an x-eightcore-signature header: t=<time>,v1=<HMAC-SHA256 of “<time>.<body>” with this secret>. Make can check it, or you can ignore it."
        />
      ) : null}
      {endpoints.length ? (
        <ul className="divide-y rounded-md border">
          {endpoints.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{e.name}</div>
                <div className="text-muted-foreground truncate font-mono text-[12px]">{e.url}</div>
                <div className="text-muted-foreground text-[12px]">
                  {e.fromAutomation
                    ? "Typed into an automation's “Call webhook” (switch it off here to stop it)"
                    : e.events.length
                      ? e.events.map((x) => EVENT_LABELS[x] ?? x).join(" · ")
                      : "Only from automations"}
                  {e.projectId
                    ? ` · ${projects.find((p) => p.id === e.projectId)?.name ?? "one project"} only`
                    : ""}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={e.enabled}
                  disabled={pending}
                  onChange={(x) =>
                    run(() => setWebhookEndpointEnabledAction(workspaceSlug, e.id, x.target.checked))
                  }
                />
                On
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${e.name}`}
                disabled={pending}
                onClick={() => {
                  if (confirm(`Delete the webhook “${e.name}”? Automations that send to it will fail.`))
                    run(() => deleteWebhookEndpointAction(workspaceSlug, e.id));
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-[13px]">No webhooks yet.</p>
      )}
      <form
        className="grid gap-3 rounded-md border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          run(
            () =>
              createWebhookEndpointAction(workspaceSlug, {
                name: String(data.get("name")),
                url: String(data.get("url")),
                events: chosen,
                projectId: String(data.get("projectId")) || null,
              }),
            (r) => {
              setSecret(r && r.ok ? (r.message ?? null) : null);
              form.reset();
            },
          );
        }}
      >
        <p className="text-[13px] font-semibold">Add a webhook</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="wh-name">
            <Input id="wh-name" name="name" required placeholder="Make: notify client" />
          </Field>
          <Field label="Address (from Make's “Custom webhook”)" htmlFor="wh-url">
            <Input id="wh-url" name="url" required type="url" placeholder="https://hook.eu1.make.com/…" />
          </Field>
        </div>
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-[13px]">Send automatically when</legend>
          {events.map((ev) => (
            <label key={ev} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={chosen.includes(ev)}
                onChange={(x) =>
                  setChosen(x.target.checked ? [...chosen, ev] : chosen.filter((c) => c !== ev))
                }
              />
              {EVENT_LABELS[ev] ?? ev}
            </label>
          ))}
          <p className="text-muted-foreground text-[12px]">
            Tick nothing to send only from automations (“Send to webhook”).
          </p>
        </fieldset>
        <Field label="Projects" htmlFor="wh-project">
          <NativeSelect id="wh-project" name="projectId" className="w-full">
            <option value="">Every project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} · {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            Add webhook
          </Button>
        </div>
      </form>
    </div>
  );
}

export function DeliveryLog({
  workspaceSlug,
  deliveries,
}: {
  workspaceSlug: string;
  deliveries: {
    id: number;
    endpointName: string;
    eventType: string;
    status: string;
    attempts: number;
    responseStatus: number | null;
    lastError: string | null;
    createdAt: Date;
  }[];
}) {
  const { pending, error, run } = useRun();
  if (!deliveries.length) return <p className="text-muted-foreground text-[13px]">Nothing sent yet.</p>;
  return (
    <div className="grid gap-2">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <ul className="divide-y rounded-md border text-[13px]">
        {deliveries.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <Badge
              variant={
                d.status === "delivered" ? "outline" : d.status === "failed" ? "destructive" : "default"
              }
              className="capitalize"
            >
              {d.status}
            </Badge>
            <span className="font-medium">{d.endpointName}</span>
            <span className="text-muted-foreground">{EVENT_LABELS[d.eventType] ?? d.eventType}</span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate">
              {d.lastError ?? (d.responseStatus ? `answered ${d.responseStatus}` : "")}
              {d.attempts > 1 ? ` · ${d.attempts} tries` : ""}
            </span>
            <time
              className="text-muted-foreground tabular-nums"
              dateTime={new Date(d.createdAt).toISOString()}
            >
              {new Date(d.createdAt).toLocaleString()}
            </time>
            {d.status !== "delivered" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => run(() => retryWebhookDeliveryAction(workspaceSlug, d.id))}
              >
                <RotateCw /> Retry now
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IncomingHooks({
  workspaceSlug,
  hooks,
  hookBase,
}: {
  workspaceSlug: string;
  hooks: { id: string; name: string; tokenHint: string; lastUsedAt: Date | null }[];
  hookBase: string;
}) {
  const { pending, error, run } = useRun();
  const [address, setAddress] = useState<string | null>(null);
  return (
    <div className="grid min-w-0 gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {address ? (
        <OneTime
          label="Your address (shown once)"
          value={address}
          note="Anyone with this address can create and change tasks as you, so keep it in Make only. Delete it here to switch it off."
        />
      ) : null}
      {hooks.length ? (
        <ul className="divide-y rounded-md border">
          {hooks.map((h) => (
            <li key={h.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{h.name}</div>
                <div className="text-muted-foreground truncate font-mono text-[12px]">
                  {hookBase}
                  {h.tokenHint}…
                </div>
                <div className="text-muted-foreground text-[12px]">
                  {h.lastUsedAt ? `Last used ${new Date(h.lastUsedAt).toLocaleString()}` : "Not used yet"}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${h.name}`}
                disabled={pending}
                onClick={() => {
                  if (confirm(`Delete “${h.name}”? Make scenarios using it will stop working.`))
                    run(() => deleteInboundHookAction(workspaceSlug, h.id));
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const name = String(new FormData(form).get("name"));
          run(
            () => createInboundHookAction(workspaceSlug, name),
            (r) => {
              setAddress(r && r.ok ? (r.message ?? null) : null);
              form.reset();
            },
          );
        }}
      >
        <div className="flex-1">
          <Field label="New address" htmlFor="in-name">
            <Input id="in-name" name="name" required placeholder="Make: support form" />
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          Create address
        </Button>
      </form>
    </div>
  );
}
