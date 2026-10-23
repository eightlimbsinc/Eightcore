"use client";
import { useState, useTransition } from "react";
import { setTaskStatusAction } from "@/modules/tasks/actions";
import { isClosedCategory, type StatusCategory } from "@/modules/lists/templates";
import { NativeSelect } from "@/components/ui/input";

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

/** Changes a task's status straight from a list row. */
export function StatusSelect({
  workspaceSlug,
  taskId,
  version,
  statusId,
  statuses,
  label,
  openBlockers = 0,
}: {
  workspaceSlug: string;
  taskId: string;
  version: number;
  statusId: string;
  statuses: { id: string; name: string; category: StatusCategory }[];
  label: string;
  openBlockers?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <NativeSelect
        aria-label={label}
        value={statusId}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const ok = confirmCloseWhileBlocked(
            openBlockers,
            statuses.find((s) => s.id === next),
            statuses.find((s) => s.id === statusId),
          );
          if (!ok) {
            e.target.value = statusId;
            return;
          }
          startTransition(async () => {
            const result = await setTaskStatusAction(workspaceSlug, taskId, version, next);
            setError(result && !result.ok ? result.message : null);
          });
        }}
        className="h-7 max-w-44 text-[12px]"
      >
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </NativeSelect>
      {error ? <span className="text-destructive mt-1 max-w-56 text-[11px]">{error}</span> : null}
    </span>
  );
}
