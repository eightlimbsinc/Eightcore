"use client";
import { useTransition } from "react";
import { AtSign, CheckCheck, CircleDot, MessageSquare, UserPlus } from "lucide-react";
import { markAllReadAction, openNotificationAction } from "@/modules/notifications/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface InboxItem {
  id: string;
  type: "assigned" | "mentioned" | "commented" | "status_changed";
  data: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
  actorName: string | null;
  taskRef: string;
  taskTitle: string;
  projectName: string;
  archived: boolean;
}

const ICONS = { assigned: UserPlus, mentioned: AtSign, commented: MessageSquare, status_changed: CircleDot };

const timeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function headline(n: InboxItem): string {
  const who = n.actorName ?? "Eightcore";
  switch (n.type) {
    case "assigned":
      return `${who} assigned you`;
    case "mentioned":
      return `${who} mentioned you`;
    case "commented":
      return `${who} commented`;
    case "status_changed":
      return `${who} moved it from ${String(n.data.from ?? "?")} to ${String(n.data.to ?? "?")}`;
  }
}

export function MarkAllReadButton({ workspaceSlug }: { workspaceSlug: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(async () => void (await markAllReadAction(workspaceSlug)))}
    >
      <CheckCheck /> Mark all as read
    </Button>
  );
}

export function InboxList({
  workspaceSlug,
  notifications,
  emptyText,
}: {
  workspaceSlug: string;
  notifications: InboxItem[];
  emptyText: string;
}) {
  if (!notifications.length) return <p className="text-muted-foreground py-8 text-center">{emptyText}</p>;
  return (
    <ul className="bg-surface divide-y rounded-lg border" aria-label="Notifications">
      {notifications.map((n) => {
        const Icon = ICONS[n.type];
        const excerpt = typeof n.data.excerpt === "string" ? n.data.excerpt : null;
        return (
          <li key={n.id}>
            <form action={openNotificationAction.bind(null, workspaceSlug, n.id, n.taskRef)}>
              <button
                type="submit"
                disabled={n.archived}
                className={cn(
                  "hover:bg-surface-muted flex w-full items-start gap-3 px-4 py-3 text-left disabled:cursor-default disabled:opacity-60",
                  !n.read && "bg-accent-soft/40",
                )}
              >
                <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-[13px]">
                    <strong className="font-medium">{headline(n)}</strong>{" "}
                    <span className="text-muted-foreground">on</span>{" "}
                    <span className="font-mono text-[12px]">{n.taskRef}</span> {n.taskTitle}
                    {n.archived ? <span className="text-muted-foreground"> (archived)</span> : null}
                  </span>
                  {excerpt ? (
                    <span className="text-muted-foreground truncate text-[12px]">“{excerpt}”</span>
                  ) : null}
                  <span className="text-muted-foreground text-[11px]">
                    {n.projectName} · {timeFormat.format(new Date(n.createdAt))}
                  </span>
                </span>
                {!n.read ? (
                  <span className="bg-accent mt-1.5 size-2 shrink-0 rounded-full" aria-label="Unread" />
                ) : null}
              </button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
