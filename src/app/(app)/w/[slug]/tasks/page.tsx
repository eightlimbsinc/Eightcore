import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { getTasksPage } from "@/modules/workspaces/queries";
import { SEARCH_LIMIT } from "@/modules/tasks/search";
import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/tasks/filter-bar";
import {
  AssigneeStack,
  DueDateLabel,
  PriorityLabel,
  StatusPill,
  TagList,
} from "@/components/tasks/task-bits";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const { filter, today, people, tagNames, tasks, total } = await getTasksPage(slug, await searchParams);
  const myWork = filter.assignees.length === 1 && filter.assignees[0] === "me";

  // Group by project › list, keeping the due-date order inside each group.
  const groups = new Map<string, { title: string; href: string; tasks: typeof tasks }>();
  for (const t of tasks) {
    const key = t.listId;
    const group = groups.get(key) ?? {
      title: `${t.projectName} › ${t.listName}`,
      href: `/w/${slug}/l/${t.listId}`,
      tasks: [],
    };
    group.tasks.push(t);
    groups.set(key, group);
  }

  return (
    <>
      <PageHeader
        title={myWork ? "My Work" : "Tasks"}
        description={
          myWork
            ? "Everything assigned to you, across all your projects, soonest due first."
            : "Search and filter tasks across every project you can see."
        }
      />
      <div className="grid gap-5 px-8 py-6">
        <FilterBar path={`/w/${slug}/tasks`} filter={filter} people={people} tags={tagNames} />
        <p className="text-muted-foreground text-[13px]" role="status">
          {total === 0
            ? "No tasks match."
            : total > SEARCH_LIMIT
              ? `Showing the first ${SEARCH_LIMIT} of ${total} tasks. Narrow the filters to see the rest.`
              : `${total} ${total === 1 ? "task" : "tasks"}`}
        </p>
        {total === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed px-6 py-12 text-center">
            <SearchX className="text-muted-foreground mb-3 size-8" aria-hidden />
            <p className="text-muted-foreground">Try fewer filters, or a different search.</p>
          </div>
        ) : (
          [...groups.values()].map((g) => (
            <section
              key={g.href}
              aria-label={g.title}
              className="bg-surface overflow-hidden rounded-lg border"
            >
              <h2 className="bg-surface-muted/50 border-b px-4 py-2 text-[13px] font-semibold">
                <Link href={g.href} className="hover:underline">
                  {g.title}
                </Link>
              </h2>
              <ul className="divide-y">
                {g.tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
                    <span className="text-muted-foreground w-16 shrink-0 font-mono text-[11px]">{t.ref}</span>
                    <Link
                      href={`/w/${slug}/t/${t.ref}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline hover:underline-offset-4"
                    >
                      {t.title}
                    </Link>
                    <TagList tags={t.tags} />
                    <AssigneeStack people={t.assignees} />
                    <PriorityLabel priority={t.priority} />
                    <DueDateLabel dueDate={t.dueDate} completed={t.closed} today={today} />
                    <StatusPill name={t.statusName} color={t.statusColor} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}
