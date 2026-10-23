"use client";
import { useActionState, useState, useTransition } from "react";
import { FolderPlus, ListPlus, Trash2 } from "lucide-react";
import { createFolderAction, createListAction, deleteFolderAction } from "@/modules/lists/actions";
import { STATUS_TEMPLATES } from "@/modules/lists/templates";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

export function NewListForm({
  workspaceSlug,
  projectId,
  folders,
}: {
  workspaceSlug: string;
  projectId: string;
  folders: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(
    createListAction.bind(null, workspaceSlug, projectId),
    undefined,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-3">
      {state && !state.ok && !errors ? <Alert variant="destructive">{state.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="List name" htmlFor="list-name" error={errors?.name}>
          <Input
            id="list-name"
            name="name"
            required
            maxLength={120}
            placeholder="e.g. Sprint 1, Website build"
          />
        </Field>
        <Field label="Folder" htmlFor="list-folder">
          <NativeSelect id="list-folder" name="folderId" defaultValue="" className="w-full">
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-medium">Starting statuses</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(STATUS_TEMPLATES).map(([key, t], i) => (
            <label
              key={key}
              className="bg-surface has-[:checked]:border-accent has-[:checked]:bg-accent-soft/40 flex cursor-pointer gap-3 rounded-md border p-3"
            >
              <input
                suppressHydrationWarning
                type="radio"
                name="template"
                value={key}
                defaultChecked={i === 0}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                <span className="block font-medium">{t.label}</span>
                <span className="text-muted-foreground block text-[12px]">{t.description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-muted-foreground text-[12px]">
          You can rename, add, reorder and remove this list&apos;s statuses later.
        </p>
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          <ListPlus /> {pending ? "Creating…" : "Create list"}
        </Button>
      </div>
    </form>
  );
}

export function NewFolderForm({ workspaceSlug, projectId }: { workspaceSlug: string; projectId: string }) {
  const [state, action, pending] = useActionState(
    createFolderAction.bind(null, workspaceSlug, projectId),
    undefined,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1">
        <Field
          label="New folder"
          htmlFor="folder-name"
          error={state && !state.ok ? (state.fieldErrors?.name ?? state.message) : undefined}
        >
          <Input id="folder-name" name="name" required maxLength={120} placeholder="e.g. Phase 1" />
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        <FolderPlus /> Add folder
      </Button>
    </form>
  );
}

export function DeleteFolderButton({
  workspaceSlug,
  folderId,
  name,
}: {
  workspaceSlug: string;
  folderId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Delete folder ${name}`}
        title="Delete folder (its lists move out of it)"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Delete the folder “${name}”? Its lists are kept and move out of the folder.`)) return;
          startTransition(async () => {
            const result = await deleteFolderAction(workspaceSlug, folderId);
            if (result && !result.ok) setError(result.message);
          });
        }}
      >
        <Trash2 />
      </Button>
      {error ? <span className="text-destructive text-[12px]">{error}</span> : null}
    </>
  );
}
