"use client";
import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2, X, Zap } from "lucide-react";
import {
  deleteAutomationAction,
  saveAutomationAction,
  setAutomationEnabledAction,
} from "@/modules/automations/actions";
import {
  ACTION_LABELS,
  CONDITION_LABELS,
  TRIGGER_LABELS,
  type Action,
  type Condition,
  type Trigger,
} from "@/modules/automations/rules";
import type { ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

type Option = { id: string; name: string };
type ListOption = Option & { statuses: (Option & { color: string })[] };
type Definition = {
  name: string;
  listId: string | null;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
};
type Run = { status: string; message: string; createdAt: Date };
type Saved = { id: string; enabled: boolean; definition: Definition; recentRuns: Run[] };
interface Choices {
  lists: ListOption[];
  tags: Option[];
  people: Option[];
  endpoints: Option[];
}

const PRIORITIES = ["urgent", "high", "normal", "low", "none"] as const;
const blank = (): Definition => ({
  name: "",
  listId: null,
  enabled: true,
  trigger: { type: "task_created" },
  conditions: [],
  actions: [{ type: "add_comment", body: "" }],
});

function defaultTrigger(type: Trigger["type"]): Trigger {
  switch (type) {
    case "status_changed":
      return { type, fromStatusId: null, toStatusId: null };
    case "assignee_added":
      return { type, userId: null };
    case "priority_changed":
      return { type, priority: null };
    case "qa_concluded":
      return { type, result: null };
    default:
      return { type };
  }
}
function defaultCondition(type: Condition["type"], c: Choices, statuses: Option[]): Condition {
  switch (type) {
    case "status_is":
      return { type, statusIds: statuses[0] ? [statuses[0].id] : [] };
    case "priority_is":
      return { type, priorities: ["high"] };
    case "has_tag":
      return { type, tagId: c.tags[0]?.id ?? "" };
    case "assignee_is":
      return { type, userId: "none" };
  }
}
function defaultAction(type: Action["type"], c: Choices, statuses: Option[]): Action {
  switch (type) {
    case "set_status":
      return { type, statusId: statuses[0]?.id ?? "" };
    case "assign":
      return { type, userId: c.people[0]?.id ?? "" };
    case "unassign_all":
      return { type };
    case "set_priority":
      return { type, priority: "high" };
    case "add_comment":
      return { type, body: "" };
    case "add_tag":
      return { type, tagId: c.tags[0]?.id ?? "" };
    case "set_due":
      return { type, days: 1 };
    case "send_webhook":
      return { type, endpointId: c.endpoints[0]?.id ?? "" };
  }
}

/** Status options for the chosen list (or every list, grouped, when it applies to the whole project). */
function StatusSelect({
  lists,
  listId,
  value,
  onChange,
  any,
  label,
}: {
  lists: ListOption[];
  listId: string | null;
  value: string | null;
  onChange: (id: string | null) => void;
  any?: string;
  label: string;
}) {
  const shown = listId ? lists.filter((l) => l.id === listId) : lists;
  return (
    <NativeSelect
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-8 min-w-40"
    >
      {any ? <option value="">{any}</option> : null}
      {shown.map((l) =>
        shown.length === 1 ? (
          l.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))
        ) : (
          <optgroup key={l.id} label={l.name}>
            {l.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </NativeSelect>
  );
}

function PersonSelect({
  people,
  value,
  onChange,
  label,
  extra,
}: {
  people: Option[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  extra?: { value: string; label: string };
}) {
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 min-w-40"
    >
      {extra ? <option value={extra.value}>{extra.label}</option> : null}
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  );
}

function Editor({
  workspaceSlug,
  projectId,
  choices,
  initial,
  automationId,
  onDone,
}: {
  workspaceSlug: string;
  projectId: string;
  choices: Choices;
  initial: Definition;
  automationId?: string;
  onDone: () => void;
}) {
  const [d, setD] = useState<Definition>(initial);
  const [result, setResult] = useState<ActionState>(undefined);
  const [pending, startTransition] = useTransition();
  const { lists, tags, people, endpoints } = choices;
  const statuses = (d.listId ? lists.filter((l) => l.id === d.listId) : lists).flatMap((l) => l.statuses);
  const set = (patch: Partial<Definition>) => setD((prev) => ({ ...prev, ...patch }));
  const setCondition = (i: number, c: Condition) =>
    set({ conditions: d.conditions.map((x, j) => (j === i ? c : x)) });
  const setAction = (i: number, a: Action) => set({ actions: d.actions.map((x, j) => (j === i ? a : x)) });
  const t = d.trigger;

  function save() {
    startTransition(async () => {
      const r = await saveAutomationAction(workspaceSlug, projectId, d, automationId);
      setResult(r);
      if (r?.ok) onDone();
    });
  }

  return (
    <div className="grid gap-4 rounded-lg border p-4">
      {result && !result.ok ? <Alert variant="destructive">{result.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="automation-name">
          <Input
            id="automation-name"
            value={d.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Ping the client when it's ready for review"
          />
        </Field>
        <Field label="Applies to" htmlFor="automation-list">
          <NativeSelect
            id="automation-list"
            value={d.listId ?? ""}
            onChange={(e) => set({ listId: e.target.value || null })}
            className="w-full"
          >
            <option value="">Every list in this project</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold">When</h3>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label="Trigger"
            value={t.type}
            onChange={(e) => set({ trigger: defaultTrigger(e.target.value as Trigger["type"]) })}
            className="h-8"
          >
            {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
          {t.type === "status_changed" ? (
            <>
              <span className="text-muted-foreground text-[13px]">from</span>
              <StatusSelect
                label="From status"
                lists={lists}
                listId={d.listId}
                value={t.fromStatusId}
                any="any status"
                onChange={(id) => set({ trigger: { ...t, fromStatusId: id } })}
              />
              <span className="text-muted-foreground text-[13px]">to</span>
              <StatusSelect
                label="To status"
                lists={lists}
                listId={d.listId}
                value={t.toStatusId}
                any="any status"
                onChange={(id) => set({ trigger: { ...t, toStatusId: id } })}
              />
            </>
          ) : null}
          {t.type === "assignee_added" ? (
            <PersonSelect
              label="Who is assigned"
              people={people}
              value={t.userId ?? ""}
              extra={{ value: "", label: "anyone" }}
              onChange={(id) => set({ trigger: { ...t, userId: id || null } })}
            />
          ) : null}
          {t.type === "priority_changed" ? (
            <NativeSelect
              aria-label="New priority"
              value={t.priority ?? ""}
              onChange={(e) =>
                set({ trigger: { ...t, priority: (e.target.value || null) as typeof t.priority } })
              }
              className="h-8 capitalize"
            >
              <option value="">to anything</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  to {p}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          {t.type === "qa_concluded" ? (
            <NativeSelect
              aria-label="QA result"
              value={t.result ?? ""}
              onChange={(e) =>
                set({ trigger: { ...t, result: (e.target.value || null) as typeof t.result } })
              }
              className="h-8"
            >
              <option value="">with any result</option>
              <option value="pass">and passes</option>
              <option value="fail">and fails</option>
            </NativeSelect>
          ) : null}
        </div>
      </section>

      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold">Only if</h3>
        {d.conditions.length === 0 ? <p className="text-muted-foreground text-[13px]">Always.</p> : null}
        {d.conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="Condition"
              value={c.type}
              onChange={(e) =>
                setCondition(i, defaultCondition(e.target.value as Condition["type"], choices, statuses))
              }
              className="h-8"
            >
              {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            {c.type === "status_is" ? (
              <StatusSelect
                label="Status"
                lists={lists}
                listId={d.listId}
                value={c.statusIds[0] ?? null}
                onChange={(id) => setCondition(i, { ...c, statusIds: id ? [id] : [] })}
              />
            ) : null}
            {c.type === "priority_is" ? (
              <NativeSelect
                aria-label="Priority"
                value={c.priorities[0]}
                onChange={(e) =>
                  setCondition(i, { ...c, priorities: [e.target.value as (typeof PRIORITIES)[number]] })
                }
                className="h-8 capitalize"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {c.type === "has_tag" ? (
              <NativeSelect
                aria-label="Tag"
                value={c.tagId}
                onChange={(e) => setCondition(i, { ...c, tagId: e.target.value })}
                className="h-8"
              >
                {tags.length === 0 ? <option value="">No tags in this project yet</option> : null}
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {c.type === "assignee_is" ? (
              <PersonSelect
                label="Assignee"
                people={people}
                value={c.userId}
                extra={{ value: "none", label: "nobody" }}
                onChange={(id) => setCondition(i, { ...c, userId: id })}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove condition"
              onClick={() => set({ conditions: d.conditions.filter((_, j) => j !== i) })}
            >
              <X />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              set({ conditions: [...d.conditions, defaultCondition("priority_is", choices, statuses)] })
            }
          >
            <Plus /> Add condition
          </Button>
        </div>
      </section>

      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold">Then</h3>
        {d.actions.map((a, i) => (
          <div key={i} className="flex flex-wrap items-start gap-2">
            <NativeSelect
              aria-label="Action"
              value={a.type}
              onChange={(e) =>
                setAction(i, defaultAction(e.target.value as Action["type"], choices, statuses))
              }
              className="h-8"
            >
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            {a.type === "set_status" ? (
              <StatusSelect
                label="New status"
                lists={lists}
                listId={d.listId}
                value={a.statusId || null}
                onChange={(id) => setAction(i, { ...a, statusId: id ?? "" })}
              />
            ) : null}
            {a.type === "assign" ? (
              <PersonSelect
                label="Person"
                people={people}
                value={a.userId}
                onChange={(id) => setAction(i, { ...a, userId: id })}
              />
            ) : null}
            {a.type === "set_priority" ? (
              <NativeSelect
                aria-label="Priority"
                value={a.priority}
                onChange={(e) =>
                  setAction(i, { ...a, priority: e.target.value as (typeof PRIORITIES)[number] })
                }
                className="h-8 capitalize"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {a.type === "add_comment" ? (
              <Textarea
                aria-label="Comment"
                value={a.body}
                onChange={(e) => setAction(i, { ...a, body: e.target.value })}
                rows={2}
                className="min-w-64 flex-1"
                placeholder="What the comment says"
              />
            ) : null}
            {a.type === "add_tag" ? (
              <NativeSelect
                aria-label="Tag"
                value={a.tagId}
                onChange={(e) => setAction(i, { ...a, tagId: e.target.value })}
                className="h-8"
              >
                {tags.length === 0 ? <option value="">No tags in this project yet</option> : null}
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {a.type === "set_due" ? (
              <span className="flex items-center gap-2 text-[13px]">
                <Input
                  aria-label="Days from now"
                  type="number"
                  min={0}
                  max={365}
                  value={a.days}
                  onChange={(e) => setAction(i, { ...a, days: Math.max(0, Number(e.target.value) || 0) })}
                  className="h-8 w-20"
                />
                days from then
              </span>
            ) : null}
            {a.type === "send_webhook" ? (
              <NativeSelect
                aria-label="Webhook"
                value={a.endpointId}
                onChange={(e) => setAction(i, { ...a, endpointId: e.target.value })}
                className="h-8"
              >
                {endpoints.length === 0 ? (
                  <option value="">No webhooks yet (a workspace admin adds them under Integrations)</option>
                ) : null}
                {endpoints.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {d.actions.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove action"
                onClick={() => set({ actions: d.actions.filter((_, j) => j !== i) })}
              >
                <X />
              </Button>
            ) : null}
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={d.actions.length >= 10}
            onClick={() => set({ actions: [...d.actions, defaultAction("add_comment", choices, statuses)] })}
          >
            <Plus /> Add action
          </Button>
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={pending}>
          {automationId ? "Save changes" : "Create automation"}
        </Button>
      </div>
    </div>
  );
}

/** "When the status changes to Review, only if priority is high: assign Sam, send to Make". */
function describe(d: Definition, c: Choices) {
  const statusName = (id: string | null) =>
    c.lists.flatMap((l) => l.statuses).find((s) => s.id === id)?.name ?? "a status";
  const person = (id: string | null) => c.people.find((p) => p.id === id)?.name ?? "someone";
  const tag = (id: string) => c.tags.find((x) => x.id === id)?.name ?? "a tag";
  const t = d.trigger;
  const when =
    t.type === "status_changed"
      ? `Status changes${t.fromStatusId ? ` from ${statusName(t.fromStatusId)}` : ""}${t.toStatusId ? ` to ${statusName(t.toStatusId)}` : ""}`
      : t.type === "assignee_added" && t.userId
        ? `${person(t.userId)} is assigned`
        : t.type === "priority_changed" && t.priority
          ? `Priority changes to ${t.priority}`
          : t.type === "qa_concluded" && t.result
            ? `A QA round ${t.result === "pass" ? "passes" : "fails"}`
            : TRIGGER_LABELS[t.type];
  const then = d.actions
    .map((a) => {
      switch (a.type) {
        case "set_status":
          return `move to ${statusName(a.statusId)}`;
        case "assign":
          return `assign ${person(a.userId)}`;
        case "set_priority":
          return `set priority ${a.priority}`;
        case "add_tag":
          return `tag ${tag(a.tagId)}`;
        case "set_due":
          return `due in ${a.days} day${a.days === 1 ? "" : "s"}`;
        case "send_webhook":
          return `send to ${c.endpoints.find((e) => e.id === a.endpointId)?.name ?? "a webhook"}`;
        case "add_comment":
          return "comment";
        case "unassign_all":
          return "unassign everyone";
      }
    })
    .join(", ");
  const where = d.listId ? ` (${c.lists.find((l) => l.id === d.listId)?.name ?? "one list"})` : "";
  return `${when}${where}${d.conditions.length ? `, if ${d.conditions.length} condition${d.conditions.length > 1 ? "s" : ""} hold` : ""}: ${then}.`;
}

export function AutomationManager({
  workspaceSlug,
  projectId,
  automations,
  ...choices
}: Choices & { workspaceSlug: string; projectId: string; automations: Saved[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(automations.length === 0 ? "new" : null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    startTransition(async () => {
      const r = await fn();
      setError(r && !r.ok ? r.message : null);
    });

  return (
    <div className="grid gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {automations.map((a) =>
        editing === a.id ? (
          <Editor
            key={a.id}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            choices={choices}
            initial={a.definition}
            automationId={a.id}
            onDone={() => setEditing(null)}
          />
        ) : (
          <article key={a.id} className="grid gap-2 rounded-lg border p-4" aria-label={a.definition.name}>
            <div className="flex flex-wrap items-center gap-2">
              <Zap className="text-accent-foreground size-4" aria-hidden />
              <h3 className="flex-1 font-medium">{a.definition.name}</h3>
              <label className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={a.enabled}
                  disabled={pending}
                  onChange={(e) =>
                    run(() => setAutomationEnabledAction(workspaceSlug, a.id, e.target.checked))
                  }
                />
                On
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Edit ${a.definition.name}`}
                onClick={() => setEditing(a.id)}
              >
                <Pencil />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${a.definition.name}`}
                disabled={pending}
                onClick={() => {
                  if (confirm(`Delete “${a.definition.name}”?`))
                    run(() => deleteAutomationAction(workspaceSlug, a.id));
                }}
              >
                <Trash2 />
              </Button>
            </div>
            <p className="text-muted-foreground text-[13px]">{describe(a.definition, choices)}</p>
            {a.recentRuns.length ? (
              <details className="text-[12px]">
                <summary className="text-muted-foreground cursor-pointer">Recent runs</summary>
                <ul className="mt-2 grid gap-1">
                  {a.recentRuns.map((r, i) => (
                    <li key={i} className="flex items-baseline gap-2">
                      <Badge
                        variant={r.status === "success" ? "outline" : "destructive"}
                        className="capitalize"
                      >
                        {r.status}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate">{r.message}</span>
                      <time
                        className="text-muted-foreground tabular-nums"
                        dateTime={new Date(r.createdAt).toISOString()}
                      >
                        {new Date(r.createdAt).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="text-muted-foreground text-[12px]">Hasn&apos;t run yet.</p>
            )}
          </article>
        ),
      )}
      {editing === "new" ? (
        <Editor
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          choices={choices}
          initial={blank()}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div>
          <Button type="button" onClick={() => setEditing("new")}>
            <Plus /> New automation
          </Button>
        </div>
      )}
    </div>
  );
}
