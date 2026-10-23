import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Ban, CalendarClock, CheckCircle2, CircleDot, UserX } from "lucide-react";
import { getDashboardPage } from "@/modules/workspaces/queries";
import { PRIORITY_META, formatDate } from "@/lib/task-format";
import { PageHeader } from "@/components/app/page-header";
import { BarList, ChartCard, ColumnChart, StatTile } from "@/components/dashboard/charts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

const STAGES = [
  ["backlog", "Backlog"],
  ["unstarted", "Not started"],
  ["active", "In progress"],
  ["review", "In review"],
] as const;

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const { project, projects, totals, stages, workload, completedByWeek, priorities, topTags } =
    await getDashboardPage(slug, await searchParams);
  /** Link to the matching tasks (in the focused project, if any). */
  const tasks = (query: Record<string, string> = {}) => {
    const p = new URLSearchParams({ ...query, ...(project ? { project: project.key } : {}) });
    return `/w/${slug}/tasks${p.size ? `?${p}` : ""}`;
  };
  const open = { state: "open" };

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          project
            ? `${project.name}: open work, deadlines and workload.`
            : "Open work, deadlines and workload across your projects."
        }
      />
      <div className="grid gap-6 px-8 py-6">
        <nav className="flex flex-wrap gap-1" aria-label="Dashboard for">
          {[{ key: "", name: "All projects" }, ...projects].map((p) => {
            const on = (project?.key ?? "") === p.key;
            return (
              <Link
                key={p.key || "all"}
                href={`/w/${slug}/dashboard${p.key ? `?project=${p.key}` : ""}`}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "text-muted-foreground rounded-md px-2.5 py-1 text-[13px]",
                  on ? "bg-surface-muted text-foreground font-medium" : "hover:text-foreground",
                )}
              >
                {p.name}
              </Link>
            );
          })}
        </nav>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label="Open tasks"
            value={totals.open}
            href={tasks(open)}
            icon={<CircleDot className="size-3.5" aria-hidden />}
          />
          <StatTile
            label="Overdue"
            value={totals.overdue}
            href={tasks({ ...open, due: "overdue" })}
            tone="critical"
            icon={<AlertTriangle className="size-3.5" aria-hidden />}
          />
          <StatTile
            label="Due this week"
            value={totals.dueThisWeek}
            href={tasks({ ...open, due: "week" })}
            hint={totals.dueToday ? `${totals.dueToday} due today` : undefined}
            icon={<CalendarClock className="size-3.5" aria-hidden />}
          />
          <StatTile
            label="Done this week"
            value={totals.doneThisWeek}
            href={tasks({ state: "closed" })}
            hint={`${totals.createdThisWeek} created this week`}
            icon={<CheckCircle2 className="size-3.5" aria-hidden />}
          />
          <StatTile
            label="Unassigned"
            value={totals.unassigned}
            href={tasks({ ...open, assignee: "none" })}
            icon={<UserX className="size-3.5" aria-hidden />}
          />
          <StatTile
            label="Blocked"
            value={totals.blocked}
            href={tasks({ ...open, blocked: "1" })}
            icon={<Ban className="size-3.5" aria-hidden />}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Workload"
            description="Open tasks per person (a task with two people counts for both)."
            table={{ headers: ["Person", "Open tasks"], rows: workload.map((w) => [w.name, w.n]) }}
          >
            <BarList
              empty="Nobody has open tasks assigned."
              rows={[
                ...workload.map((w) => ({
                  label: w.name,
                  value: w.n,
                  href: tasks({ ...open, assignee: w.userId }),
                  note: w.overdue
                    ? `${w.overdue} overdue`
                    : w.urgentOrHigh
                      ? `${w.urgentOrHigh} high`
                      : undefined,
                })),
                ...(totals.unassigned
                  ? [
                      {
                        label: "Unassigned",
                        value: totals.unassigned,
                        href: tasks({ ...open, assignee: "none" }),
                      },
                    ]
                  : []),
              ]}
            />
          </ChartCard>

          <ChartCard
            title="Completed per week"
            description="Tasks moved to a done status, last 8 weeks (Monday to Sunday)."
            table={{
              headers: ["Week of", "Completed"],
              rows: completedByWeek.map((w) => [formatDate(w.week), w.n]),
            }}
          >
            <ColumnChart
              label={`Completed per week: ${completedByWeek.map((w) => `${formatDate(w.week)} ${w.n}`).join(", ")}`}
              columns={completedByWeek.map((w) => ({
                label: formatDate(w.week),
                value: w.n,
                href: tasks({ state: "closed" }),
              }))}
            />
          </ChartCard>

          <ChartCard
            title="Open tasks by stage"
            description="Grouped by what each list's statuses mean, so different lists add up."
            table={{
              headers: ["Stage", "Open tasks"],
              rows: STAGES.map(([k, label]) => [label, stages[k] ?? 0]),
            }}
          >
            <BarList
              empty="No open tasks."
              rows={STAGES.map(([k, label]) => ({ label, value: stages[k] ?? 0, href: tasks(open) }))}
            />
          </ChartCard>

          <ChartCard
            title="Open tasks by priority"
            table={{
              headers: ["Priority", "Open tasks"],
              rows: (["urgent", "high", "normal", "low", "none"] as const).map((p) => [
                PRIORITY_META[p].label,
                priorities[p] ?? 0,
              ]),
            }}
          >
            <BarList
              empty="No open tasks."
              rows={(["urgent", "high", "normal", "low", "none"] as const).map((p) => ({
                label: PRIORITY_META[p].label,
                value: priorities[p] ?? 0,
                href: tasks({ ...open, priority: p }),
              }))}
            />
          </ChartCard>

          <ChartCard
            title="Top tags"
            description="Open tasks per tag."
            table={{ headers: ["Tag", "Open tasks"], rows: topTags.map((t) => [t.name, t.n]) }}
          >
            <BarList
              empty="No open tasks have tags yet."
              rows={topTags.map((t) => ({
                label: t.name,
                value: t.n,
                href: tasks({ ...open, tag: t.name }),
              }))}
            />
          </ChartCard>

          <ChartCard
            title="Deadlines"
            description="Open tasks by due date."
            table={{
              headers: ["Due", "Open tasks"],
              rows: [
                ["Overdue", totals.overdue],
                ["This week", totals.dueThisWeek],
                ["No due date", totals.noDueDate],
              ],
            }}
          >
            <BarList
              empty="No open tasks."
              rows={[
                { label: "Overdue", value: totals.overdue, href: tasks({ ...open, due: "overdue" }) },
                { label: "This week", value: totals.dueThisWeek, href: tasks({ ...open, due: "week" }) },
                { label: "No due date", value: totals.noDueDate, href: tasks({ ...open, due: "none" }) },
              ]}
            />
          </ChartCard>
        </div>
      </div>
    </>
  );
}
