"use client";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GitBranch } from "lucide-react";
import { moveTaskAction } from "@/modules/tasks/actions";
import type { TaskPriority } from "@/modules/tasks/validators";
import { cn } from "@/lib/utils";
import { AssigneeStack, BlockedBadge, DueDateLabel, PriorityLabel, TagList } from "./task-bits";
import { QuickAddTask } from "./quick-add-task";
import { confirmCloseWhileBlocked, type StatusOption } from "./status-menu";
import { TaskContextMenu } from "./task-row-menu";

export interface BoardTask {
  id: string;
  ref: string;
  title: string;
  version: number;
  statusId: string;
  priority: TaskPriority;
  dueDate: string | null;
  completed: boolean;
  assignees: { userId: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  subtaskCount: number;
  openBlockers: number;
  canArchive: boolean;
  canDelete: boolean;
}

type Columns = Record<string, string[]>;

const COLUMN = "column:";

function columnsFrom(statuses: StatusOption[], tasks: BoardTask[]): Columns {
  return Object.fromEntries(
    statuses.map((s) => [s.id, tasks.filter((t) => t.statusId === s.id).map((t) => t.id)]),
  );
}

/**
 * Keyboard dragging: Left/Right jump to the top of the neighbouring column (columns are
 * found by their on-screen position), Up/Down move within a column.
 */
const columnKeyboard: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== "ArrowLeft" && event.code !== "ArrowRight")
    return sortableKeyboardCoordinates(event, args);
  const { collisionRect, droppableRects } = args.context;
  if (!collisionRect) return undefined;
  const centre = collisionRect.left + collisionRect.width / 2;
  const columns = [...droppableRects.entries()]
    .filter(([id]) => String(id).startsWith(COLUMN))
    .map(([, rect]) => rect)
    .sort((x, y) => x.left - y.left);
  const here = columns.findIndex((r) => centre >= r.left && centre <= r.left + r.width);
  const next = columns[here + (event.code === "ArrowRight" ? 1 : -1)];
  if (here < 0 || !next) return undefined;
  event.preventDefault();
  return { x: next.left + next.width / 2 - collisionRect.width / 2, y: next.top + 4 };
};

/**
 * Kanban board: one column per status. Drag a card to another column to change its status,
 * or within a column to reorder (mouse, touch, or keyboard: focus a card, Space, arrows, Space).
 */
