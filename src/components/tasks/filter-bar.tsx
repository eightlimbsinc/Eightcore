"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { Check, ListFilter, Search, X } from "lucide-react";
import {
  DUE_FILTERS,
  DUE_FILTER_LABELS,
  filterQuery,
  isFiltering,
  type TaskFilter,
} from "@/modules/tasks/filters";
import { PRIORITY_META } from "@/lib/task-format";
import type { TaskPriority } from "@/modules/tasks/validators";
import { cn } from "@/lib/utils";

const PRIORITIES: TaskPriority[] = ["urgent", "high", "normal", "low", "none"];

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

function Option({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "hover:bg-surface-muted flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px]",
        on && "font-medium",
      )}
    >
      <span
        className={cn(
          "grid size-4 place-items-center rounded-sm border",
          on && "bg-accent border-accent text-[#17171a]",
        )}
      >
        {on ? <Check className="size-3" aria-hidden /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-0.5" role="group" aria-label={title}>
      <p className="text-muted-foreground px-2 pt-1 text-[11px] font-medium tracking-wide uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

/**
 * Search box + "Filter" menu. Every change updates the address bar (so a filtered view can
 * be shared or bookmarked); `defaults` is the saved view's filter, `extraQuery` other
 * parameters to keep (e.g. the list's view options).
 */
export function FilterBar({
  path,
  filter,
  defaults = {},
  extraQuery = "",
  people,
  tags,
  showState = true,
}: {
  path: string;
  filter: TaskFilter;
  defaults?: Partial<TaskFilter>;
  extraQuery?: string;
  people: { userId: string; name: string }[];
  tags: string[];
  showState?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(filter.q);
  const [seenQ, setSeenQ] = useState(filter.q);
  if (filter.q !== seenQ) {
    // The address bar changed (back button, clear): show its search text.
    setSeenQ(filter.q);
    setQ(filter.q);
  }

  // The search text last sent to the address bar (so the typing timer never repeats it).
  const sentQ = useRef(filter.q);
  const go = (next: TaskFilter) => {
    sentQ.current = next.q;
    const params = new URLSearchParams(extraQuery);
    for (const [k, v] of filterQuery(next, defaults)) params.set(k, v);
    const query = params.toString();
    startTransition(() => router.replace(`${path}${query ? `?${query}` : ""}`, { scroll: false }));
  };

  // Search as you type, after a short pause. The timer reads the filters current when it
  // fires (not when it was set), so a late update can't undo a navigation made meanwhile.
  const latest = useRef({ filter, go });
  useEffect(() => {
    latest.current = { filter, go };
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      const { filter: now, go: navigate } = latest.current;
      if (q.trim() !== now.q && q.trim() !== sentQ.current) navigate({ ...now, q: q.trim() });
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const count =
    filter.assignees.length +
    filter.priorities.length +
    filter.due.length +
    filter.tags.length +
    (filter.state !== "all" ? 1 : 0) +
    (filter.blocked ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending || undefined}>
      <label className="border-input bg-surface focus-within:border-accent flex h-9 min-w-56 flex-1 items-center gap-2 rounded-md border px-3 sm:max-w-80">
        <Search className="text-muted-foreground size-4" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go({ ...filter, q: q.trim() });
          }}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="h-full w-full bg-transparent text-sm outline-none"
        />
        {q ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQ("")}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </label>

      <Popover.Root>
        <Popover.Trigger
          aria-label={count ? `Filters (${count} on)` : "Filters"}
          className={cn(
            "border-input bg-surface hover:bg-surface-muted inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm",
            count > 0 && "border-accent",
          )}
        >
          <ListFilter className="size-4" aria-hidden /> Filter
          {count ? (
            <span className="bg-accent rounded-full px-1.5 text-[11px] font-semibold text-[#17171a]">
              {count}
            </span>
          ) : null}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className="bg-surface text-foreground z-50 grid max-h-[70vh] w-[min(40rem,calc(100vw-2rem))] grid-cols-1 gap-3 overflow-y-auto rounded-lg border p-3 shadow-lg sm:grid-cols-3"
          >
            <Section title="Assignee">
              <Option
                on={filter.assignees.includes("me")}
                label="Me"
                onClick={() => go({ ...filter, assignees: toggle(filter.assignees, "me") })}
              />
              <Option
                on={filter.assignees.includes("none")}
                label="Unassigned"
                onClick={() => go({ ...filter, assignees: toggle(filter.assignees, "none") })}
              />
              {people.map((p) => (
                <Option
                  key={p.userId}
                  on={filter.assignees.includes(p.userId)}
                  label={p.name}
                  onClick={() => go({ ...filter, assignees: toggle(filter.assignees, p.userId) })}
                />
              ))}
            </Section>
            <div className="grid content-start gap-3">
              <Section title="Due date">
                {DUE_FILTERS.map((d) => (
                  <Option
                    key={d}
                    on={filter.due.includes(d)}
                    label={DUE_FILTER_LABELS[d]}
                    onClick={() => go({ ...filter, due: toggle(filter.due, d) })}
                  />
                ))}
              </Section>
              <Section title="Priority">
                {PRIORITIES.map((p) => (
                  <Option
                    key={p}
                    on={filter.priorities.includes(p)}
                    label={PRIORITY_META[p].label}
                    onClick={() => go({ ...filter, priorities: toggle(filter.priorities, p) })}
                  />
                ))}
              </Section>
            </div>
            <div className="grid content-start gap-3">
              {showState ? (
                <Section title="Status">
                  {(["open", "closed", "all"] as const).map((s) => (
                    <Option
                      key={s}
                      on={filter.state === s}
                      label={{ open: "Open tasks", closed: "Closed tasks", all: "Open and closed" }[s]}
                      onClick={() => go({ ...filter, state: s })}
                    />
                  ))}
                </Section>
              ) : null}
              <Section title="Other">
                <Option
                  on={filter.blocked}
                  label="Blocked only"
                  onClick={() => go({ ...filter, blocked: !filter.blocked })}
                />
              </Section>
              {tags.length ? (
                <Section title="Tags">
                  {tags.map((t) => (
                    <Option
                      key={t}
                      on={filter.tags.some((x) => x.toLowerCase() === t.toLowerCase())}
                      label={t}
                      onClick={() => go({ ...filter, tags: toggle(filter.tags, t) })}
                    />
                  ))}
                </Section>
              ) : null}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {isFiltering(filter) ? (
        <button
          type="button"
          onClick={() => {
            setQ("");
            go({ assignees: [], priorities: [], due: [], tags: [], q: "", state: "all", blocked: false });
          }}
          className="text-muted-foreground hover:text-foreground inline-flex h-9 items-center gap-1 px-2 text-[13px]"
        >
          <X className="size-3.5" aria-hidden /> Clear filters
        </button>
      ) : null}
    </div>
  );
}
