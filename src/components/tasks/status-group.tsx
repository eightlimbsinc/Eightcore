"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** The address with `id` added to a comma-separated parameter (e.g. ?open=a,b). */
function withId(pathname: string, search: URLSearchParams, key: string, id: string) {
  const params = new URLSearchParams(search);
  const ids = new Set((params.get(key) ?? "").split(",").filter(Boolean));
  ids.add(id);
  params.set(key, [...ids].join(","));
  return `${pathname}?${params.toString()}`;
}

/**
 * One status group in the list view. Every group can be collapsed; finished statuses
 * (done, cancelled) start collapsed and their tasks load when first opened. Long groups show
 * their first tasks, with "Show all" for the rest.
 */
export function StatusGroup({
  id,
  name,
  color,
  count,
  defaultOpen,
  loaded,
  hiddenCount,
  children,
}: {
  id: string;
  name: string;
  color: string;
  count: number;
  defaultOpen: boolean;
  /** The server sent this group's rows (false for groups that start collapsed). */
  loaded: boolean;
  /** Tasks not shown yet (behind "Show all"). */
  hiddenCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [loading, startLoading] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const toggle = () => {
    if (!open && !loaded) {
      // First time open: fetch this group's tasks.
      startLoading(() => router.replace(withId(pathname, search, "open", id), { scroll: false }));
    }
    setOpen((o) => !o);
  };
  return (
    <section aria-labelledby={`status-${id}`} className="grid gap-1" aria-busy={loading || undefined}>
      <h2 id={`status-${id}`} className="flex items-center gap-2 text-[12px]">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
          onClick={toggle}
          className="text-muted-foreground hover:text-foreground grid size-5 place-items-center rounded-sm hover:bg-black/5 dark:hover:bg-white/10"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
        </button>
        <span
          className="neu-status inline-flex h-6 items-center rounded-md px-2 font-semibold tracking-wide uppercase"
          style={{ "--status": color } as React.CSSProperties}
        >
          {name}
        </span>
        <span className="text-muted-foreground tabular-nums">{count}</span>
      </h2>
      {open ? (
        loaded ? (
          <>
            {children}
            {hiddenCount > 0 ? (
              <Link
                href={withId(pathname, search, "all", id)}
                scroll={false}
                className="text-muted-foreground hover:text-foreground justify-self-start px-2 py-1 text-[13px]"
              >
                Show all {count} tasks ({hiddenCount} more)
              </Link>
            ) : null}
          </>
        ) : (
          <p role="status" className="text-muted-foreground px-2 py-2 text-[13px]">
            Loading {count} {count === 1 ? "task" : "tasks"}…
          </p>
        )
      ) : null}
    </section>
  );
}
