"use client";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { CalendarX2 } from "lucide-react";
import { setTaskQuickFieldAction } from "@/modules/tasks/actions";
import { addDays, WEEKDAYS } from "@/lib/calendar";
import { formatDate } from "@/lib/task-format";
import { cn } from "@/lib/utils";

export interface CalendarTask {
  id: string;
  ref: string;
  title: string;
  version: number;
  dueDate: string | null;
  startDate: string | null;
  statusName: string;
  statusColor: string;
  closed: boolean;
}

const DAY = "day:";

/** Where the pointer is; keyboard drags have no pointer, so use the overlapping cell. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};
const UNDATED = "undated";

/** Keyboard dragging: arrows move one day (Left/Right) or one week (Up/Down). */
const dayKeyboard: KeyboardCoordinateGetter = (event, { context }) => {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.code];
  const { collisionRect, droppableRects } = context;
  if (step === undefined || !collisionRect) return undefined;
  const cx = collisionRect.left + collisionRect.width / 2;
  const cy = collisionRect.top + collisionRect.height / 2;
  const here = [...droppableRects.entries()].find(
    ([id, r]) =>
      String(id).startsWith(DAY) &&
      cx >= r.left &&
      cx <= r.left + r.width &&
      cy >= r.top &&
      cy <= r.top + r.height,
  );
  const date = here ? String(here[0]).slice(DAY.length) : undefined;
  const target = date ? droppableRects.get(`${DAY}${addDays(date, step)}`) : undefined;
  if (!target) return undefined;
  event.preventDefault();
  return { x: target.left + target.width / 2 - collisionRect.width / 2, y: target.top + 24 };
};

/**
 * Tasks on their due dates. Drag a task to another day to reschedule it, or from
 * "No due date" onto a day to schedule it (keyboard: Space, arrows, Space).
 */
export function TaskCalendar({
  workspaceSlug,
  weeks,
  month,
  today,
  tasks,
  canEdit,
}: {
  workspaceSlug: string;
  /** Rows of 7 dates (one row in week view). */
  weeks: string[][];
  /** "YYYY-MM" being shown in month view (days outside it are dimmed), or null in week view. */
  month: string | null;
  today: string;
  tasks: CalendarTask[];
  canEdit: boolean;
}) {
  const dndId = useId();
  const [moved, setMoved] = useState<Record<string, string | null>>({});
  const [signature, setSignature] = useState(tasks.map((t) => `${t.id}:${t.version}`).join());
  const current = tasks.map((t) => `${t.id}:${t.version}`).join();
  if (current !== signature) {
    // Fresh data from the server: drop local overrides.
    setSignature(current);
    setMoved({});
  }
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: dayKeyboard }),
  );

  const dueOf = (t: CalendarTask) => (t.id in moved ? moved[t.id]! : t.dueDate);
  const byDay = new Map<string, CalendarTask[]>();
  const undated: CalendarTask[] = [];
  for (const t of tasks) {
    const due = dueOf(t);
    if (due) byDay.set(due, [...(byDay.get(due) ?? []), t]);
    else undated.push(t);
  }
  // Unscheduled open work first; finished tasks without a date matter less.
  undated.sort((a, b) => Number(a.closed) - Number(b.closed));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const titleOf = (id: string | number) => byId.get(String(id))?.title ?? "a task";
  const placeOf = (id: string | number | undefined) =>
    !id ? "nowhere" : String(id) === UNDATED ? "No due date" : formatDate(String(id).slice(DAY.length));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    const task = byId.get(String(active.id));
    if (!task) return;
    const target = String(over.id) === UNDATED ? null : String(over.id).slice(DAY.length);
    if (target === dueOf(task)) return;
    if (target && task.startDate && task.startDate > target) {
      setError(
        `${task.ref} starts on ${formatDate(task.startDate)}; its due date can't be earlier. Change the start date first.`,
      );
      return;
    }
    setError(null);
    setMoved((m) => ({ ...m, [task.id]: target }));
    startTransition(async () => {
      const result = await setTaskQuickFieldAction(workspaceSlug, task.id, task.version, { dueDate: target });
      if (result && !result.ok) {
        setMoved((m) => {
          const { [task.id]: _drop, ...rest } = m;
          return rest;
        });
        setError(result.message);
      }
    });
  };

  const active = activeId ? byId.get(activeId) : undefined;
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={({ active: a }) => setActiveId(String(a.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active: a }) =>
            `Picked up ${titleOf(a.id)}. Arrow keys move a day or a week, Space drops.`,
          onDragOver: ({ active: a, over }) => `${titleOf(a.id)} is over ${placeOf(over?.id)}.`,
          onDragEnd: ({ active: a, over }) => `${titleOf(a.id)} dropped on ${placeOf(over?.id)}.`,
          onDragCancel: ({ active: a }) => `Moving ${titleOf(a.id)} was cancelled.`,
        },
      }}
    >
      <div className="grid gap-3">
        {error ? (
          <p role="alert" className="text-destructive text-[13px]">
            {error}
          </p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div
            className="bg-surface self-start overflow-hidden rounded-lg border"
            role="grid"
            aria-label="Calendar"
          >
            <div
              className="text-muted-foreground grid grid-cols-[repeat(7,minmax(0,1fr))] border-b text-[11px] font-medium"
              role="row"
            >
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-1.5" role="columnheader">
                  {d}
                </div>
              ))}
            </div>
            {weeks.map((week) => (
              <div
                key={week[0]}
                className="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b last:border-b-0"
                role="row"
              >
                {week.map((date) => (
                  <DayCell
                    key={date}
                    date={date}
                    today={today}
                    dimmed={month !== null && date.slice(0, 7) !== month}
                    tall={month === null}
                    tasks={byDay.get(date) ?? []}
                    workspaceSlug={workspaceSlug}
                    canEdit={canEdit}
                  />
                ))}
              </div>
            ))}
          </div>
          <Undated tasks={undated} workspaceSlug={workspaceSlug} canEdit={canEdit} />
        </div>
      </div>
      <DragOverlay>{active ? <Chip task={active} workspaceSlug={workspaceSlug} lifted /> : null}</DragOverlay>
    </DndContext>
  );
}

