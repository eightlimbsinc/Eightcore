"use client";
// Dragging a task (HTML drag and drop): list rows and All tasks rows are drag sources; status
// groups and sidebar lists are drop targets. The payload travels in the drag event itself, so
// sources and targets don't need to share React state.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveTaskToListAction } from "@/modules/tasks/actions";
import { notify } from "@/components/app/toast";
import { cn } from "@/lib/utils";

export const TASK_DRAG_TYPE = "application/x-eightcore-task";

export interface TaskDragPayload {
  id: string;
  ref: string;
  version: number;
  projectId: string;
  listId: string;
  /** Subtasks move with their parent, so they can't be dropped on another list. */
  subtask?: boolean;
}

/** The task being dragged (drag events only expose data types until the drop). */
let current: TaskDragPayload | null = null;

export function startTaskDrag(e: React.DragEvent, payload: TaskDragPayload) {
  current = payload;
  e.dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify(payload));
  e.dataTransfer.setData("text/plain", payload.ref);
  e.dataTransfer.effectAllowed = "move";
}

export function endTaskDrag() {
  current = null;
}

/** The dragged task while a drag is over a target (null for other drags, e.g. files). */
export function draggedTask(e: React.DragEvent): TaskDragPayload | null {
  return e.dataTransfer.types.includes(TASK_DRAG_TYPE) ? current : null;
}

export function droppedTask(e: React.DragEvent): TaskDragPayload | null {
  try {
    const raw = e.dataTransfer.getData(TASK_DRAG_TYPE);
    return raw ? (JSON.parse(raw) as TaskDragPayload) : null;
  } catch {
    return null;
  }
}

/** A row of All tasks that can be dragged onto a list in the sidebar. */
export function DraggableTaskItem({
  task,
  className,
  children,
  ...rest
}: { task: TaskDragPayload; className?: string; children: React.ReactNode } & Omit<
  React.HTMLAttributes<HTMLLIElement>,
  "draggable" | "onDragStart" | "onDragEnd"
>) {
  const [dragging, setDragging] = useState(false);
  return (
    <li
      {...rest}
      draggable={!task.subtask}
      onDragStart={(e) => {
        startTaskDrag(e, task);
        setDragging(true);
      }}
      onDragEnd={() => {
        endTaskDrag();
        setDragging(false);
      }}
      className={cn(className, dragging && "opacity-40")}
    >
      {children}
    </li>
  );
}

/** Makes a sidebar list accept dropped tasks (from the same project): they move to that list. */
export function useListDropTarget(
  workspaceSlug: string,
  list: { id: string; name: string; projectId: string },
) {
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const accepts = (t: TaskDragPayload | null) =>
    Boolean(t && !t.subtask && t.projectId === list.projectId && t.listId !== list.id);
  return {
    over,
    pending,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!accepts(draggedTask(e))) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        const task = droppedTask(e);
        if (!accepts(task)) return;
        e.preventDefault();
        endTaskDrag();
        startTransition(async () => {
          const result = await moveTaskToListAction(workspaceSlug, task!.id, task!.version, list.id);
          if (result && !result.ok) notify(result.message);
          else {
            notify(`Moved ${task!.ref} to ${list.name}`);
            router.refresh();
          }
        });
      },
    },
  };
}
