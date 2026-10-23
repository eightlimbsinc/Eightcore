"use client";
import { useActionState, useState, useTransition } from "react";
import { Archive } from "lucide-react";
import { archiveTaskAction, updateTaskAction } from "@/modules/tasks/actions";
import { PRIORITY_META } from "@/lib/task-format";
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
