"use client";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Ban, Check, X } from "lucide-react";
import { addDependencyAction, removeDependencyAction } from "@/modules/dependencies/actions";
import { saveTaskFieldsAction } from "@/modules/fields/actions";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { StatusPill } from "./task-bits";

interface LinkedTask {
  id: string;
  ref: string;
  title: string;
  done: boolean;
  statusName: string;
  statusColor: string;
}

function LinkedList({
  workspaceSlug,
  title,
  tasks,
  canEdit,
  pair,
  emptyText,
}: {
  workspaceSlug: string;
  title: string;
  tasks: LinkedTask[];
  canEdit: boolean;
  /** [blockingTaskId, blockedTaskId] for a row. */
  pair: (t: LinkedTask) => [string, string];
  emptyText: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-1.5">
      <h3 className="text-[12px] font-medium">{title}</h3>
      {tasks.length ? (
        <ul className="grid gap-1" aria-label={title}>
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[13px]">
              {t.done ? (
                <Check className="text-success size-3.5 shrink-0" aria-label="Finished" />
              ) : (
                <Ban className="text-destructive size-3.5 shrink-0" aria-label="Not finished" />
              )}
              <span className="text-muted-foreground font-mono text-[11px]">{t.ref}</span>
              <Link
                href={`/w/${workspaceSlug}/t/${t.ref}`}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {t.title}
              </Link>
              <StatusPill name={t.statusName} color={t.statusColor} />
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`Remove link to ${t.ref}`}
                  disabled={pending}
                  className="text-muted-foreground hover:text-destructive grid size-6 place-items-center rounded-sm"
                  onClick={() =>
                    startTransition(async () => {
                      const [blocking, blocked] = pair(t);
                      const result = await removeDependencyAction(workspaceSlug, blocking, blocked);
                      setError(result && !result.ok ? result.message : null);
                    })
                  }
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-[13px]">{emptyText}</p>
      )}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}

export function DependenciesPanel({
  workspaceSlug,
  taskId,
  blockedBy,
  blocking,
  canEdit,
}: {
  workspaceSlug: string;
  taskId: string;
  blockedBy: LinkedTask[];
  blocking: LinkedTask[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(
    addDependencyAction.bind(null, workspaceSlug, taskId),
    undefined,
  );
  return (
    <div className="grid gap-4">
      <LinkedList
        workspaceSlug={workspaceSlug}
        title="Blocked by"
        tasks={blockedBy}
        canEdit={canEdit}
        pair={(t) => [t.id, taskId]}
        emptyText="Nothing needs to be finished first."
      />
      <LinkedList
        workspaceSlug={workspaceSlug}
        title="Blocking"
        tasks={blocking}
        canEdit={canEdit}
        pair={(t) => [taskId, t.id]}
        emptyText="No tasks are waiting on this one."
      />
      {canEdit ? (
        <form action={action} className="grid gap-2 border-t pt-3">
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              name="relation"
              aria-label="Relation"
              defaultValue="blocked_by"
              className="h-8 w-32"
            >
              <option value="blocked_by">Blocked by</option>
              <option value="blocking">Blocking</option>
            </NativeSelect>
            <Input
              name="ref"
              aria-label="Task reference"
              placeholder="e.g. WEB-12"
              required
              maxLength={20}
              className="h-8 w-28 font-mono uppercase"
            />
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              Link
            </Button>
          </div>
          {state ? (
            <span
              role="status"
              className={state.ok ? "text-success text-[12px]" : "text-destructive text-[12px]"}
            >
              {state.message}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

interface FieldView {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "dropdown" | "checkbox" | "person" | "url";
  options: { id: string; label: string; color: string }[];
  value: string;
  display: { text: string; color?: string } | null;
}

export function FieldsPanel({
  workspaceSlug,
  taskId,
  fields,
  people,
  canEdit,
  manageHref,
}: {
  workspaceSlug: string;
  taskId: string;
  fields: FieldView[];
  people: { userId: string; name: string }[];
  canEdit: boolean;
  manageHref: string | null;
}) {
  const [state, action, pending] = useActionState(
    saveTaskFieldsAction.bind(null, workspaceSlug, taskId),
    undefined,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  if (!fields.length) {
    return (
      <p className="text-muted-foreground text-[13px]">
        No custom fields yet.{" "}
        {manageHref ? (
          <Link href={manageHref} className="text-foreground underline underline-offset-4">
            Add fields to this project
          </Link>
        ) : null}
      </p>
    );
  }
  if (!canEdit) {
    return (
      <dl className="grid gap-2 text-[13px]">
        {fields.map((f) => (
          <div key={f.id} className="grid grid-cols-[8rem_1fr] gap-2">
            <dt className="text-muted-foreground truncate">{f.name}</dt>
            <dd className="min-w-0 truncate">
              {f.display ? f.type === "url" ? <ExternalLink href={f.display.text} /> : f.display.text : "—"}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <form action={action} className="grid gap-3">
      {fields.map((f) => {
        const id = `field-${f.id}`;
        const name = `field.${f.id}`;
        const error = errors?.[name];
        return (
          <div key={f.id} className="grid gap-1">
            <input type="hidden" name="fields" value={f.id} />
            {f.type === "checkbox" ? (
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  suppressHydrationWarning
                  type="checkbox"
                  name={name}
                  defaultChecked={f.value === "on"}
                  className="accent-[var(--accent)]"
                />
                {f.name}
              </label>
            ) : (
              <>
                <label htmlFor={id} className="flex items-center justify-between text-[12px] font-medium">
                  {f.name}
                  {f.type === "url" && f.value ? <ExternalLink href={f.value} label="Open" /> : null}
                </label>
                <FieldInput id={id} name={name} field={f} people={people} invalid={Boolean(error)} />
              </>
            )}
            {error ? <span className="text-destructive text-[11px]">{error}</span> : null}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save fields"}
        </Button>
        {state ? (
          <span
            role="status"
            className={state.ok ? "text-success text-[12px]" : "text-destructive text-[12px]"}
          >
            {state.message}
          </span>
        ) : null}
        {manageHref ? (
          <Link href={manageHref} className="text-muted-foreground hover:text-foreground ml-auto text-[12px]">
            Manage fields
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function FieldInput({
  id,
  name,
  field,
  people,
  invalid,
}: {
  id: string;
  name: string;
  field: FieldView;
  people: { userId: string; name: string }[];
  invalid: boolean;
}) {
  const common = { id, name, defaultValue: field.value, "aria-invalid": invalid || undefined };
  switch (field.type) {
    case "dropdown":
      return (
        <NativeSelect {...common} className="h-8 w-full">
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      );
    case "person":
      return (
        <NativeSelect {...common} className="h-8 w-full">
          <option value="">—</option>
          {people.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      );
    case "date":
      return <Input {...common} type="date" className="h-8" />;
    case "number":
      return <Input {...common} inputMode="decimal" placeholder="0" className="h-8 tabular-nums" />;
    case "url":
      return <Input {...common} type="url" placeholder="https://" className="h-8" />;
    default:
      return <Input {...common} maxLength={2000} className="h-8" />;
  }
}

function ExternalLink({ href, label }: { href: string; label?: string }) {
  // Only http(s) links are ever stored (see parseFieldValue).
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-accent-foreground truncate font-normal underline underline-offset-4"
    >
      {label ?? href}
    </a>
  );
}
