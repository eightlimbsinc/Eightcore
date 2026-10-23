import { CalendarDays, Flag } from "lucide-react";
import { PRIORITY_META, dueState, formatDate, type Priority } from "@/lib/task-format";
import { cn, initials } from "@/lib/utils";

export function StatusDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ background: color }}
    />
  );
}

export function StatusPill({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[12px] whitespace-nowrap">
      <StatusDot color={color} className="size-2" />
      {name}
    </span>
  );
}

export function PriorityLabel({ priority, showNone = false }: { priority: Priority; showNone?: boolean }) {
  if (priority === "none" && !showNone) return null;
  const meta = PRIORITY_META[priority];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px] whitespace-nowrap", meta.tone)}>
      <Flag className="size-3" aria-hidden />
      {meta.label}
    </span>
  );
}

export function DueDateLabel({ dueDate, completed }: { dueDate: string | null; completed: boolean }) {
  if (!dueDate) return null;
  const state = dueState(dueDate, completed);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[12px] whitespace-nowrap tabular-nums",
        state === "overdue" && "text-destructive font-medium",
        state === "today" && "text-accent-foreground font-medium",
        (state === "upcoming" || state === "done") && "text-muted-foreground",
      )}
      title={state === "overdue" ? "Overdue" : state === "today" ? "Due today" : "Due date"}
    >
      <CalendarDays className="size-3" aria-hidden />
      {state === "today" ? "Today" : formatDate(dueDate)}
    </span>
  );
}

export function AssigneeStack({
  people,
  max = 3,
}: {
  people: { userId: string; name: string }[];
  max?: number;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  return (
    <span className="flex -space-x-1.5" aria-label={`Assigned to ${people.map((p) => p.name).join(", ")}`}>
      {shown.map((p) => (
        <span
          key={p.userId}
          title={p.name}
          className="border-surface bg-accent-soft text-accent-foreground grid size-6 place-items-center rounded-full border-2 text-[10px] font-semibold"
        >
          {initials(p.name)}
        </span>
      ))}
      {people.length > max ? (
        <span className="border-surface bg-surface-muted grid size-6 place-items-center rounded-full border-2 text-[10px]">
          +{people.length - max}
        </span>
      ) : null}
    </span>
  );
}

export function TagChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex max-w-40 items-center rounded-sm px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ background: `${color}26`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}
    >
      <span className="truncate">{name}</span>
    </span>
  );
}

export function TagList({ tags }: { tags: { id: string; name: string; color: string }[] }) {
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label="Tags">
      {tags.map((t) => (
        <TagChip key={t.id} name={t.name} color={t.color} />
      ))}
    </span>
  );
}
