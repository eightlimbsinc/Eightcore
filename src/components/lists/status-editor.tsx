"use client";
import { useActionState, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  addStatusAction,
  archiveListAction,
  deleteStatusAction,
  moveStatusAction,
  renameListAction,
  updateStatusAction,
} from "@/modules/lists/actions";
import { STATUS_CATEGORIES } from "@/modules/lists/templates";
import type { ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

interface Status {
  id: string;
  name: string;
  category: string;
  color: string;
}

function CategorySelect({ id, defaultValue }: { id: string; defaultValue: string }) {
  return (
    <NativeSelect id={id} name="category" defaultValue={defaultValue} aria-label="Category">
      {STATUS_CATEGORIES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </NativeSelect>
  );
}

function StatusRow({
  workspaceSlug,
  listId,
  status,
  index,
  all,
}: {
  workspaceSlug: string;
  listId: string;
  status: Status;
  index: number;
  all: Status[];
}) {
  const [state, action, saving] = useActionState(
    updateStatusAction.bind(null, workspaceSlug, listId, status.id),
    undefined,
  );
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionState>(undefined);
  const [deleting, setDeleting] = useState(false);
  const others = all.filter((s) => s.id !== status.id);
  const run = (fn: () => Promise<ActionState>) => startTransition(async () => setResult(await fn()));
  const message =
    state && !state.ok
      ? (state.fieldErrors?.name ?? state.message)
      : result && !result.ok
        ? result.message
        : null;

  return (
    <li className="grid gap-2 px-4 py-3">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input
          suppressHydrationWarning
          type="color"
          name="color"
          defaultValue={status.color}
          aria-label={`Colour of ${status.name}`}
          className="bg-surface h-9 w-10 cursor-pointer rounded-md border p-1"
        />
        <Input
          name="name"
          defaultValue={status.name}
          required
          maxLength={40}
          aria-label="Status name"
          className="w-52"
        />
        <CategorySelect id={`category-${status.id}`} defaultValue={status.category} />
        <Button type="submit" variant="outline" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {state?.ok ? <span className="text-success text-[12px]">Saved</span> : null}
        <span className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${status.name} up`}
            disabled={pending || index === 0}
            onClick={() => run(() => moveStatusAction(workspaceSlug, listId, status.id, "up"))}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${status.name} down`}
            disabled={pending || index === all.length - 1}
            onClick={() => run(() => moveStatusAction(workspaceSlug, listId, status.id, "down"))}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Delete ${status.name}`}
            disabled={pending || others.length === 0}
            onClick={() => setDeleting((d) => !d)}
          >
            <Trash2 />
          </Button>
        </span>
      </form>
      {deleting ? (
        <form
          className="bg-surface-muted flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-[13px]"
          onSubmit={(e) => {
            e.preventDefault();
            const replacement = String(new FormData(e.currentTarget).get("replacement"));
            run(() => deleteStatusAction(workspaceSlug, listId, status.id, replacement));
          }}
        >
          <span>Delete “{status.name}” and move its tasks to</span>
          <NativeSelect
            name="replacement"
            aria-label="Move tasks to"
            defaultValue={others[0]?.id}
            className="h-8"
          >
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>
            Delete status
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDeleting(false)}>
            Cancel
          </Button>
        </form>
      ) : null}
      {message ? <Alert variant="destructive">{message}</Alert> : null}
    </li>
  );
}

export function StatusEditor({
  workspaceSlug,
  listId,
  statuses,
}: {
  workspaceSlug: string;
  listId: string;
  statuses: Status[];
}) {
  const [state, action, pending] = useActionState(
    addStatusAction.bind(null, workspaceSlug, listId),
    undefined,
  );
  return (
    <div className="grid gap-4">
      <ul className="bg-surface divide-y rounded-lg border">
        {statuses.map((s, i) => (
          <StatusRow
            key={`${s.id}-${s.name}-${s.color}-${s.category}`}
            workspaceSlug={workspaceSlug}
            listId={listId}
            status={s}
            index={i}
            all={statuses}
          />
        ))}
      </ul>
      <form action={action} className="bg-surface grid gap-2 rounded-lg border p-4">
        <h3 className="text-[13px] font-semibold">Add a status</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            suppressHydrationWarning
            type="color"
            name="color"
            defaultValue="#3B82F6"
            aria-label="Colour"
            className="bg-surface h-9 w-10 cursor-pointer rounded-md border p-1"
          />
          <Input
            name="name"
            required
            maxLength={40}
            placeholder="e.g. Blocked"
            aria-label="New status name"
            className="w-52"
          />
          <CategorySelect id="new-status-category" defaultValue="active" />
          <Button type="submit" disabled={pending}>
            <Plus /> Add status
          </Button>
        </div>
        {state ? (
          <Alert variant={state.ok ? "success" : "destructive"}>
            {state.ok ? state.message : (state.fieldErrors?.name ?? state.message)}
          </Alert>
        ) : null}
      </form>
      <p className="text-muted-foreground text-[12px]">
        The category tells Eightcore what a status means, whatever you call it. Tasks in a{" "}
        <strong>Done</strong> or <strong>Cancelled</strong> status count as finished.
      </p>
    </div>
  );
}

export function ListSettingsForm({
  workspaceSlug,
  listId,
  name,
  projectKey,
}: {
  workspaceSlug: string;
  listId: string;
  name: string;
  projectKey: string;
}) {
  const [state, action, pending] = useActionState(
    renameListAction.bind(null, workspaceSlug, listId),
    undefined,
  );
  const [archiving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-4">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Field
            label="List name"
            htmlFor="list-rename"
            error={state && !state.ok ? (state.fieldErrors?.name ?? state.message) : undefined}
          >
            <Input id="list-rename" name="name" defaultValue={name} required maxLength={120} />
          </Field>
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Rename"}
        </Button>
        {state?.ok ? <span className="text-success pb-2 text-[12px]">Saved</span> : null}
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={archiving}
          onClick={() => {
            if (!confirm(`Archive the list “${name}”? Its tasks are kept but hidden.`)) return;
            startTransition(async () => {
              const result = await archiveListAction(workspaceSlug, listId, projectKey);
              if (result && !result.ok) setError(result.message);
            });
          }}
        >
          {archiving ? "Archiving…" : "Archive list"}
        </Button>
        {error ? <span className="text-destructive text-[12px]">{error}</span> : null}
      </div>
    </div>
  );
}
