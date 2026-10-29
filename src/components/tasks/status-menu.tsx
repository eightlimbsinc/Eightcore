"use client";
import { useState, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import { setTaskStatusAction } from "@/modules/tasks/actions";
import { isClosedCategory, type StatusCategory } from "@/modules/lists/templates";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Asks before closing a task that still waits on unfinished tasks. */
export function confirmCloseWhileBlocked(
  openBlockers: number,
  next: { category: StatusCategory } | undefined,
  current: { category: StatusCategory } | undefined,
): boolean {
  if (!openBlockers || !next || !isClosedCategory(next.category)) return true;
  if (current && isClosedCategory(current.category)) return true;
  const what = openBlockers === 1 ? "an unfinished task" : `${openBlockers} unfinished tasks`;
  return confirm(`This task is still blocked by ${what}. Close it anyway?`);
}

export interface StatusOption {
  id: string;
  name: string;
  color: string;
  category: StatusCategory;
}

/** A small circle that shows what kind of status it is: dashed (not started), half (in progress), check (done). */
export function StatusIcon({
  status,
  className,
}: {
  status: Pick<StatusOption, "color" | "category">;
  className?: string;
}) {
  const { color, category } = status;
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)} aria-hidden>
      {category === "done" || category === "closed" ? (
        <>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path
            d="M4.8 8.2l2.1 2.1 4.3-4.4"
            fill="none"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      ) : category === "cancelled" ? (
        <>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="M5.5 5.5l5 5m0-5l-5 5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.25"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeDasharray={category === "backlog" || category === "unstarted" ? "2.2 1.8" : undefined}
          />
          {category === "active" || category === "review" ? (
            <path d="M8 3.75a4.25 4.25 0 0 1 0 8.5z" fill={color} />
          ) : null}
        </>
      )}
    </svg>
  );
}

/**
 * Status picker. "icon" is the circle at the start of a list row; "pill" is the coloured
 * button at the top of a task. Asks first when closing a task that is still blocked.
 */
export function StatusMenu({
  workspaceSlug,
  taskId,
  version,
  statusId,
  statuses,
  label,
  variant = "icon",
  openBlockers = 0,
  canEdit = true,
}: {
  workspaceSlug: string;
  taskId: string;
  version: number;
  statusId: string;
  statuses: StatusOption[];
  label: string;
  variant?: "icon" | "pill";
  openBlockers?: number;
  canEdit?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = statuses.find((s) => s.id === statusId);
  if (!current) return null;

  const face =
    variant === "pill" ? (
      <span
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold tracking-wide text-white uppercase"
        style={{ background: current.color }}
      >
        {current.name}
        {canEdit ? <ChevronDown className="size-3.5" aria-hidden /> : null}
      </span>
    ) : (
      <StatusIcon status={current} />
    );

  if (!canEdit) {
    return (
      <span aria-label={`${label}: ${current.name}`} title={current.name}>
        {face}
      </span>
    );
  }

  return (
    <span className="relative inline-flex">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${label}: ${current.name}`}
          title={variant === "icon" ? `${current.name} · click to change` : undefined}
          disabled={pending}
          className={cn(
            "rounded-md disabled:opacity-60",
            variant === "icon" && "grid size-6 place-items-center hover:bg-black/5 dark:hover:bg-white/10",
          )}
        >
          {face}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          <DropdownMenuLabel>Status</DropdownMenuLabel>
          {statuses.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onSelect={() => {
                if (s.id === statusId) return;
                if (!confirmCloseWhileBlocked(openBlockers, s, current)) return;
                startTransition(async () => {
                  const result = await setTaskStatusAction(workspaceSlug, taskId, version, s.id);
                  setError(result && !result.ok ? result.message : null);
                });
              }}
            >
              <StatusIcon status={s} />
              <span className="flex-1">{s.name}</span>
              {s.id === statusId ? <Check className="!text-foreground" aria-label="Current" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <span role="alert" className="text-destructive absolute top-full left-0 z-10 mt-1 w-56 text-[11px]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
