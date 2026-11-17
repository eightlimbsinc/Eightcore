"use client";
import { useRef, useTransition } from "react";
import { moveTaskAction } from "@/modules/tasks/actions";
import { notify } from "@/components/app/toast";
import { needsComment, useCommentPrompt } from "./comment-prompt";
import { confirmCloseWhileBlocked, type StatusOption } from "./status-menu";
import { draggedTask, droppedTask, endTaskDrag } from "./task-drag";

type Target = { kind: "row"; el: HTMLElement; after: boolean } | { kind: "group"; el: HTMLElement };

/**
 * Drag and drop in the list view: drop a task between two others to reorder it (in another
 * status group it takes that status too), or on a group's header to just change its status.
 * Rows are server-rendered, so targets are found from the DOM (data-drag-task, data-drop-status).
 */
export function ListTaskDnd({
  workspaceSlug,
  listId,
  statuses,
  children,
}: {
  workspaceSlug: string;
  listId: string;
  statuses: StatusOption[];
  children: React.ReactNode;
}) {
  const marked = useRef<HTMLElement | null>(null);
  const [, startTransition] = useTransition();
  const { ask, prompt } = useCommentPrompt();

  const mark = (el: HTMLElement | null, value?: string) => {
    if (marked.current && marked.current !== el) delete marked.current.dataset.drop;
    marked.current = el;
    if (el && value) el.dataset.drop = value;
  };

  const targetOf = (e: React.DragEvent): Target | null => {
    const node = e.target instanceof Element ? e.target : null;
    const row = node?.closest<HTMLElement>('[data-drag-task][data-depth="0"]');
    if (row) {
      const r = row.getBoundingClientRect();
      return { kind: "row", el: row, after: e.clientY > r.top + r.height / 2 };
    }
    const group = node?.closest<HTMLElement>("[data-drop-status]");
    return group ? { kind: "group", el: group } : null;
  };

  const onDragOver = (e: React.DragEvent) => {
    const task = draggedTask(e);
    if (!task || task.subtask || task.listId !== listId) return;
    const target = targetOf(e);
    if (!target) return mark(null);
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (target.kind === "row") {
      if (target.el.dataset.dragTask === task.id) return mark(null);
      mark(target.el, target.after ? "after" : "before");
    } else mark(target.el, "in");
  };

  const onDrop = (e: React.DragEvent) => {
    const task = droppedTask(e);
    const target = targetOf(e);
    mark(null);
    if (!task || task.subtask || task.listId !== listId || !target) return;
    e.preventDefault();
    endTaskDrag();
    const root = e.currentTarget as HTMLElement;
    const source = root.querySelector<HTMLElement>(`[data-drag-task="${task.id}"]`);
    const fromStatus = source?.dataset.status;
    const group = target.kind === "group" ? target.el : target.el.closest<HTMLElement>("[data-drop-status]");
    const toStatus = group?.dataset.dropStatus;
    if (!group || !toStatus) return;

    const rowIds = (g: HTMLElement) =>
      [...g.querySelectorAll<HTMLElement>('[data-drag-task][data-depth="0"]')].map(
        (r) => r.dataset.dragTask!,
      );
    let afterTaskId: string | null = null;
    let beforeTaskId: string | null = null;
    if (target.kind === "row") {
      const ids = rowIds(group).filter((id) => id !== task.id);
      const at = ids.indexOf(target.el.dataset.dragTask!) + (target.after ? 1 : 0);
      afterTaskId = ids[at - 1] ?? null;
      beforeTaskId = ids[at] ?? null;
      if (fromStatus === toStatus) {
        const now = rowIds(group);
        const i = now.indexOf(task.id);
        if ((now[i - 1] ?? null) === afterTaskId && (now[i + 1] ?? null) === beforeTaskId) return;
      }
    } else if (fromStatus === toStatus) return;

    const next = statuses.find((s) => s.id === toStatus);
    const current = statuses.find((s) => s.id === fromStatus);
    if (
      fromStatus !== toStatus &&
      !confirmCloseWhileBlocked(Number(source?.dataset.blockers ?? 0), next, current)
    )
      return;
    if (source) source.dataset.pending = "true";
    startTransition(async () => {
      const move = { statusId: fromStatus !== toStatus ? toStatus : undefined, afterTaskId, beforeTaskId };
      let result = await moveTaskAction(workspaceSlug, task.id, task.version, move);
      if (needsComment(result) && next) {
        const comment = await ask(next.name, result && !result.ok ? result.message : "");
        if (comment === null) {
          if (source) delete source.dataset.pending;
          return;
        }
        result = await moveTaskAction(workspaceSlug, task.id, task.version, { ...move, comment });
      }
      if (source) delete source.dataset.pending;
      if (result && !result.ok) notify(result.message);
    });
  };

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) mark(null);
      }}
    >
      {prompt}
      {children}
    </div>
  );
}
