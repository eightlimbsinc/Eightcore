"use client";
import { useActionState, useState, useTransition } from "react";
import { Archive } from "lucide-react";
import { archiveTaskAction, setAssigneesAction, updateTaskAction } from "@/modules/tasks/actions";
import { PRIORITY_META } from "@/lib/task-format";
import { initials } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

interface TaskFields {
  id: string;
  version: number;
  title: string;
  description: string;
  statusId: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
}

export function TaskForm({
  workspaceSlug,
  task,
  canEdit,
}: {
  workspaceSlug: string;
  task: TaskFields;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(
    updateTaskAction.bind(null, workspaceSlug, task.id),
    undefined,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="version" value={task.version} />
      {state ? (
        <Alert variant={state.ok ? "success" : "destructive"}>{state.message ?? "Saved"}</Alert>
      ) : null}
      <Field label="Title" htmlFor="task-title" error={errors?.title}>
        <Input
          id="task-title"
          name="title"
          defaultValue={task.title}
          required
          maxLength={500}
          disabled={!canEdit}
          className="text-[15px] font-medium"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Priority" htmlFor="task-priority">
          <NativeSelect
            id="task-priority"
            name="priority"
            defaultValue={task.priority}
            disabled={!canEdit}
            className="w-full"
          >
            {Object.entries(PRIORITY_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Start date" htmlFor="task-start" error={errors?.startDate}>
          <Input
            id="task-start"
            type="date"
            name="startDate"
            defaultValue={task.startDate ?? ""}
            disabled={!canEdit}
          />
        </Field>
        <Field label="Due date" htmlFor="task-due" error={errors?.dueDate}>
          <Input
            id="task-due"
            type="date"
            name="dueDate"
            defaultValue={task.dueDate ?? ""}
            disabled={!canEdit}
          />
        </Field>
      </div>
      <Field label="Description" htmlFor="task-description" error={errors?.description}>
        <Textarea
          id="task-description"
          name="description"
          defaultValue={task.description}
          disabled={!canEdit}
          rows={6}
          placeholder={canEdit ? "Add details, acceptance criteria, links…" : "No description"}
        />
      </Field>
      {canEdit ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function AssigneesForm({
  workspaceSlug,
  taskId,
  assignable,
  assignedIds,
  canEdit,
}: {
  workspaceSlug: string;
  taskId: string;
  assignable: { userId: string; name: string; email: string }[];
  assignedIds: string[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(
    setAssigneesAction.bind(null, workspaceSlug, taskId),
    undefined,
  );
  if (!canEdit) {
    const names = assignable.filter((a) => assignedIds.includes(a.userId)).map((a) => a.name);
    return <p className="text-muted-foreground">{names.length ? names.join(", ") : "Nobody assigned"}</p>;
  }
  return (
    <form action={action} className="grid gap-3">
      <ul className="grid max-h-64 gap-1 overflow-y-auto">
        {assignable.map((person) => (
          <li key={person.userId}>
            <label className="hover:bg-surface-muted flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5">
              <input
                suppressHydrationWarning
                type="checkbox"
                name="assignee"
                value={person.userId}
                defaultChecked={assignedIds.includes(person.userId)}
                className="accent-[var(--accent)]"
              />
              <span className="bg-accent-soft text-accent-foreground grid size-6 place-items-center rounded-full text-[10px] font-semibold">
                {initials(person.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{person.name}</span>
                <span className="text-muted-foreground block truncate text-[11px]">{person.email}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save assignees"}
        </Button>
        {state ? (
          <span className={state.ok ? "text-success text-[12px]" : "text-destructive text-[12px]"}>
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function ArchiveTaskButton({
  workspaceSlug,
  taskId,
  listId,
}: {
  workspaceSlug: string;
  taskId: string;
  listId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (!confirm("Archive this task? It disappears from the list but keeps its history.")) return;
            startTransition(async () => {
              const result = await archiveTaskAction(workspaceSlug, taskId, listId);
              if (result && !result.ok) setError(result.message);
            });
          }}
        >
          <Archive /> {pending ? "Archiving…" : "Archive task"}
        </Button>
      </div>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}
