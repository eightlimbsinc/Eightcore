"use client";
import { useActionState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { createTaskAction } from "@/modules/tasks/actions";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export function NewTaskForm({
  workspaceSlug,
  listId,
  parentTaskId = null,
  statuses,
  placeholder = "Add a task…",
  autoFocus = false,
  onCreated,
}: {
  workspaceSlug: string;
  listId: string;
  parentTaskId?: string | null;
  statuses: { id: string; name: string }[];
  placeholder?: string;
  autoFocus?: boolean;
  /** Called with the success message (e.g. "Created WEB-4") instead of showing it here. */
  onCreated?: (message: string) => void;
}) {
  const [state, action, pending] = useActionState(
    createTaskAction.bind(null, workspaceSlug, listId, parentTaskId),
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state?.ok) return;
    formRef.current?.reset();
    onCreated?.(state.message ?? "Created");
    // Only when a new result arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form ref={formRef} action={action} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="title"
          required
          maxLength={500}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-label={parentTaskId ? "New subtask title" : "New task title"}
          className="min-w-64 flex-1"
        />
        <NativeSelect
          name="statusId"
          aria-label={parentTaskId ? "Subtask status" : "Status"}
          defaultValue={statuses[0]?.id}
        >
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <Input
          type="date"
          name="dueDate"
          aria-label={parentTaskId ? "Subtask due date" : "Due date"}
          className="w-40"
        />
        <Button type="submit" disabled={pending}>
          <Plus /> {parentTaskId ? "Add subtask" : "Add task"}
        </Button>
      </div>
      {state && !(state.ok && onCreated) ? (
        <Alert variant={state.ok ? "success" : "destructive"}>
          {state.ok ? state.message : (state.fieldErrors?.title ?? state.message)}
        </Alert>
      ) : null}
    </form>
  );
}
