"use client";
import { useOptimistic, useState, useTransition } from "react";
import { Popover } from "radix-ui";
import { Check, Search, UserPlus } from "lucide-react";
import { setTaskAssigneesAction } from "@/modules/tasks/actions";
import { cn, initials } from "@/lib/utils";

export interface Person {
  userId: string;
  name: string;
  email?: string;
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "border-surface bg-accent-soft text-accent-foreground grid size-6 shrink-0 place-items-center rounded-full border-2 text-[10px] font-semibold",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Click the avatars (or the add-person icon) to pick assignees. Search by name or email;
 * "Me" comes first. Each click saves straight away.
 */
export function AssigneePicker({
  workspaceSlug,
  taskId,
  people,
  assignedIds,
  currentUserId,
  canEdit,
  label,
  variant = "compact",
}: {
  workspaceSlug: string;
  taskId: string;
  /** Everyone who may be assigned in this project. */
  people: Person[];
  assignedIds: string[];
  currentUserId: string;
  canEdit: boolean;
  /** Accessible name of the trigger, e.g. "Assignees of WEB-1". */
  label: string;
  /** "compact": avatars only (list rows). "field": avatars with names (task page). */
  variant?: "compact" | "field";
}) {
  const [selected, setSelected] = useOptimistic(assignedIds);
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(people.map((p) => [p.userId, p]));
  const chosen = selected.map((id) => byId.get(id)).filter((p): p is Person => Boolean(p));

  const q = query.trim().toLowerCase();
  const matches = people
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q))
    .sort((a, b) => (a.userId === currentUserId ? -1 : b.userId === currentUserId ? 1 : 0));

  function toggle(userId: string) {
    const next = selected.includes(userId) ? selected.filter((id) => id !== userId) : [...selected, userId];
    startTransition(async () => {
      setSelected(next);
      const result = await setTaskAssigneesAction(workspaceSlug, taskId, next);
      setError(result && !result.ok ? result.message : null);
    });
  }

  const face = chosen.length ? (
    <span className="flex items-center gap-2">
      <span className="flex -space-x-1.5">
        {chosen.slice(0, 3).map((p) => (
          <Avatar key={p.userId} name={p.name} />
        ))}
        {chosen.length > 3 ? (
          <span className="border-surface bg-surface-muted grid size-6 place-items-center rounded-full border-2 text-[10px]">
            +{chosen.length - 3}
          </span>
        ) : null}
      </span>
      {variant === "field" ? (
        <span className="truncate text-[13px]">{chosen.map((p) => p.name).join(", ")}</span>
      ) : null}
    </span>
  ) : (
    <span className="text-muted-foreground flex items-center gap-2 text-[13px]">
      <UserPlus className="size-4" aria-hidden />
      {variant === "field" ? "Empty" : null}
    </span>
  );

  const summary = chosen.length ? chosen.map((p) => p.name).join(", ") : "nobody";
  if (!canEdit) {
    return (
      <span aria-label={`${label}: ${summary}`} title={summary}>
        {face}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col">
      <Popover.Root onOpenChange={(open) => !open && setQuery("")}>
        <Popover.Trigger
          aria-label={`${label}: ${summary}`}
          title={chosen.length ? summary : "Assign someone"}
          className={cn(
            "flex min-h-7 items-center rounded-md px-1 text-left hover:bg-black/5 dark:hover:bg-white/10",
            variant === "field" && "border-input bg-surface w-full border px-2 py-1",
          )}
        >
          {face}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className="bg-surface text-foreground z-50 w-72 rounded-lg border p-2 shadow-lg"
          >
            <label className="border-input focus-within:border-accent flex items-center gap-2 rounded-md border px-2">
              <Search className="text-muted-foreground size-3.5" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                aria-label="Search people"
                className="h-8 w-full bg-transparent text-[13px] outline-none"
              />
            </label>
            <p className="text-muted-foreground px-1 pt-2 pb-1 text-[11px] font-medium tracking-wide uppercase">
              People
            </p>
            <ul
              role="listbox"
              aria-label="People"
              aria-multiselectable
              className="grid max-h-64 gap-0.5 overflow-y-auto"
            >
              {matches.map((p) => {
                const on = selected.includes(p.userId);
                return (
                  <li key={p.userId} role="option" aria-selected={on}>
                    <button
                      type="button"
                      onClick={() => toggle(p.userId)}
                      className="hover:bg-surface-muted flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
                    >
                      <Avatar name={p.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {p.userId === currentUserId ? "Me" : p.name}
                        </span>
                        {p.email ? (
                          <span className="text-muted-foreground block truncate text-[11px]">{p.email}</span>
                        ) : null}
                      </span>
                      {on ? <Check className="size-4" aria-hidden /> : null}
                    </button>
                  </li>
                );
              })}
              {matches.length === 0 ? (
                <li className="text-muted-foreground px-2 py-2 text-[13px]">
                  Nobody matches. People must be in the workspace and able to see this project.
                </li>
              ) : null}
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error ? <span className="text-destructive mt-1 max-w-56 text-[11px]">{error}</span> : null}
    </span>
  );
}
