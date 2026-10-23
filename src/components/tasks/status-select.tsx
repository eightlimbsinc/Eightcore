"use client";
import { useState, useTransition } from "react";
import { setTaskStatusAction } from "@/modules/tasks/actions";
import { NativeSelect } from "@/components/ui/input";

/** Changes a task's status straight from a list row. */
export function StatusSelect({
  workspaceSlug,
  taskId,
  version,
  statusId,
  statuses,
  label,
}: {
  workspaceSlug: string;
  taskId: string;
  version: number;
  statusId: string;
  statuses: { id: string; name: string }[];
  label: string;
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
