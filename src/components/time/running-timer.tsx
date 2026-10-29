"use client";
import Link from "next/link";
import { useTransition } from "react";
import { Square } from "lucide-react";
import { stopTimerAction } from "@/modules/time/actions";
import { formatClock } from "@/lib/time-format";
import { useNow } from "./task-time";

/** Your running timer, shown in the sidebar on every page: the task and a stop button. */
export function RunningTimer({
  workspaceSlug,
  timer,
}: {
  workspaceSlug: string;
  timer: { ref: string; title: string; startedAt: string } | null;
}) {
  const now = useNow(Boolean(timer));
  const [pending, startTransition] = useTransition();
  if (!timer) return null;
  const seconds = Math.max(0, Math.floor((now - new Date(timer.startedAt).getTime()) / 1000));
  return (
    <div
      role="status"
      aria-label={`Timer running on ${timer.ref}`}
      className="neu-tile mx-2 mb-2 flex w-auto items-center gap-2 rounded-lg px-2 py-1.5 text-[12px]"
      style={{ "--tile-light": "#c53b30", "--tile-dark": "#f0877e" } as React.CSSProperties}
    >
      <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-[var(--tint)]" />
      <Link
        href={`/w/${workspaceSlug}/t/${timer.ref}`}
        className="text-foreground min-w-0 flex-1 truncate hover:underline"
        title={`${timer.ref} ${timer.title}`}
      >
        <span className="font-mono text-[11px]">{timer.ref}</span> {timer.title}
      </Link>
      <span className="font-medium tabular-nums" suppressHydrationWarning>
        {formatClock(seconds)}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => void (await stopTimerAction(workspaceSlug)))}
        aria-label="Stop timer"
        className="grid size-6 place-items-center rounded-full hover:bg-black/10 dark:hover:bg-white/10"
      >
        <Square className="size-3 fill-current" />
      </button>
    </div>
  );
}
