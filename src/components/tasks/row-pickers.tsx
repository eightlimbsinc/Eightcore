"use client";
import { useOptimistic, useState, useTransition } from "react";
import { Popover } from "radix-ui";
import { CalendarPlus, Check, Flag, X } from "lucide-react";
import { setTaskQuickFieldAction } from "@/modules/tasks/actions";
import { PRIORITY_META, dueState, formatDate, todayIso, type Priority } from "@/lib/task-format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const triggerClass =
  "flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] whitespace-nowrap hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10";

const PRIORITY_ORDER: Priority[] = ["urgent", "high", "normal", "low"];

function useQuickSave(workspaceSlug: string, taskId: string, version: number) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (patch: Parameters<typeof setTaskQuickFieldAction>[3], optimistic: () => void) =>
    startTransition(async () => {
      optimistic();
      const result = await setTaskQuickFieldAction(workspaceSlug, taskId, version, patch);
      setError(result && !result.ok ? result.message : null);
    });
  return { pending, error, save };
}

function ErrorNote({ error }: { error: string | null }) {
  return error ? <span className="text-destructive mt-1 max-w-48 text-[11px]">{error}</span> : null;
}

/** The flag in a list row: pick Urgent / High / Normal / Low, or clear. */
export function PriorityPicker({
  workspaceSlug,
  taskId,
  version,
  priority,
  label,
  canEdit,
}: {
  workspaceSlug: string;
  taskId: string;
  version: number;
  priority: Priority;
  label: string;
  canEdit: boolean;
}) {
  const [shown, setShown] = useOptimistic(priority);
  const { pending, error, save } = useQuickSave(workspaceSlug, taskId, version);
  const meta = PRIORITY_META[shown];
  const face =
    shown === "none" ? (
      <Flag className="text-muted-foreground size-3.5" aria-hidden />
    ) : (
      <span className={cn("inline-flex items-center gap-1", meta.tone)}>
        <Flag className="size-3.5 fill-current" aria-hidden />
        {meta.label}
      </span>
    );
  if (!canEdit) {
    return shown === "none" ? null : <span className={triggerClass}>{face}</span>;
  }
  return (
    <span className="inline-flex flex-col">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${label}: ${shown === "none" ? "none" : meta.label}`}
          disabled={pending}
          className={triggerClass}
        >
          {face}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          {PRIORITY_ORDER.map((p) => (
            <DropdownMenuItem
              key={p}
              onSelect={() => p !== shown && save({ priority: p }, () => setShown(p))}
            >
              <Flag className={cn("fill-current", PRIORITY_META[p].tone)} />
              <span className="flex-1">{PRIORITY_META[p].label}</span>
              {p === shown ? <Check className="!text-foreground" aria-label="Current" /> : null}
            </DropdownMenuItem>
          ))}
          {shown !== "none" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => save({ priority: "none" }, () => setShown("none"))}>
                <X /> Clear
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ErrorNote error={error} />
    </span>
  );
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y!, m! - 1, d! + days);
  return todayIso(date);
}

/** Next Monday (or a week from Monday when today is Monday). */
function nextMonday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(y!, m! - 1, d!).getDay();
  return addDays(iso, (8 - day) % 7 || 7);
}

/** The calendar in a list row: quick picks, any date, or clear. */
export function DueDatePicker({
  workspaceSlug,
  taskId,
  version,
  dueDate,
  completed,
  label,
  canEdit,
}: {
  workspaceSlug: string;
  taskId: string;
  version: number;
  dueDate: string | null;
  completed: boolean;
  label: string;
  canEdit: boolean;
}) {
  const [shown, setShown] = useOptimistic(dueDate);
  const [open, setOpen] = useState(false);
  const { pending, error, save } = useQuickSave(workspaceSlug, taskId, version);
  const state = dueState(shown, completed);
  const face = shown ? (
    <span
      className={cn(
        "tabular-nums",
        state === "overdue" && "text-destructive font-medium",
        state === "today" && "text-accent-foreground font-medium",
        (state === "upcoming" || state === "done") && "text-muted-foreground",
      )}
    >
      {state === "today" ? "Today" : formatDate(shown)}
    </span>
  ) : (
    <CalendarPlus className="text-muted-foreground size-3.5" aria-hidden />
  );
  if (!canEdit) return shown ? <span className={triggerClass}>{face}</span> : null;

  const pick = (value: string | null) => {
    setOpen(false);
    if (value !== shown) save({ dueDate: value }, () => setShown(value));
  };
  return (
    <span className="inline-flex flex-col">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          aria-label={`${label}: ${shown ? formatDate(shown) : "none"}`}
          disabled={pending}
          className={triggerClass}
        >
          {face}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className="bg-surface text-foreground z-50 w-60 rounded-lg border p-2 shadow-lg"
          >
            <DueDateChoices current={shown} onPick={pick} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <ErrorNote error={error} />
    </span>
  );
}

/** Quick picks, any date, or clear: the due date popover's body (also used by bulk edit). */
export function DueDateChoices({
  current,
  onPick,
  clearable = Boolean(current),
}: {
  current: string | null;
  onPick: (value: string | null) => void;
  /** Offer "Clear due date" (default: when there is one). */
  clearable?: boolean;
}) {
  const today = todayIso();
  const quick: [string, string][] = [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["Next week", nextMonday(today)],
    ["In 2 weeks", addDays(today, 14)],
  ];
  return (
    <>
      <ul className="grid gap-0.5">
        {quick.map(([name, value]) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => onPick(value)}
              className="hover:bg-surface-muted flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[13px]"
            >
              {name}
              <span className="text-muted-foreground text-[11px]">{formatDate(value)}</span>
            </button>
          </li>
        ))}
      </ul>
      <label className="mt-2 grid gap-1 border-t px-1 pt-2 text-[11px] font-medium">
        Pick a date
        <input
          type="date"
          defaultValue={current ?? ""}
          aria-label="Due date"
          // Typing a year fills it digit by digit (0002, 0020...); only act on a full, plausible date.
          onChange={(e) => {
            const value = e.target.value;
            if (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1970) onPick(value);
          }}
          className="border-input bg-surface h-8 rounded-md border px-2 text-[13px]"
        />
      </label>
      {clearable ? (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="text-muted-foreground hover:text-destructive mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px]"
        >
          <X className="size-3.5" /> Clear due date
        </button>
      ) : null}
    </>
  );
}
