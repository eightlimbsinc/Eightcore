"use client";
import { useActionState, useState } from "react";
import { Dialog, Popover } from "radix-ui";
import { CalendarPlus, Check, Flag, Plus, UserPlus, X } from "lucide-react";
import { createTaskAction } from "@/modules/tasks/actions";
import { PRIORITY_META, formatDate, type Priority } from "@/lib/task-format";
import type { ActionState } from "@/lib/action-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/app/person-avatar";
import { StatusIcon, type StatusOption } from "./status-menu";
import { DueDateChoices } from "./row-pickers";

const chip =
  "border-input hover:bg-surface-muted data-[state=open]:bg-surface-muted inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] [&_svg]:size-3.5 [&_svg]:shrink-0";

const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];

interface Person {
  userId: string;
  name: string;
}

/** The toolbar's "Add task": a window with name, description, status, assignees, due date and priority. */
export function AddTaskButton({
  workspaceSlug,
  listId,
  listName,
  statuses,
  people,
}: {
  workspaceSlug: string;
  listId: string;
  listName: string;
  statuses: StatusOption[];
  people: Person[];
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
        <Dialog.Trigger
          data-add-task
          className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium hover:opacity-90 [&_svg]:size-4"
        >
          <Plus aria-hidden /> Add task
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            aria-describedby={undefined}
            className="bg-surface text-foreground fixed top-[12vh] left-1/2 z-50 w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border shadow-2xl"
          >
            {/* A fresh form each time the window opens. */}
            {open ? (
              <NewTaskWindow
                workspaceSlug={workspaceSlug}
                listId={listId}
                listName={listName}
                statuses={statuses}
                people={people}
                onCreated={(message) => {
                  setCreated(message);
                  setOpen(false);
                }}
              />
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function NewTaskWindow({
  workspaceSlug,
  listId,
  listName,
  statuses,
  people,
  onCreated,
}: {
  workspaceSlug: string;
  listId: string;
  listName: string;
  statuses: StatusOption[];
  people: Person[];
  onCreated: (message: string) => void;
}) {
  const [statusId, setStatusId] = useState(statuses[0]?.id ?? "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>("none");
  const [dueOpen, setDueOpen] = useState(false);

  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const result = await createTaskAction(workspaceSlug, listId, null, prev, form);
    if (result?.ok) onCreated(result.message ?? "Created");
    return result;
  }, undefined);

  const status = statuses.find((s) => s.id === statusId);
  const assigned = people.filter((p) => assigneeIds.includes(p.userId));
  const toggleAssignee = (id: string) =>
    setAssigneeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <form action={action} className="grid">
      <input type="hidden" name="statusId" value={statusId} />
      <input type="hidden" name="priority" value={priority} />
      <input type="hidden" name="dueDate" value={dueDate ?? ""} />
      {assigneeIds.map((id) => (
        <input key={id} type="hidden" name="assigneeId" value={id} />
      ))}

      <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
        <Dialog.Title className="text-[13px] font-medium">
          New task <span className="text-muted-foreground font-normal">in {listName}</span>
        </Dialog.Title>
        <Dialog.Close
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
        >
          <X className="size-4" />
        </Dialog.Close>
      </div>

      <div className="grid gap-1 px-5 pt-4">
        <input
          name="title"
          required
          maxLength={500}
          autoFocus
          placeholder="Task name"
          aria-label="New task title"
          className="placeholder:text-muted-foreground/70 h-10 w-full bg-transparent text-lg font-semibold outline-none"
        />
        <textarea
          name="description"
          maxLength={20_000}
          rows={4}
          placeholder="Add a description"
          aria-label="Description"
          onKeyDown={(e) => {
            // Ctrl/⌘+Enter creates the task from the description too.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
          className="placeholder:text-muted-foreground/70 min-h-24 w-full resize-y bg-transparent text-sm outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pt-2 pb-4">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Status: ${status?.name ?? "none"}`}
            className={cn(chip, "font-semibold tracking-wide uppercase")}
          >
            {status ? <StatusIcon status={status} /> : null}
            {status?.name}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {statuses.map((s) => (
              <DropdownMenuItem key={s.id} onSelect={() => setStatusId(s.id)}>
                <StatusIcon status={s} />
                <span className="flex-1">{s.name}</span>
                {s.id === statusId ? <Check aria-label="Current" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover.Root>
          <Popover.Trigger
            aria-label={`Assignees: ${assigned.length ? assigned.map((p) => p.name).join(", ") : "none"}`}
            className={chip}
          >
            {assigned.length ? (
              <span className="flex -space-x-1">
                {assigned.slice(0, 3).map((p) => (
                  <PersonAvatar key={p.userId} id={p.userId} name={p.name} size="xs" />
                ))}
              </span>
            ) : (
              <UserPlus />
            )}
            {assigned.length === 0
              ? "Assignee"
              : assigned.length === 1
                ? assigned[0]!.name
                : `${assigned.length} people`}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="bg-surface text-foreground z-50 grid max-h-72 w-60 gap-0.5 overflow-y-auto rounded-lg border p-1 shadow-lg"
            >
              {people.length === 0 ? (
                <p className="text-muted-foreground px-2 py-1.5 text-[13px]">No one to assign yet.</p>
              ) : (
                people.map((p) => {
                  const on = assigneeIds.includes(p.userId);
                  return (
                    <button
                      key={p.userId}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => toggleAssignee(p.userId)}
                      className="hover:bg-surface-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]"
                    >
                      <span
                        className={cn(
                          "grid size-4 place-items-center rounded-sm border",
                          on && "bg-accent border-accent text-[#17171a]",
                        )}
                      >
                        {on ? <Check className="size-3" aria-hidden /> : null}
                      </span>
                      <PersonAvatar id={p.userId} name={p.name} size="xs" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  );
                })
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <Popover.Root open={dueOpen} onOpenChange={setDueOpen}>
          <Popover.Trigger
            aria-label={`Due date: ${dueDate ? formatDate(dueDate) : "none"}`}
            className={chip}
          >
            <CalendarPlus />
            {dueDate ? formatDate(dueDate) : "Due date"}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="bg-surface text-foreground z-50 w-60 rounded-lg border p-2 shadow-lg"
            >
              <DueDateChoices
                current={dueDate}
                onPick={(value) => {
                  setDueDate(value);
                  setDueOpen(false);
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Priority: ${priority === "none" ? "none" : PRIORITY_META[priority].label}`}
            className={chip}
          >
            <Flag className={cn(priority !== "none" && ["fill-current", PRIORITY_META[priority].tone])} />
            {priority === "none" ? "Priority" : PRIORITY_META[priority].label}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-40">
            {PRIORITIES.map((p) => (
              <DropdownMenuItem key={p} onSelect={() => setPriority(p)}>
                <Flag className={cn("fill-current", PRIORITY_META[p].tone)} />
                <span className="flex-1">{PRIORITY_META[p].label}</span>
                {p === priority ? <Check aria-label="Current" /> : null}
              </DropdownMenuItem>
            ))}
            {priority !== "none" ? (
              <DropdownMenuItem onSelect={() => setPriority("none")}>
                <X /> Clear
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
        {state && !state.ok ? (
          <p role="alert" className="text-destructive text-[13px]">
            {state.fieldErrors?.title ?? state.fieldErrors?.dueDate ?? state.message}
          </p>
        ) : (
          <p className="text-muted-foreground text-[11px]">Enter in the name creates the task</p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground inline-flex h-9 shrink-0 items-center rounded-md px-4 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create task"}
        </button>
      </div>
    </form>
  );
}
