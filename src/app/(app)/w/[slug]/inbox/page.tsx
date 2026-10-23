import type { Metadata } from "next";
import Link from "next/link";
import { getInboxPage } from "@/modules/workspaces/queries";
import { PageHeader } from "@/components/app/page-header";
import { InboxList, MarkAllReadButton } from "@/components/app/inbox";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { slug } = await params;
  const filter = (await searchParams).filter === "unread" ? "unread" : "all";
  const { notifications } = await getInboxPage(slug, filter);
  const hasUnread = notifications.some((n) => !n.readAt);
  const base = `/w/${slug}/inbox`;
  return (
    <>
      <PageHeader
        title="Inbox"
        description="Assignments, mentions, comments and status changes on tasks you follow."
        actions={hasUnread ? <MarkAllReadButton workspaceSlug={slug} /> : null}
      />
      <div className="grid gap-4 px-8 py-6">
        <nav className="flex gap-1" aria-label="Filter">
          {(["all", "unread"] as const).map((f) => (
            <Link
              key={f}
              href={f === "all" ? base : `${base}?filter=unread`}
              aria-current={filter === f ? "page" : undefined}
              className={cn(
                "text-muted-foreground rounded-md px-2.5 py-1 text-[13px]",
                filter === f ? "bg-surface-muted text-foreground font-medium" : "hover:text-foreground",
              )}
            >
              {f === "all" ? "All" : "Unread"}
            </Link>
          ))}
        </nav>
        <InboxList
          workspaceSlug={slug}
          notifications={notifications.map((n) => ({
            id: n.id,
            type: n.type,
            data: n.data,
            read: Boolean(n.readAt),
            createdAt: n.createdAt,
            actorName: n.actorName,
            taskRef: n.taskRef,
            taskTitle: n.taskTitle,
            projectName: n.projectName,
            archived: Boolean(n.taskArchivedAt),
          }))}
          emptyText={filter === "unread" ? "You're all caught up." : "Nothing here yet."}
        />
      </div>
    </>
  );
}