export function Board({
  workspaceSlug,
  listId,
  statuses,
  tasks,
  canEdit,
  canCreate,
  today,
}: {
  workspaceSlug: string;
  listId: string;
  /** Columns, in view order. */
  statuses: StatusOption[];
  /** Top-level tasks to show, in list order. */
  tasks: BoardTask[];
  canEdit: boolean;
  canCreate: boolean;
  today: string;
}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // Local column order, so a drop shows at once; reset whenever the server sends new data.
  const signature =
    tasks.map((t) => `${t.id}:${t.statusId}:${t.version}`).join("|") + statuses.map((s) => s.id).join();
  const [state, setState] = useState({ signature, columns: columnsFrom(statuses, tasks) });
  if (state.signature !== signature) setState({ signature, columns: columnsFrom(statuses, tasks) });
  const columns = state.columns;
  const setColumns = (update: (c: Columns) => Columns) =>
    setState((s) => ({ ...s, columns: update(s.columns) }));

  // A stable id, so the drag-and-drop accessibility ids match between server and browser.
  const dndId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [startColumns, setStartColumns] = useState<Columns | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const columnOf = (id: string, cols = columns): string | undefined =>
    id.startsWith(COLUMN) ? id.slice(COLUMN.length) : Object.keys(cols).find((c) => cols[c]!.includes(id));

  const sensors = useSensors(
    // A small movement starts a drag, so clicking the title still opens the task.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboard }),
  );

  // Screen reader messages in words ("New logo moved to To Do"), not internal ids.
  const nameOf = (id: string | number) => {
    const key = String(id);
    if (key.startsWith(COLUMN)) return statuses.find((s) => `${COLUMN}${s.id}` === key)?.name ?? "a column";
    return byId.get(key)?.title ?? "a task";
  };
  const placeOf = (id: string | number) => {
    const column = columnOf(String(id));
    return statuses.find((s) => s.id === column)?.name ?? nameOf(id);
  };
  const announcements = {
    onDragStart: ({ active }: { active: { id: string | number } }) =>
      `Picked up ${nameOf(active.id)}. Use the arrow keys to move it, Space to drop, Escape to cancel.`,
    onDragOver: ({
      active,
      over,
    }: {
      active: { id: string | number };
      over: { id: string | number } | null;
    }) =>
      over
        ? `${nameOf(active.id)} is over ${placeOf(over.id)}.`
        : `${nameOf(active.id)} is no longer over a column.`,
    onDragEnd: ({
      active,
      over,
    }: {
      active: { id: string | number };
      over: { id: string | number } | null;
    }) =>
      over ? `${nameOf(active.id)} dropped in ${placeOf(over.id)}.` : `${nameOf(active.id)} was dropped.`,
    onDragCancel: ({ active }: { active: { id: string | number } }) =>
      `Moving ${nameOf(active.id)} was cancelled.`,
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setStartColumns(columns);
    setError(null);
  };

  // Moving over another column: show the card there right away.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = columnOf(String(active.id));
    const to = columnOf(String(over.id));
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const target = cols[to]!.filter((id) => id !== active.id);
      const overIndex = target.indexOf(String(over.id));
      const index = overIndex >= 0 ? overIndex : target.length;
      return {
        ...cols,
        [from]: cols[from]!.filter((id) => id !== active.id),
        [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
      };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const before = startColumns;
    setActiveId(null);
    setStartColumns(null);
    if (!over || !before) {
      if (before) setColumns(() => before);
      return;
    }
    const to = columnOf(id);
    if (!to) return;
    let final = columns;
    const overColumn = columnOf(String(over.id));
    if (overColumn === to && !String(over.id).startsWith(COLUMN)) {
      const list = columns[to]!;
      final = { ...columns, [to]: arrayMove(list, list.indexOf(id), list.indexOf(String(over.id))) };
      setColumns(() => final);
    }
    const from = columnOf(id, before)!;
    const list = final[to]!;
    const index = list.indexOf(id);
    const unchanged = from === to && before[from]!.indexOf(id) === index;
    if (unchanged) return;

    const task = byId.get(id)!;
    const target = statuses.find((s) => s.id === to);
    const current = statuses.find((s) => s.id === task.statusId);
    if (from !== to && !confirmCloseWhileBlocked(task.openBlockers, target, current)) {
      setColumns(() => before);
      return;
    }
    startTransition(async () => {
      const result = await moveTaskAction(workspaceSlug, id, task.version, {
        statusId: from !== to ? to : undefined,
        afterTaskId: list[index - 1] ?? null,
        beforeTaskId: list[index + 1] ?? null,
      });
      if (result && !result.ok) {
        setColumns(() => before);
        setError(result.message);
      }
    });
  };

  const active = activeId ? byId.get(activeId) : undefined;

  return (
    <div className="grid gap-3">
      {error ? (
        <p role="alert" className="text-destructive text-[13px]">
          {error}
        </p>
      ) : null}
      <DndContext
        id={dndId}
        sensors={sensors}
        accessibility={{ announcements }}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          if (startColumns) setColumns(() => startColumns);
          setActiveId(null);
          setStartColumns(null);
        }}
      >
        <div className="flex items-start gap-3 overflow-x-auto pb-4" role="list" aria-label="Board columns">
          {statuses.map((status) => (
            <BoardColumn
              key={status.id}
              status={status}
              taskIds={columns[status.id] ?? []}
              byId={byId}
              workspaceSlug={workspaceSlug}
              listId={listId}
              canEdit={canEdit}
              canCreate={canCreate}
              today={today}
            />
          ))}
        </div>
        <DragOverlay>
          {active ? <CardBody task={active} workspaceSlug={workspaceSlug} today={today} lifted /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function BoardColumn({
  status,
  taskIds,
  byId,
  workspaceSlug,
  listId,
  canEdit,
  canCreate,
  today,
}: {
  status: StatusOption;
  taskIds: string[];
  byId: Map<string, BoardTask>;
  workspaceSlug: string;
  listId: string;
  canEdit: boolean;
  canCreate: boolean;
  today: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN}${status.id}`, disabled: !canEdit });
  return (
    <section
      role="listitem"
      aria-label={`${status.name}, ${taskIds.length} ${taskIds.length === 1 ? "task" : "tasks"}`}
      className="bg-surface-muted/50 flex w-72 shrink-0 flex-col rounded-lg border"
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <span
          className="inline-flex h-6 items-center rounded-md px-2 text-[11px] font-semibold tracking-wide text-white uppercase"
          style={{ background: status.color }}
        >
          {status.name}
        </span>
        <span className="text-muted-foreground text-[12px] tabular-nums">{taskIds.length}</span>
      </header>
      <SortableContext id={status.id} items={taskIds} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={cn(
            "grid min-h-16 content-start gap-2 px-2 pb-2",
            isOver && "bg-accent-soft/40 rounded-md",
          )}
        >
          {taskIds.map((id) => {
            const task = byId.get(id);
            return task ? (
              <BoardCard key={id} task={task} workspaceSlug={workspaceSlug} canEdit={canEdit} today={today} />
            ) : null;
          })}
          {taskIds.length === 0 ? (
            <li className="text-muted-foreground px-1 py-3 text-center text-[12px]">No tasks</li>
          ) : null}
        </ul>
      </SortableContext>
      {canCreate ? (
        <div className="border-t">
          <QuickAddTask
            workspaceSlug={workspaceSlug}
            listId={listId}
            statusId={status.id}
            statusName={status.name}
          />
        </div>
      ) : null}
    </section>
  );
}

function BoardCard({
  task,
  workspaceSlug,
  canEdit,
  today,
}: {
  task: BoardTask;
  workspaceSlug: string;
  canEdit: boolean;
  today: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canEdit,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
    >
      <TaskContextMenu
        target={{
          workspaceSlug,
          taskId: task.id,
          taskRef: task.ref,
          title: task.title,
          canArchive: task.canArchive,
          canDelete: task.canDelete,
        }}
      >
        {/* The drag handle is the whole card (a button for keyboard and screen readers). */}
        <div
          {...attributes}
          {...listeners}
          aria-roledescription={canEdit ? "draggable task" : undefined}
          aria-label={`${task.ref} ${task.title}`}
        >
          <CardBody task={task} workspaceSlug={workspaceSlug} today={today} />
        </div>
      </TaskContextMenu>
    </li>
  );
}

function CardBody({
  task,
  workspaceSlug,
  today,
  lifted = false,
}: {
  task: BoardTask;
  workspaceSlug: string;
  today: string;
  lifted?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-surface grid cursor-grab gap-2 rounded-md border p-3 text-left shadow-xs active:cursor-grabbing",
        lifted && "rotate-1 shadow-lg",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground font-mono text-[10px] leading-5">{task.ref}</span>
        {task.openBlockers > 0 ? <BlockedBadge count={task.openBlockers} /> : null}
      </div>
      <Link
        href={`/w/${workspaceSlug}/t/${task.ref}`}
        className="text-[13px] leading-snug font-medium hover:underline hover:underline-offset-4"
        draggable={false}
      >
        {task.title}
      </Link>
      <TagList tags={task.tags} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AssigneeStack people={task.assignees} />
        <PriorityLabel priority={task.priority} />
        <DueDateLabel dueDate={task.dueDate} completed={task.completed} today={today} />
        {task.subtaskCount > 0 ? (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-[12px]">
            <GitBranch className="size-3" aria-hidden /> {task.subtaskCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}
