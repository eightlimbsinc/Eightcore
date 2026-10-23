import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ListChecks, Settings2 } from "lucide-react";
import { getListPage } from "@/modules/lists/queries";
import { canProject } from "@/server/authz/policy";
import { effectiveView, viewQuery } from "@/modules/lists/view-settings";
import { filterQuery, isFiltering, matchesFilter, readFilter } from "@/modules/tasks/filters";
import { viewerToday } from "@/server/today";
import { FilterBar } from "@/components/tasks/filter-bar";
import { isClosedCategory } from "@/modules/lists/templates";
import { ViewMenu } from "@/components/lists/view-menu";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { NewTaskForm } from "@/components/tasks/new-task-form";
import { QuickAddTask } from "@/components/tasks/quick-add-task";
import { StatusMenu } from "@/components/tasks/status-menu";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { ExpandableTask } from "@/components/tasks/expandable-task";
import { DueDatePicker, PriorityPicker } from "@/components/tasks/row-pickers";
import { BlockedBadge, FieldChips, TagList } from "@/components/tasks/task-bits";

export const metadata: Metadata = { title: "List" };

/** Columns: status, name, ID, assignee, priority, due date. Below md only status and name. */
const ROW_GRID =
  "grid grid-cols-[1.25rem_1.75rem_minmax(0,1fr)] md:grid-cols-[1.25rem_1.75rem_minmax(0,1fr)_6.5rem_7rem_7rem_6.5rem]";

