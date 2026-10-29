"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One status group in the list view. Every group can be collapsed; finished statuses
 * (done, cancelled) start collapsed, the rest start open.
 */
export function StatusGroup({
  id,
  name,
  color,
  count,
  defaultOpen,
  children,
}: {
  id: string;
  name: string;
  color: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section aria-labelledby={`status-${id}`} className="grid gap-1">
      <h2 id={`status-${id}`} className="flex items-center gap-2 text-[12px]">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
          onClick={() => setOpen((o) => !o)}
          className="text-muted-foreground hover:text-foreground grid size-5 place-items-center rounded-sm hover:bg-black/5 dark:hover:bg-white/10"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
        </button>
        <span
          className="inline-flex h-6 items-center rounded-md px-2 font-semibold tracking-wide text-white uppercase"
          style={{ background: color }}
        >
          {name}
        </span>
        <span className="text-muted-foreground tabular-nums">{count}</span>
      </h2>
      {open ? children : null}
    </section>
  );
}
