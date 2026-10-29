"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Popover } from "radix-ui";
import { Pencil, Play, Plus, Square, Trash2, X } from "lucide-react";
import {
  addTimeEntryAction,
  deleteTimeEntryAction,
  setTimeEstimateAction,
  startTimerAction,
  stopTimerAction,
  updateTimeEntryAction,
} from "@/modules/time/actions";
import { formatClock, formatMinutes } from "@/lib/time-format";
import { formatDate, todayIso } from "@/lib/task-format";
import { PersonAvatar } from "@/components/app/person-avatar";
import { cn } from "@/lib/utils";

export interface TimeEntryView {
  id: string;
  userId: string;
  userName: string;
  /** ISO timestamp. */
  startedAt: string;
  seconds: number;
  running: boolean;
  note: string;
  source: string;
  canEdit: boolean;
}

/** The current time, refreshed every second while `active` (for running timers). */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Seconds since `iso`, updated every second (for a running timer). */
function useTicker(iso: string | null) {
  const now = useNow(Boolean(iso));
  return iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000)) : 0;
}

const pill =
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10 [&_svg]:size-3.5";

/**
 * "Time tracked" on a task: start/stop the timer, the total (live while a timer runs, against
 * the estimate), and a popover to add time by hand or edit entries.
 */
export function TaskTime({
  workspaceSlug,
  taskId,
  entries,
  totalSeconds,
  myRunningSince,
  canTrack,
}: {
  workspaceSlug: string;
  taskId: string;
  entries: TimeEntryView[];
  /** Total when the page was rendered (running timers counted up to then). */
  totalSeconds: number;
  /** When my timer on this task started (ISO), or null. */
  myRunningSince: string | null;
  canTrack: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Running timers keep counting on screen: finished entries as stored, running ones from their start.
  const anyRunning = entries.some((e) => e.running);
  const now = useNow(anyRunning);
  const liveTotal = anyRunning
    ? entries.reduce(
        (n, e) => n + (e.running ? Math.max(0, (now - new Date(e.startedAt).getTime()) / 1000) : e.seconds),
        0,
      )
    : totalSeconds;
  const mine = myRunningSince
    ? Math.max(0, Math.floor((now - new Date(myRunningSince).getTime()) / 1000))
    : 0;

  const toggle = () =>
    startTransition(async () => {
      const result = myRunningSince
        ? await stopTimerAction(workspaceSlug)
        : await startTimerAction(workspaceSlug, taskId);
      setError(result && !result.ok ? result.message : null);
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canTrack ? (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-label={myRunningSince ? "Stop timer" : "Start timer"}
          className={cn(
            "neu-tile size-7 rounded-full",
            myRunningSince ? "text-destructive neu-inset" : "text-foreground",
          )}
        >
          {myRunningSince ? (
            <Square className="size-3 fill-current" />
          ) : (
            <Play className="size-3 fill-current" />
          )}
        </button>
      ) : null}
      <span className="tabular-nums" aria-live="off" suppressHydrationWarning>
        {myRunningSince ? (
          <span className="text-destructive font-medium">{formatClock(mine)}</span>
        ) : (
          formatMinutes(liveTotal / 60)
        )}
      </span>
      {myRunningSince ? (
        <span className="text-muted-foreground text-[12px]">total {formatMinutes(liveTotal / 60)}</span>
      ) : null}
      <TimeEntriesPopover
        workspaceSlug={workspaceSlug}
        taskId={taskId}
        entries={entries}
        canTrack={canTrack}
      />
      {error ? (
        <span role="alert" className="text-destructive text-[12px]">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function TimeEntriesPopover({
  workspaceSlug,
  taskId,
  entries,
  canTrack,
}: {
  workspaceSlug: string;
  taskId: string;
  entries: TimeEntryView[];
  canTrack: boolean;
}) {
  const [state, action, adding] = useActionState(
    addTimeEntryAction.bind(null, workspaceSlug, taskId),
    undefined,
  );
  const [formKey, setFormKey] = useState(0);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    // Clear the form after a successful add.
    if (state?.ok) setFormKey((k) => k + 1);
  }
  if (!canTrack && entries.length === 0) return null;
  return (
    <Popover.Root>
      <Popover.Trigger className={cn(pill, "text-muted-foreground")}>
        {canTrack ? (
          <>
            <Plus /> Log time
          </>
        ) : (
          `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          aria-label="Time entries"
          className="bg-surface text-foreground z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-3 rounded-lg border p-3 shadow-lg"
        >
          {canTrack ? (
            <form key={formKey} action={action} className="grid gap-2">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  name="duration"
                  required
                  autoFocus
                  aria-label="Time spent"
                  placeholder="Time spent, e.g. 1h 30m"
                  className="border-input bg-surface h-8 rounded-md border px-2 text-[13px]"
                />
                <input
                  type="date"
                  name="date"
                  defaultValue={todayIso()}
                  aria-label="Day"
                  className="border-input bg-surface h-8 rounded-md border px-2 text-[13px]"
                />
              </div>
              <div className="flex gap-2">
                <input
                  name="note"
                  maxLength={500}
                  aria-label="Note"
                  placeholder="What was it? (optional)"
                  className="border-input bg-surface h-8 min-w-0 flex-1 rounded-md border px-2 text-[13px]"
                />
                <button
                  type="submit"
                  disabled={adding}
                  className="bg-primary text-primary-foreground h-8 rounded-md px-3 text-[13px] font-medium disabled:opacity-60"
                >
                  Add
                </button>
              </div>
              {state ? (
                <p
                  role="status"
                  className={cn("text-[12px]", state.ok ? "text-success" : "text-destructive")}
                >
                  {state.message}
                </p>
              ) : null}
            </form>
          ) : null}
          {entries.length ? (
            <ul className="grid max-h-72 gap-1 overflow-y-auto border-t pt-2" aria-label="Entries">
              {entries.map((e) => (
                <EntryRow key={e.id} workspaceSlug={workspaceSlug} entry={e} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground border-t pt-2 text-[12px]">No time tracked yet.</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function EntryRow({ workspaceSlug, entry }: { workspaceSlug: string; entry: TimeEntryView }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const live = useTicker(entry.running ? entry.startedAt : null);
  const seconds = entry.running ? live : entry.seconds;
  const day = entry.startedAt.slice(0, 10);
  const save = (form: FormData) =>
    startTransition(async () => {
      const result = await updateTimeEntryAction(workspaceSlug, entry.id, {
        duration: entry.running ? undefined : String(form.get("duration") ?? ""),
        note: String(form.get("note") ?? ""),
      });
      if (result && !result.ok) setError(result.message);
      else {
        setError(null);
        setEditing(false);
      }
    });
  return (
    <li className="grid gap-1 rounded-md px-1 py-1 text-[13px]">
      {editing ? (
        <form action={save} className="flex flex-wrap items-center gap-1.5">
          {!entry.running ? (
            <input
              name="duration"
              defaultValue={formatMinutes(seconds / 60)}
              aria-label="Time spent"
              className="border-input bg-surface h-7 w-24 rounded-md border px-2 text-[12px]"
            />
          ) : null}
          <input
            name="note"
            defaultValue={entry.note}
            maxLength={500}
            aria-label="Note"
            className="border-input bg-surface h-7 min-w-0 flex-1 rounded-md border px-2 text-[12px]"
          />
          <button type="submit" disabled={pending} className={cn(pill, "border")}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" className={pill}>
            <X />
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <PersonAvatar id={entry.userId} name={entry.userName} size="xs" title={entry.userName} />
          <span
            suppressHydrationWarning
            className={cn("w-16 shrink-0 tabular-nums", entry.running && "text-destructive font-medium")}
          >
            {entry.running ? formatClock(seconds) : formatMinutes(seconds / 60)}
          </span>
          <span className="text-muted-foreground w-14 shrink-0 text-[12px]">{formatDate(day)}</span>
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-[12px]" title={entry.note}>
            {entry.note || (entry.source === "timer" ? "Timer" : "")}
          </span>
          {entry.canEdit ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Edit entry ${formatMinutes(seconds / 60)} on ${formatDate(day)}`}
                className={cn(pill, "text-muted-foreground px-1")}
              >
                <Pencil />
              </button>
              <button
                type="button"
                disabled={pending}
                aria-label={`Delete entry ${formatMinutes(seconds / 60)} on ${formatDate(day)}`}
                onClick={() => {
                  if (!confirm("Delete this time entry?")) return;
                  startTransition(async () => {
                    const result = await deleteTimeEntryAction(workspaceSlug, entry.id);
                    setError(result && !result.ok ? result.message : null);
                  });
                }}
                className={cn(pill, "text-muted-foreground hover:text-destructive px-1")}
              >
                <Trash2 />
              </button>
            </>
          ) : null}
        </div>
      )}
      {error ? (
        <span role="alert" className="text-destructive text-[12px]">
          {error}
        </span>
      ) : null}
    </li>
  );
}

/** "Time estimate": click to type a duration ("2h 30m"); empty clears it. Shows progress. */
export function TimeEstimate({
  workspaceSlug,
  taskId,
  version,
  estimateMinutes,
  trackedSeconds,
  canEdit,
}: {
  workspaceSlug: string;
  taskId: string;
  version: number;
  estimateMinutes: number | null;
  trackedSeconds: number;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const used = estimateMinutes ? trackedSeconds / 60 / estimateMinutes : 0;
  const save = (form: FormData) =>
    startTransition(async () => {
      const result = await setTimeEstimateAction(
        workspaceSlug,
        taskId,
        version,
        String(form.get("estimate") ?? ""),
      );
      if (result && !result.ok) setError(result.message);
      else {
        setError(null);
        setEditing(false);
      }
    });
  if (editing) {
    return (
      <form action={save} className="flex flex-wrap items-center gap-1.5">
        <input
          name="estimate"
          autoFocus
          defaultValue={estimateMinutes ? formatMinutes(estimateMinutes) : ""}
          placeholder="e.g. 4h"
          aria-label="Time estimate"
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="border-input bg-surface h-7 w-28 rounded-md border px-2 text-[13px]"
        />
        <button type="submit" disabled={pending} className={cn(pill, "border")}>
          Save
        </button>
        {error ? (
          <span role="alert" className="text-destructive text-[12px]">
            {error}
          </span>
        ) : null}
      </form>
    );
  }
  const face = estimateMinutes ? (
    <span className="flex items-center gap-2">
      <span className="tabular-nums">{formatMinutes(estimateMinutes)}</span>
      <span
        className="bg-surface-muted relative h-1.5 w-20 overflow-hidden rounded-full"
        role="meter"
        aria-label="Tracked against estimate"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(used, 1) * 100)}
      >
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full", used > 1 ? "bg-destructive" : "bg-accent")}
          style={{ width: `${Math.min(used, 1) * 100}%` }}
        />
      </span>
      <span className={cn("text-[12px]", used > 1 ? "text-destructive" : "text-muted-foreground")}>
        {Math.round(used * 100)}%
      </span>
    </span>
  ) : (
    <span className="text-muted-foreground">Empty</span>
  );
  return canEdit ? (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Time estimate: ${estimateMinutes ? formatMinutes(estimateMinutes) : "none"}`}
      className="hover:bg-surface-muted -mx-1.5 flex min-h-7 items-center rounded-md px-1.5 text-left"
    >
      {face}
    </button>
  ) : (
    face
  );
}
