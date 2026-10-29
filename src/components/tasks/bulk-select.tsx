"use client";
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { Archive, CalendarPlus, Check, CircleDot, Flag, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import { bulkTaskAction } from "@/modules/tasks/actions";
import type { BulkOperation } from "@/modules/tasks/bulk";
import { PRIORITY_META, type Priority } from "@/lib/task-format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { StatusIcon, type StatusOption } from "./status-menu";
import { DueDateChoices } from "./row-pickers";

interface Selection {
  selected: ReadonlySet<string>;
  /** Shift-click selects every visible row between the last click and this one. */
  toggle: (id: string, range: boolean) => void;
  setMany: (ids: string[], on: boolean) => void;
}

/** Tasks per request: archive/delete run as one query per batch, edits task by task. */
const CHUNK_REMOVE = 100;
const CHUNK_EDIT = 10;

const SelectionContext = createContext<Selection | null>(null);

const checkboxClass =
  "accent-accent size-3.5 cursor-pointer rounded-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 checked:opacity-100 data-[active=true]:opacity-100";

/** The checkbox at the start of a list row (hidden until hover, focus or a selection exists). */
export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const ctx = useContext(SelectionContext);
  if (!ctx) return <span />;
  return (
    <input
      type="checkbox"
      data-bulk-id={id}
      data-active={ctx.selected.size > 0}
      checked={ctx.selected.has(id)}
      onChange={() => undefined}
      onClick={(e) => ctx.toggle(id, e.shiftKey)}
      aria-label={`Select ${label}`}
      className={checkboxClass}
    />
  );
}

/** "Select all" for one status group's tasks. */
export function GroupCheckbox({ ids, label }: { ids: string[]; label: string }) {
  const ctx = useContext(SelectionContext);
  const ref = useRef<HTMLInputElement>(null);
  const count = ctx ? ids.filter((id) => ctx.selected.has(id)).length : 0;
  const all = count > 0 && count === ids.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all;
  }, [count, all]);
  if (!ctx) return <span />;
  return (
    <input
      ref={ref}
      type="checkbox"
      data-active={ctx.selected.size > 0}
      checked={all}
      onChange={() => ctx.setMany(ids, !all)}
      aria-label={`Select all ${label} tasks`}
      className={checkboxClass}
    />
  );
}

const barButton =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] hover:bg-surface-muted disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground";

/**
 * Holds the list's row selection and shows the bulk action bar while tasks are selected.
 * Rows that disappear (archived, deleted, filtered out) drop out of the selection.
 */
