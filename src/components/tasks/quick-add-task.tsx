"use client";
import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { createTaskAction } from "@/modules/tasks/actions";

/** "+ Add Task" under a status group: type a title, Enter adds it with that status. */
export function QuickAddTask({
  workspaceSlug,
  listId,
  statusId,
  statusName,
}: {
  workspaceSlug: string;
  listId: string;
  statusId: string;
  statusName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    createTaskAction.bind(null, workspaceSlug, listId, null),
    undefined,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground flex h-9 w-full items-center gap-2 px-4 text-[13px]"
      >
        <Plus className="size-3.5" aria-hidden /> Add Task
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 px-4 py-1.5">
      <input type="hidden" name="statusId" value={statusId} />
      <input
        suppressHydrationWarning
        name="title"
        required
        maxLength={500}
        autoFocus
        readOnly={pending}
        aria-label={`New task in ${statusName}`}
        placeholder="Task name, then Enter"
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={(e) => {
          if (!pending && !e.currentTarget.value.trim()) setOpen(false);
        }}
        className="border-input bg-surface h-8 min-w-64 flex-1 rounded-md border px-2 text-[13px]"
      />
      {state ? (
        <span
          role="status"
          className={state.ok ? "text-success text-[12px]" : "text-destructive text-[12px]"}
        >
          {state.message}
        </span>
      ) : (
        <span className="text-muted-foreground text-[11px]">Enter to add · Esc to close</span>
      )}
    </form>
  );
}
