"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskContextMenu, TaskMenuButton, type TaskMenuTarget } from "./task-row-menu";

/**
 * One list row plus its subtasks. Rows with subtasks get an arrow that shows or hides them;
 * the cells and the subtask rows themselves are rendered on the server.
 */
export function ExpandableTask({
  gridClass,
  name,
  subtaskCount,
  depth = 0,
  defaultOpen = false,
  menu,
  cells,
  children,
}: {
  gridClass: string;
  /** For the arrow's label, e.g. "WEB-1 Homepage hero". */
  name: string;
  subtaskCount: number;
  /** Nesting level: subtasks are indented under their parent. */
  depth?: number;
  /** Start expanded (the list view's "Subtasks: Expanded"). */
  defaultOpen?: boolean;
  /** Right-click / "⋯" task actions. */
  menu: TaskMenuTarget;
  cells: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expandable = subtaskCount > 0 && Boolean(children);
  return (
    <li>
      <TaskContextMenu target={menu}>
        <div
          className={cn(
            gridClass,
            "group hover:bg-surface-muted/50 relative min-h-10 items-center gap-x-2 py-1 pr-9 pl-2",
          )}
          style={depth ? { paddingLeft: `${0.5 + depth * 1.5}rem` } : undefined}
        >
          {expandable ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? "Hide" : "Show"} subtasks of ${name}`}
              onClick={() => setOpen((o) => !o)}
              className="text-muted-foreground hover:text-foreground grid size-5 place-items-center rounded-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", open && "rotate-90")}
                aria-hidden
              />
            </button>
          ) : (
            <span />
          )}
          {cells}
          <span className="absolute top-1/2 right-2 -translate-y-1/2">
            <TaskMenuButton target={menu} />
          </span>
        </div>
      </TaskContextMenu>
      {expandable && open ? <ul className="divide-y border-t">{children}</ul> : null}
    </li>
  );
}
