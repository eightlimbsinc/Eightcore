import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getListView } from "@/modules/lists/queries";
import { isClosedCategory } from "@/modules/lists/templates";
import {
  addDays,
  addMonths,
  isIsoDate,
  isMonth,
  monthGrid,
  monthLabel,
  weekDays,
  weekLabel,
} from "@/lib/calendar";
import { ListHeader } from "@/components/lists/list-header";
import { TaskCalendar } from "@/components/tasks/calendar";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; listId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, listId } = await params;
  const query = await searchParams;
  const data = await getListView(slug, listId, query);
  const { list, project, tasks, statuses, can, shown, today, topLevel, allTopLevel } = data;

  // ?cal=week&week=YYYY-MM-DD, or month view: ?month=YYYY-MM (default: this month).
  const mode = query.cal === "week" ? "week" : "month";
  const month = isMonth(query.month) ? query.month : today.slice(0, 7);
  const weekDate = isIsoDate(query.week) ? query.week : today;
  const weeks = mode === "week" ? [weekDays(weekDate)] : monthGrid(month);
  const base = `/w/${slug}/l/${list.id}/calendar`;
  const keep = new URLSearchParams(
    Object.entries(query).filter(
      ([k, v]) => typeof v === "string" && !["cal", "month", "week"].includes(k),
    ) as [string, string][],
  );
  const href = (extra: Record<string, string>) => {
    const p = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `${base}?${p}`;
  };
  const prev =
    mode === "week"
      ? href({ cal: "week", week: addDays(weekDate, -7) })
      : href({ month: addMonths(month, -1) });
  const next =
    mode === "week"
      ? href({ cal: "week", week: addDays(weekDate, 7) })
      : href({ month: addMonths(month, 1) });
  const statusById = new Map(statuses.map((s) => [s.id, s]));

  return (
    <>
      <ListHeader
        slug={slug}
        layout="calendar"
        list={list}
        project={project}
        folder={data.folder}
        counts={{ shown: topLevel.length, total: allTopLevel.length }}
        view={data.view}
        savedView={data.savedView}
        filter={data.filter}
        savedFilter={data.savedFilter}
        filtering={data.filtering}
        closedCount={data.closedCount}
        can={can}
        statuses={statuses}
        people={data.people.map((p) => ({ userId: p.userId, name: p.name }))}
        tagNames={[...new Set(tasks.flatMap((t) => t.tags.map((g) => g.name)))].sort()}
      />
      <div className="grid gap-4 px-8 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={prev}
            aria-label={mode === "week" ? "Previous week" : "Previous month"}
            className="hover:bg-surface-muted grid size-8 place-items-center rounded-md border"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <Link
            href={next}
            aria-label={mode === "week" ? "Next week" : "Next month"}
            className="hover:bg-surface-muted grid size-8 place-items-center rounded-md border"
          >
            <ChevronRight className="size-4" />
          </Link>
          <Link
            href={mode === "week" ? href({ cal: "week" }) : href({})}
            className="hover:bg-surface-muted h-8 rounded-md border px-3 text-[13px] leading-8"
          >
            Today
          </Link>
          <h2 className="ml-2 text-[15px] font-semibold" aria-live="polite">
            {mode === "week" ? weekLabel(weekDate) : monthLabel(month)}
          </h2>
          <nav aria-label="Calendar range" className="ml-auto flex rounded-md border p-0.5">
            {(["month", "week"] as const).map((m) => (
              <Link
                key={m}
                href={
                  m === "week"
                    ? href({
                        cal: "week",
                        week: mode === "month" && month !== today.slice(0, 7) ? `${month}-01` : weekDate,
                      })
                    : href({ month: mode === "week" ? weekDate.slice(0, 7) : month })
                }
                aria-current={mode === m ? "page" : undefined}
                className={cn(
                  "rounded px-3 py-1 text-[13px]",
                  mode === m ? "bg-surface-muted font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "month" ? "Month" : "Week"}
              </Link>
            ))}
          </nav>
        </div>
        <TaskCalendar
          workspaceSlug={slug}
          weeks={weeks}
          month={mode === "month" ? month : null}
          today={today}
          canEdit={can.updateTask}
          tasks={tasks
            .filter((t) => shown.has(t.id))
            .map((t) => {
              const status = statusById.get(t.statusId);
              return {
                id: t.id,
                ref: `${project.key}-${t.number}`,
                title: t.title,
                version: t.version,
                dueDate: t.dueDate,
                startDate: t.startDate,
                statusName: status?.name ?? "",
                statusColor: status?.color ?? "#999999",
                closed: status ? isClosedCategory(status.category) : false,
              };
            })}
        />
      </div>
    </>
  );
}