export function BulkSelection({
  workspaceSlug,
  listId,
  taskIds,
  statuses,
  people,
  can,
  children,
}: {
  workspaceSlug: string;
  listId: string;
  /** Every task currently in the view. */
  taskIds: string[];
  statuses: StatusOption[];
  people: { userId: string; name: string }[];
  can: { update: boolean; archive: boolean; delete: boolean };
  children: React.ReactNode;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const anchor = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const present = new Set(taskIds);
  const selected: ReadonlySet<string> = new Set([...picked].filter((id) => present.has(id)));

  const toggle = (id: string, range: boolean) => {
    const on = !selected.has(id);
    const boxes = [...(root.current?.querySelectorAll<HTMLInputElement>("[data-bulk-id]") ?? [])];
    const order = boxes.map((b) => b.dataset.bulkId!);
    const from = anchor.current ? order.indexOf(anchor.current) : -1;
    const to = order.indexOf(id);
    const ids =
      range && from >= 0 && to >= 0 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
    anchor.current = id;
    setMany(ids, range ? selected.has(order[from]!) : on);
  };
  const setMany = (ids: string[], on: boolean) => {
    setMessage(null);
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setPicked(next);
  };
  const clear = () => {
    setPicked(new Set());
    anchor.current = null;
  };

  // Escape clears the selection (unless it is closing a menu or leaving a text field).
  useEffect(() => {
    if (!picked.size) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      if (target.closest("[role=menu], [role=dialog], input:not([type=checkbox]), textarea")) return;
      setPicked(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked.size]);

  const n = selected.size;
  const tasksWord = `${n} ${n === 1 ? "task" : "tasks"}`;
  const run = (op: BulkOperation, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    const ids = [...selected];
    const removing = op.kind === "archive" || op.kind === "delete";
    // Archive and delete are one quick query per batch; field edits go task by task on the
    // server, so they are sent in small batches (each request stays well inside time limits).
    const size = removing ? CHUNK_REMOVE : CHUNK_EDIT;
    const verb = { archive: "Archiving", delete: "Deleting" }[op.kind as string] ?? "Updating";
    startTransition(async () => {
      let done = 0;
      let skipped = 0;
      let reason: string | undefined;
      try {
        for (let i = 0; i < ids.length; i += size) {
          if (ids.length > size)
            setMessage({ ok: true, text: `${verb}… ${Math.min(i, ids.length)} of ${ids.length}` });
          const result = await bulkTaskAction(workspaceSlug, listId, ids.slice(i, i + size), op);
          if (result.ok) {
            done += result.done;
            skipped += result.skipped;
            reason ??= result.reason;
          } else {
            skipped += Math.min(size, ids.length - i);
            reason ??= result.message;
          }
        }
      } catch {
        // Lost connection or a server timeout: show what is actually saved.
        setMessage({ ok: false, text: "Couldn't finish. The list has been refreshed to show what changed." });
        clear();
        router.refresh();
        return;
      }
      const past = { archive: "Archived", delete: "Deleted" }[op.kind as string] ?? "Updated";
      const word = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;
      setMessage(
        done === 0
          ? { ok: false, text: reason ?? "Nothing was changed" }
          : {
              ok: true,
              text: `${past} ${word(done)}${skipped ? `. Skipped ${word(skipped)}: ${reason}` : ""}`,
            },
      );
      if (done > 0 && removing) clear();
    });
  };

  return (
    <SelectionContext.Provider value={{ selected, toggle, setMany }}>
      {/* Room at the bottom so the bar never covers the last rows. */}
      <div ref={root} className={n > 0 ? "pb-16" : undefined}>
        {children}
      </div>
      {n > 0 || message ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <div
            role="toolbar"
            aria-label="Bulk actions"
            aria-busy={pending || undefined}
            className="bg-surface pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-xl border p-1.5 shadow-2xl"
          >
            {n > 0 ? (
              <>
                <span className="px-2 text-[13px] font-semibold tabular-nums">{tasksWord} selected</span>
                <span className="bg-border mx-1 h-5 w-px" aria-hidden />
                {can.update ? (
                  <>
                    <DropdownMenu>
                      <DropdownMenuTrigger disabled={pending} className={barButton}>
                        <CircleDot /> Status
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="top" align="start">
                        <DropdownMenuLabel>Set status of {tasksWord}</DropdownMenuLabel>
                        {statuses.map((s) => (
                          <DropdownMenuItem
                            key={s.id}
                            onSelect={() => run({ kind: "status", statusId: s.id })}
                          >
                            <StatusIcon status={s} />
                            {s.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger disabled={pending} className={barButton}>
                        <UserPlus /> Assignee
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="top" align="start" className="max-h-80 overflow-y-auto">
                        <DropdownMenuLabel>Add to {tasksWord}</DropdownMenuLabel>
                        {people.map((p) => (
                          <DropdownMenuItem
                            key={p.userId}
                            onSelect={() => run({ kind: "assign", userId: p.userId })}
                          >
                            <UserPlus />
                            {p.name}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => run({ kind: "unassign" })}>
                          <UserMinus /> Unassign everyone
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger disabled={pending} className={barButton}>
                        <Flag /> Priority
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="top" align="start" className="min-w-40">
                        {(["urgent", "high", "normal", "low"] as Priority[]).map((p) => (
                          <DropdownMenuItem key={p} onSelect={() => run({ kind: "priority", priority: p })}>
                            <Flag className={cn("fill-current", PRIORITY_META[p].tone)} />
                            {PRIORITY_META[p].label}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => run({ kind: "priority", priority: "none" })}>
                          <X /> Clear
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <BulkDueDate disabled={pending} onPick={(dueDate) => run({ kind: "dueDate", dueDate })} />
                  </>
                ) : null}
                {can.archive ? (
                  <button
                    type="button"
                    disabled={pending}
                    className={barButton}
                    onClick={() =>
                      run(
                        { kind: "archive" },
                        `Archive ${tasksWord}? They disappear from the list but keep their history.`,
                      )
                    }
                  >
                    <Archive /> Archive
                  </button>
                ) : null}
                {can.delete ? (
                  <button
                    type="button"
                    disabled={pending}
                    className={cn(barButton, "hover:text-destructive [&:hover_svg]:text-destructive")}
                    onClick={() =>
                      run(
                        { kind: "delete" },
                        `Delete ${tasksWord} permanently?\n\nTheir subtasks, comments and files are deleted too. This can't be undone. (Archive keeps them instead.)`,
                      )
                    }
                  >
                    <Trash2 /> Delete
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Clear selection"
                  title="Clear selection (Esc)"
                  className={barButton}
                >
                  <X />
                </button>
              </>
            ) : null}
            {message ? (
              <p
                role="status"
                className={cn(
                  "flex items-center gap-1.5 px-2 text-[13px]",
                  message.ok ? "text-muted-foreground" : "text-destructive",
                )}
              >
                {message.ok ? <Check className="size-4" aria-hidden /> : null}
                {message.text}
                {n === 0 ? (
                  <button
                    type="button"
                    onClick={() => setMessage(null)}
                    aria-label="Dismiss"
                    className="hover:text-foreground ml-1"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </SelectionContext.Provider>
  );
}

function BulkDueDate({ disabled, onPick }: { disabled: boolean; onPick: (value: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger disabled={disabled} className={barButton}>
        <CalendarPlus /> Due date
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          className="bg-surface text-foreground z-50 w-60 rounded-lg border p-2 shadow-lg"
        >
          <DueDateChoices
            current={null}
            clearable
            onPick={(value) => {
              setOpen(false);
              onPick(value);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