function DayCell({
  date,
  today,
  dimmed,
  tall,
  tasks,
  workspaceSlug,
  canEdit,
}: {
  date: string;
  today: string;
  dimmed: boolean;
  tall: boolean;
  tasks: CalendarTask[];
  workspaceSlug: string;
  canEdit: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY}${date}`, disabled: !canEdit });
  const isToday = date === today;
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={`${formatDate(date)}${isToday ? ", today" : ""}: ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
      className={cn(
        "grid min-w-0 content-start gap-1 border-r p-1.5 last:border-r-0",
        tall ? "min-h-80" : "min-h-28",
        dimmed && "bg-surface-muted/40",
        isOver && "bg-accent-soft/60",
      )}
    >
      <span
        className={cn(
          "justify-self-end rounded-full px-1.5 text-[11px] tabular-nums",
          // Days outside the month: smaller and lighter weight, but still readable (WCAG contrast).
          dimmed ? "text-muted-foreground font-light" : "text-muted-foreground",
          isToday && "bg-accent font-semibold text-[#17171a]",
        )}
      >
        {Number(date.slice(8))}
      </span>
      <ul className="grid min-w-0 gap-1">
        {tasks.map((t) => (
          <li key={t.id} className="min-w-0">
            <DraggableChip task={t} workspaceSlug={workspaceSlug} canEdit={canEdit} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Undated({
  tasks,
  workspaceSlug,
  canEdit,
}: {
  tasks: CalendarTask[];
  workspaceSlug: string;
  canEdit: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UNDATED, disabled: !canEdit });
  return (
    <section
      ref={setNodeRef}
      aria-label={`No due date, ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
      className={cn(
        "bg-surface grid content-start gap-2 rounded-lg border p-3",
        isOver && "bg-accent-soft/60",
      )}
    >
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
        <CalendarX2 className="text-muted-foreground size-4" aria-hidden /> No due date
        <span className="text-muted-foreground font-normal tabular-nums">{tasks.length}</span>
      </h2>
      <p className="text-muted-foreground text-[11px]">
        {canEdit ? "Drag onto a day to schedule." : "Not scheduled yet."}
      </p>
      <ul className="grid max-h-[32rem] min-w-0 gap-1 overflow-y-auto">
        {tasks.map((t) => (
          <li key={t.id} className="min-w-0">
            <DraggableChip task={t} workspaceSlug={workspaceSlug} canEdit={canEdit} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DraggableChip({
  task,
  workspaceSlug,
  canEdit,
}: {
  task: CalendarTask;
  workspaceSlug: string;
  canEdit: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !canEdit });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // A group, not a button: the chip holds the task link.
      role="group"
      aria-roledescription={canEdit ? "draggable task" : undefined}
      aria-label={`${task.ref} ${task.title}`}
      className={cn(isDragging && "opacity-40")}
    >
      <Chip task={task} workspaceSlug={workspaceSlug} />
    </div>
  );
}

function Chip({
  task,
  workspaceSlug,
  lifted = false,
}: {
  task: CalendarTask;
  workspaceSlug: string;
  lifted?: boolean;
}) {
  return (
    <span
      className={cn(
        "bg-surface flex min-w-0 cursor-grab items-center gap-1.5 rounded-md border px-1.5 py-1 text-[12px] active:cursor-grabbing",
        lifted && "shadow-lg",
        task.closed && "text-muted-foreground line-through",
      )}
      title={`${task.ref} ${task.title} · ${task.statusName}`}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: task.statusColor }} />
      <Link
        href={`/w/${workspaceSlug}/t/${task.ref}`}
        draggable={false}
        className="min-w-0 truncate hover:underline"
      >
        {task.title}
      </Link>
    </span>
  );
}