export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; listId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, listId } = await params;
  const {
    user,
    list,
    project,
    folder,
    statuses,
    tasks,
    people,
    role,
    can,
    view: savedView,
  } = await getListPage(slug, listId);
  // The saved view, with any changes from the address bar on top.
  const query = await searchParams;
  const view = effectiveView(savedView, query);
  const savedFilter = readFilter(Object.fromEntries(new URLSearchParams(savedView.filters)));
  const filter = readFilter(query, savedFilter);
  const filtering = isFiltering(filter);
  const today = await viewerToday();
  const closedStatus = new Set(statuses.filter((s) => isClosedCategory(s.category)).map((s) => s.id));

  // A task shows when it matches, or when one of its subtasks does (so the match has a parent).
  const kids = new Map<string, typeof tasks>();
  for (const t of tasks)
    if (t.parentTaskId) kids.set(t.parentTaskId, [...(kids.get(t.parentTaskId) ?? []), t]);
  const matches = (t: (typeof tasks)[number]) =>
    matchesFilter(
      {
        title: t.title,
        ref: `${project.key}-${t.number}`,
        priority: t.priority,
        dueDate: t.dueDate,
        completed: Boolean(t.completedAt),
        closed: closedStatus.has(t.statusId),
        assigneeIds: t.assignees.map((a) => a.userId),
        tagNames: t.tags.map((g) => g.name),
        openBlockers: t.openBlockers,
      },
      filter,
      { userId: user.id, today },
    );
  const shown = new Set<string>();
  const markShown = (t: (typeof tasks)[number]): boolean => {
    const childShown = (kids.get(t.id) ?? []).map(markShown).some(Boolean);
    const show = !filtering || matches(t) || childShown;
    if (show) shown.add(t.id);
    return show;
  };
  tasks.filter((t) => t.parentTaskId === null).forEach(markShown);
  const visibleStatuses =
    view.closed === "hide" ? statuses.filter((s) => !isClosedCategory(s.category)) : statuses;
  const ordered = view.order === "desc" ? [...visibleStatuses].reverse() : visibleStatuses;
  // Groups hold top-level tasks; subtasks appear under their parent when it is expanded.
  const allTopLevel = tasks.filter((t) => t.parentTaskId === null);
  const topLevel = allTopLevel.filter((t) => shown.has(t.id));
  const groups = ordered.map((status) => ({
    status,
    tasks: topLevel.filter((t) => t.statusId === status.id),
  }));
  const base = `/w/${slug}/l/${list.id}`;

  const childrenOf = new Map<string, typeof tasks>();
  for (const t of tasks) {
    if (t.parentTaskId && shown.has(t.id))
      childrenOf.set(t.parentTaskId, [...(childrenOf.get(t.parentTaskId) ?? []), t]);
  }
  const renderTask = (task: (typeof tasks)[number], depth: number): React.ReactNode => {
    const ref = `${project.key}-${task.number}`;
    const subtasks = childrenOf.get(task.id) ?? [];
    return (
      <ExpandableTask
        // Remount when the view's subtask setting changes, so rows pick up the new default.
        key={`${task.id}:${view.subtasks}:${filtering}`}
        // Expanded by the view, or because a filter matched something inside.
        defaultOpen={view.subtasks === "expanded" || (filtering && subtasks.length > 0)}
        gridClass={ROW_GRID}
        name={`${ref} ${task.title}`}
        subtaskCount={subtasks.length}
        depth={depth}
        menu={{
          workspaceSlug: slug,
          taskId: task.id,
          taskRef: ref,
          title: task.title,
          canArchive:
            canProject(role, "task.archive") ||
            (task.createdBy === user.id && canProject(role, "task.archive_own")),
          canDelete:
            canProject(role, "task.delete") ||
            (task.createdBy === user.id && canProject(role, "task.delete_own")),
        }}
        cells={
          <>
            <StatusMenu
              workspaceSlug={slug}
              taskId={task.id}
              version={task.version}
              statusId={task.statusId}
              statuses={statuses}
              label={`Status of ${ref}`}
              openBlockers={task.openBlockers}
              canEdit={can.updateTask}
            />
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                href={`/w/${slug}/t/${ref}`}
                className="min-w-0 truncate font-medium hover:underline hover:underline-offset-4"
              >
                {task.title}
              </Link>
              {task.subtaskCount > 0 ? (
                <span className="text-muted-foreground text-[12px]">
                  {task.subtaskCount} {task.subtaskCount === 1 ? "subtask" : "subtasks"}
                </span>
              ) : null}
              {task.openBlockers > 0 ? <BlockedBadge count={task.openBlockers} /> : null}
              <TagList tags={task.tags} />
              <FieldChips fields={task.fields} />
              <span className="text-muted-foreground font-mono text-[11px] md:hidden">{ref}</span>
            </div>
            <span className="text-muted-foreground hidden font-mono text-[11px] md:block">{ref}</span>
            <span className="hidden md:block">
              <AssigneePicker
                workspaceSlug={slug}
                taskId={task.id}
                people={people}
                assignedIds={task.assignees.map((a) => a.userId)}
                currentUserId={user.id}
                canEdit={can.updateTask}
                label={`Assignees of ${ref}`}
              />
            </span>
            <span className="hidden md:block">
              <PriorityPicker
                workspaceSlug={slug}
                taskId={task.id}
                version={task.version}
                priority={task.priority}
                label={`Priority of ${ref}`}
                canEdit={can.updateTask}
              />
            </span>
            <span className="hidden md:block">
              <DueDatePicker
                workspaceSlug={slug}
                taskId={task.id}
                version={task.version}
                dueDate={task.dueDate}
                completed={Boolean(task.completedAt)}
                label={`Due date of ${ref}`}
                canEdit={can.updateTask}
              />
            </span>
          </>
        }
      >
        {subtasks.length ? subtasks.map((s) => renderTask(s, depth + 1)) : null}
      </ExpandableTask>
    );
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1">
            <Link href={`/w/${slug}/p/${project.key}`} className="hover:text-foreground">
              {project.name}
            </Link>
            {folder ? (
              <>
                <ChevronRight className="size-3" aria-hidden /> {folder.name}
              </>
            ) : null}
          </span>
        }
        title={list.name}
        description={
          filtering
            ? `${topLevel.length} of ${allTopLevel.length} tasks match`
            : `${topLevel.length} ${topLevel.length === 1 ? "task" : "tasks"}`
        }
        actions={
          <>
            <ViewMenu
              workspaceSlug={slug}
              listId={list.id}
              view={view}
              saved={savedView}
              isProtected={list.viewProtected}
              canSave={can.saveView}
              canProtect={can.protectView}
              filters={filterQuery(filter).toString()}
              filterChanges={filterQuery(filter, savedFilter).toString()}
            />
            {can.manage ? (
              <Button asChild variant="outline">
                <Link href={`${base}/statuses`}>
                  <Settings2 /> List settings & statuses
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 px-8 py-6">
        {can.createTask ? <NewTaskForm workspaceSlug={slug} listId={list.id} statuses={statuses} /> : null}
        <FilterBar
          path={base}
          filter={filter}
          defaults={savedFilter}
          extraQuery={viewQuery(view, savedView).replace(/^\?/, "")}
          people={people.map((p) => ({ userId: p.userId, name: p.name }))}
          tags={[...new Set(tasks.flatMap((t) => t.tags.map((g) => g.name)))].sort()}
        />

        {tasks.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed px-6 py-12 text-center">
            <ListChecks className="text-accent mb-3 size-8" aria-hidden />
            <h2 className="font-semibold">No tasks yet</h2>
            <p className="text-muted-foreground mt-1">
              {can.createTask ? "Add the first task above." : "Tasks added to this list will appear here."}
            </p>
          </div>
        ) : topLevel.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-6 py-10 text-center">
            No tasks match these filters.
          </p>
        ) : (
          <div className="grid gap-6">
            {groups
              .filter((g) => g.tasks.length > 0)
              .map(({ status, tasks: groupTasks }) => (
                <section key={status.id} aria-labelledby={`status-${status.id}`} className="grid gap-1">
                  <h2 id={`status-${status.id}`} className="flex items-center gap-2 text-[12px]">
                    <span
                      className="inline-flex h-6 items-center rounded-md px-2 font-semibold tracking-wide text-white uppercase"
                      style={{ background: status.color }}
                    >
                      {status.name}
                    </span>
                    <span className="text-muted-foreground tabular-nums">{groupTasks.length}</span>
                  </h2>
                  <div className="bg-surface overflow-hidden rounded-lg border">
                    <div
                      className={`${ROW_GRID} text-muted-foreground items-center gap-x-2 border-b px-2 py-1.5 text-[11px] font-medium`}
                      aria-hidden
                    >
                      <span />
                      <span />
                      <span>Name</span>
                      <span className="hidden md:block">ID</span>
                      <span className="hidden md:block">Assignee</span>
                      <span className="hidden md:block">Priority</span>
                      <span className="hidden md:block">Due date</span>
                    </div>
                    <ul className="divide-y">{groupTasks.map((task) => renderTask(task, 0))}</ul>
                    {can.createTask ? (
                      <div className="border-t">
                        <QuickAddTask
                          workspaceSlug={slug}
                          listId={list.id}
                          statusId={status.id}
                          statusName={status.name}
                        />
                      </div>
                    ) : null}
                  </div>
                </section>
              ))}
          </div>
        )}
      </div>
    </>
  );
}
