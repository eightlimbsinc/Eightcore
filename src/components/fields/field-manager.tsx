"use client";
import { useActionState, useState, useTransition } from "react";
import { Trash2, X } from "lucide-react";
import {
  addFieldOptionAction,
  createFieldAction,
  deleteFieldAction,
  deleteFieldOptionAction,
  renameFieldAction,
} from "@/modules/fields/actions";
import { FIELD_TYPES, FIELD_TYPE_LABELS, type FieldType } from "@/modules/fields/validators";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { TagChip } from "@/components/tasks/task-bits";

interface ManagedField {
  id: string;
  name: string;
  type: FieldType;
  listId: string | null;
  listName: string | null;
  options: { id: string; label: string; color: string }[];
}

function Status({ state }: { state: { ok: boolean; message?: string } | undefined }) {
  if (!state?.message) return null;
  return (
    <span role="status" className={state.ok ? "text-success text-[12px]" : "text-destructive text-[12px]"}>
      {state.message}
    </span>
  );
}

export function NewFieldForm({
  workspaceSlug,
  projectId,
  lists,
}: {
  workspaceSlug: string;
  projectId: string;
  lists: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(
    createFieldAction.bind(null, workspaceSlug, projectId),
    undefined,
  );
  const [type, setType] = useState<FieldType>("text");
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-3">
      <Field label="Field name" htmlFor="field-name" error={errors?.name}>
        <Input id="field-name" name="name" required maxLength={60} placeholder="e.g. Budget" />
      </Field>
      <Field label="Type" htmlFor="field-type" error={errors?.type}>
        <NativeSelect
          id="field-type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
          className="w-full"
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {type === "dropdown" ? (
        <Field
          label="Options"
          htmlFor="field-options"
          error={errors?.options}
          hint="One per line, or separated by commas"
        >
          <Textarea id="field-options" name="options" rows={4} placeholder={"Social\nEmail\nWebsite"} />
        </Field>
      ) : null}
      <Field label="Applies to" htmlFor="field-list">
        <NativeSelect id="field-list" name="listId" defaultValue="" className="w-full">
          <option value="">Every list in this project</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              Only “{l.name}”
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create field"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function FieldList({ workspaceSlug, fields }: { workspaceSlug: string; fields: ManagedField[] }) {
  if (!fields.length)
    return <p className="text-muted-foreground">No custom fields yet. Create one on the right.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {fields.map((f) => (
        <li key={f.id}>
          <FieldRow workspaceSlug={workspaceSlug} field={f} />
        </li>
      ))}
    </ul>
  );
}

function FieldRow({ workspaceSlug, field }: { workspaceSlug: string; field: ManagedField }) {
  const [renameState, rename, renaming] = useActionState(
    renameFieldAction.bind(null, workspaceSlug, field.id),
    undefined,
  );
  const [optionState, addOption, adding] = useActionState(
    addFieldOptionAction.bind(null, workspaceSlug, field.id),
    undefined,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-3 px-3 py-3" aria-label={`Field ${field.name}`} role="group">
      <div className="flex flex-wrap items-center gap-2">
        <form action={rename} className="flex min-w-0 flex-1 items-center gap-2">
          <Input
            name="name"
            aria-label="Field name"
            defaultValue={field.name}
            required
            maxLength={60}
            className="h-8 max-w-64"
          />
          <Button type="submit" size="sm" variant="outline" disabled={renaming}>
            Save
          </Button>
          <Status state={renameState} />
        </form>
        <span className="text-muted-foreground text-[12px]">
          {FIELD_TYPE_LABELS[field.type]} · {field.listName ? `only “${field.listName}”` : "every list"}
        </span>
        <button
          type="button"
          aria-label={`Delete field ${field.name}`}
          disabled={pending}
          className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-sm"
          onClick={() => {
            if (!confirm(`Delete the field “${field.name}”? Values filled in on tasks are deleted too.`))
              return;
            startTransition(async () => {
              const result = await deleteFieldAction(workspaceSlug, field.id);
              setError(result && !result.ok ? result.message : null);
            });
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {field.type === "dropdown" ? (
        <div className="grid gap-2 pl-1">
          <ul className="flex flex-wrap gap-1.5" aria-label={`Options of ${field.name}`}>
            {field.options.map((o) => (
              <li key={o.id} className="flex items-center gap-0.5">
                <TagChip name={o.label} color={o.color} />
                <button
                  type="button"
                  aria-label={`Remove option ${o.label}`}
                  disabled={pending}
                  className="text-muted-foreground hover:text-destructive grid size-5 place-items-center rounded-sm"
                  onClick={() => {
                    if (!confirm(`Remove “${o.label}”? Tasks that use it become empty for this field.`))
                      return;
                    startTransition(async () => {
                      const result = await deleteFieldOptionAction(workspaceSlug, o.id);
                      setError(result && !result.ok ? result.message : null);
                    });
                  }}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          <form action={addOption} className="flex items-center gap-2">
            <Input
              name="label"
              aria-label={`New option for ${field.name}`}
              placeholder="Add option"
              required
              maxLength={60}
              className="h-8 max-w-48"
            />
            <Button type="submit" size="sm" variant="outline" disabled={adding}>
              Add
            </Button>
            <Status state={optionState} />
          </form>
        </div>
      ) : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}
