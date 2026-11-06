"use client";
import { useOptimistic, useState, useTransition } from "react";
import { Popover } from "radix-ui";
import { Check, Repeat, X } from "lucide-react";
import { setTaskRecurrenceAction } from "@/modules/tasks/actions";
import { describeRecurrence, type Recurrence } from "@/lib/recurrence";
import { cn } from "@/lib/utils";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The weekday of a YYYY-MM-DD date (0 = Sunday), or today's. */
function weekdayOf(date: string | null) {
  if (!date) return new Date().getDay();
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/**
 * "Repeat" on a task: presets (daily, weekdays, weekly, every 2 weeks, monthly, yearly) or a
 * custom rule. When the task is done, the next one is created with its dates moved on.
 */
export function RepeatPicker({
  workspaceSlug,
  taskId,
  version,
  recurrence,
  dueDate,
  canEdit,
}: {
  workspaceSlug: string;
  taskId: string;
  version: number;
  recurrence: Recurrence | null;
  dueDate: string | null;
  canEdit: boolean;
}) {
  const [shown, setShown] = useOptimistic(recurrence);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const day = weekdayOf(dueDate);
  const [custom, setCustom] = useState<Recurrence>(
    recurrence ?? { freq: "weekly", interval: 1, weekdays: [day], weekdaysOnly: false },
  );
  const save = (next: Recurrence | null) => {
    setOpen(false);
    startTransition(async () => {
      setShown(next);
      const result = await setTaskRecurrenceAction(workspaceSlug, taskId, version, next);
      setError(result && !result.ok ? result.message : null);
    });
  };
  const presets: [string, Recurrence][] = [
    ["Daily", { freq: "daily", interval: 1, weekdays: [], weekdaysOnly: false }],
    ["Every weekday (Mon–Fri)", { freq: "daily", interval: 1, weekdays: [], weekdaysOnly: true }],
    [`Weekly on ${DAY_LABELS[day]}`, { freq: "weekly", interval: 1, weekdays: [day], weekdaysOnly: false }],
    ["Every 2 weeks", { freq: "weekly", interval: 2, weekdays: [day], weekdaysOnly: false }],
    ["Monthly", { freq: "monthly", interval: 1, weekdays: [], weekdaysOnly: false }],
    ["Yearly", { freq: "yearly", interval: 1, weekdays: [], weekdaysOnly: false }],
  ];
  const same = (a: Recurrence | null, b: Recurrence) => a !== null && JSON.stringify(a) === JSON.stringify(b);

  const face = shown ? (
    <span className="flex items-center gap-1.5">
      <Repeat className="text-accent-foreground size-3.5" aria-hidden /> {describeRecurrence(shown)}
    </span>
  ) : (
    <span className="text-muted-foreground">Doesn&apos;t repeat</span>
  );
  if (!canEdit) return face;

  return (
    <span className="inline-flex flex-col">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          disabled={pending}
          aria-label={`Repeat: ${shown ? describeRecurrence(shown) : "doesn't repeat"}`}
          className="hover:bg-surface-muted -mx-1.5 flex min-h-7 items-center rounded-md px-1.5 text-left"
        >
          {face}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            aria-label="Repeat"
            className="bg-surface text-foreground z-50 grid w-72 gap-1 rounded-lg border p-1.5 shadow-lg"
          >
            {presets.map(([label, rule]) => (
              <button
                key={label}
                type="button"
                onClick={() => save(rule)}
                className="hover:bg-surface-muted flex items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px]"
              >
                {label}
                {same(shown, rule) ? <Check className="size-3.5" aria-label="Current" /> : null}
              </button>
            ))}
            <fieldset className="grid gap-2 border-t px-2 pt-2 pb-1 text-[13px]">
              <legend className="text-muted-foreground px-0 pt-1 text-[11px] font-medium tracking-wide uppercase">
                Custom
              </legend>
              <div className="flex items-center gap-2">
                Every
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={custom.interval}
                  onChange={(e) =>
                    setCustom({ ...custom, interval: Math.max(1, Number(e.target.value) || 1) })
                  }
                  aria-label="Repeat every"
                  className="border-input bg-surface h-8 w-16 rounded-md border px-2"
                />
                <select
                  value={custom.freq}
                  onChange={(e) => setCustom({ ...custom, freq: e.target.value as Recurrence["freq"] })}
                  aria-label="Unit"
                  className="border-input bg-surface h-8 rounded-md border px-2"
                >
                  <option value="daily">{custom.interval === 1 ? "day" : "days"}</option>
                  <option value="weekly">{custom.interval === 1 ? "week" : "weeks"}</option>
                  <option value="monthly">{custom.interval === 1 ? "month" : "months"}</option>
                  <option value="yearly">{custom.interval === 1 ? "year" : "years"}</option>
                </select>
              </div>
              {custom.freq === "weekly" ? (
                <div className="flex gap-1" role="group" aria-label="On these days">
                  {DAYS.map((d, i) => {
                    const on = custom.weekdays.includes(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        aria-pressed={on}
                        aria-label={DAY_LABELS[i]}
                        onClick={() =>
                          setCustom({
                            ...custom,
                            weekdays: on ? custom.weekdays.filter((x) => x !== i) : [...custom.weekdays, i],
                          })
                        }
                        className={cn(
                          "grid size-7 place-items-center rounded-full border text-[12px]",
                          on && "bg-accent border-accent font-semibold text-[#17171a]",
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => save({ ...custom, weekdaysOnly: false })}
                className="bg-primary text-primary-foreground h-8 rounded-md text-[13px] font-medium"
              >
                {/* "Every week on Tue" → "Repeat every week on Tue" */}
                Repeat {describeRecurrence(custom).replace(/^Every/, "every")}
              </button>
            </fieldset>
            {shown ? (
              <button
                type="button"
                onClick={() => save(null)}
                className="text-muted-foreground hover:text-destructive flex items-center gap-1.5 rounded-md border-t px-2 py-1.5 text-left text-[13px]"
              >
                <X className="size-3.5" aria-hidden /> Stop repeating
              </button>
            ) : null}
            <p className="text-muted-foreground px-2 pb-1 text-[11px]">
              When this task is done, the next one is created with its dates moved on.
            </p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error ? <span className="text-destructive text-[11px]">{error}</span> : null}
    </span>
  );
}
