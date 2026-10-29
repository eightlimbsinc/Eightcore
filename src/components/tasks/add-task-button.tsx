"use client";
import { useState } from "react";
import { Dialog } from "radix-ui";
import { Plus, X } from "lucide-react";
import { NewTaskForm } from "./new-task-form";

/** The toolbar's "Add task": a small window with title, status and due date. */
export function AddTaskButton({
  workspaceSlug,
  listId,
  listName,
  statuses,
}: {
  workspaceSlug: string;
  listId: string;
  listName: string;
  statuses: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {created ? (
        <span role="status" className="text-success text-[13px]">
          {created}
        </span>
      ) : null}
      <Dialog.Root
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setCreated(null);
        }}
      >
        <Dialog.Trigger className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium hover:opacity-90 [&_svg]:size-4">
          <Plus aria-hidden /> Add task
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            aria-describedby={undefined}
            className="bg-surface text-foreground fixed top-[15vh] left-1/2 z-50 grid w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 gap-4 rounded-xl border p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <Dialog.Title className="text-base font-semibold">New task in {listName}</Dialog.Title>
              <Dialog.Close
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <NewTaskForm
              workspaceSlug={workspaceSlug}
              listId={listId}
              statuses={statuses}
              placeholder="Task name"
              autoFocus
              onCreated={(message) => {
                setCreated(message);
                setOpen(false);
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
