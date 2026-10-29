"use client";
import { useState } from "react";
import { ChevronsLeft, ChevronsRight, Link2, MessagesSquare, Paperclip, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = { activity: MessagesSquare, relations: Link2, files: Paperclip } satisfies Record<
  string,
  LucideIcon
>;

export interface SidePanelTab {
  key: keyof typeof ICONS;
  label: string;
  /** Shown as a small number on the icon (0 hides it). */
  count: number;
  content: React.ReactNode;
}

/**
 * The task's right-hand side: an icon strip (Activity, Relationships, Files) and the chosen
 * panel. Always opens expanded; » collapses it to the strip, and any icon opens it again.
 */
export function TaskSidePanel({ tabs }: { tabs: SidePanelTab[] }) {
  const [active, setActive] = useState<SidePanelTab["key"]>(tabs[0]?.key ?? "activity");
  const [open, setOpen] = useState(true);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className="flex min-h-0 border-t lg:border-t-0 lg:border-l">
      <nav
        aria-label="Task panels"
        className="bg-surface-muted/40 flex w-11 shrink-0 flex-col items-center gap-1 border-r py-2"
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Collapse side panel" : "Expand side panel"}
          title={open ? "Collapse" : "Expand"}
          className="text-muted-foreground hover:text-foreground hover:bg-surface-muted mb-1 grid size-8 place-items-center rounded-md"
        >
          {open ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
        {tabs.map((tab) => {
          const Icon = ICONS[tab.key];
          const selected = open && tab.key === current?.key;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={selected}
              aria-label={`${tab.label}${tab.count ? ` (${tab.count})` : ""}`}
              title={tab.label}
              onClick={() => {
                setActive(tab.key);
                setOpen(true);
              }}
              className={cn(
                "text-muted-foreground hover:text-foreground relative grid size-8 place-items-center rounded-md",
                selected ? "neu-tile neu-inset text-foreground" : "hover:bg-surface-muted",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {tab.count ? (
                <span className="bg-accent absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-center text-[9px] leading-4 font-semibold text-[#17171a]">
                  {tab.count > 99 ? "99+" : tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      {open && current ? (
        <section
          aria-label={current.label}
          className="flex min-h-[28rem] w-full min-w-0 flex-col lg:min-h-0 lg:w-[26rem]"
        >
          <h2 className="border-b px-4 py-3 text-[13px] font-semibold">{current.label}</h2>
          <div className="flex min-h-0 flex-1 flex-col">{current.content}</div>
        </section>
      ) : null}
    </div>
  );
}
