import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { getListView } from "@/modules/lists/queries";
import { canProject } from "@/server/authz/policy";
import { ListHeader } from "@/components/lists/list-header";
import { QuickAddTask } from "@/components/tasks/quick-add-task";
import { StatusMenu } from "@/components/tasks/status-menu";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { ExpandableTask } from "@/components/tasks/expandable-task";
import { DueDatePicker, PriorityPicker } from "@/components/tasks/row-pickers";
import { StatusGroup } from "@/components/tasks/status-group";
import { formatMinutes } from "@/lib/time-format";
import { ListKeyboard } from "@/components/tasks/list-keyboard";
import { BulkSelection, GroupCheckbox, RowCheckbox } from "@/components/tasks/bulk-select";
import { BlockedBadge, FieldChips, TagList } from "@/components/tasks/task-bits";

export const metadata: Metadata = { title: "List" };

/** Tasks shown per status group before "Show all". */
const GROUP_PAGE = 30;

/** Columns: select, expand, status, name, ID, assignee, priority, due date, time tracked. Below md select to name. */
const ROW_GRID =
  "grid grid-cols-[0.875rem_1.25rem_1.75rem_minmax(0,1fr)] md:grid-cols-[0.875rem_1.25rem_1.75rem_minmax(0,1fr)_6.5rem_7rem_7rem_6.5rem_5.5rem]";

export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; listId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, listId } = await params;
  const query = await searchParams;
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
    view,
    savedView,
    savedFilter,
    filter,
    filtering,
    allTopLevel,
    topLevel,
    groups,
    shown,
    closedCount,
  } = await getListView(slug, listId, query);
  // Big lists: each group shows its first GROUP_PAGE tasks ("Show all" adds ?all=<status>),
  // and groups that start collapsed send no rows until opened (?open=<status>).
  const idsParam = (key: string) =>
    new Set(typeof query[key] === "string" ? (query[key] as string).split(",").filter(Boolean) : []);
  const openParam = idsParam("open");
  const allParam = idsParam("all");

  const childrenOf = new Map<string, typeof tasks>();
  for (const t of tasks) {
    if (t.parentTaskId && shown.has(t.id))
      childrenOf.set(t.parentTaskId, [...(childrenOf.get(t.parentTaskId) ?? []), t]);
  }
  const bulk = {
    update: can.updateTask,
    archive: canProject(role, "task.archive") || canProject(role, "task.archive_own"),
    delete: canProject(role, "task.delete") || canProject(role, "task.delete_own"),
  };
  const selectable = bulk.update || bulk.archive || bulk.delete;
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
        leading={selectable ? <RowCheckbox id={task.id} label={`${ref} ${task.title}`} /> : <span />}
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
            <span
              className="text-muted-foreground hidden text-[12px] tabular-nums md:block"
              title={
                task.trackedSeconds ? `${formatMinutes(task.trackedSeconds / 60)} tracked` : "No time tracked"
              }
            >
              {task.trackedSeconds ? formatMinutes(task.trackedSeconds / 60) : "—"}
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
      <ListHeader
        slug={slug}
        layout="list"
        list={list}
        project={project}
        folder={folder}
        counts={{ shown: topLevel.length, total: allTopLevel.length }}
        view={view}
        savedView={savedView}
        filter={filter}
        savedFilter={savedFilter}
        filtering={filtering}
        closedCount={closedCount}
        can={can}
        statuses={statuses}
        people={people.map((p) => ({ userId: p.userId, name: p.name }))}
        tagNames={[...new Set(tasks.flatMap((t) => t.tags.map((g) => g.name)))].sort()}
      />
      <div className="grid gap-6 px-8 py-6">
        {tasks.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed px-6 py-12 text-center">
            <ListChecks className="text-accent mb-3 size-8" aria-hidden />
            <h2 className="font-semibold">No tasks yet</h2>
            <p className="text-muted-foreground mt-1">
              {can.createTask
                ? "Use “Add task” above to create the first one."
                : "Tasks added to this list will appear here."}
            </p>
          </div>
        ) : topLevel.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-6 py-10 text-center">
            No tasks match these filters.
          </p>
        ) : (
          <BulkSelection
            workspaceSlug={slug}
            listId={list.id}
            taskIds={tasks.filter((t) => shown.has(t.id)).map((t) => t.id)}
            statuses={statuses}
            people={people.map((p) => ({ userId: p.userId, name: p.name }))}
            can={bulk}
          >
            <ListKeyboard>
              <div className="grid gap-6">
                {groups
                  .filter((g) => g.tasks.length > 0)
                  .map(({ status, tasks: allGroupTasks }) => {
                    // Finished work (done, cancelled) starts collapsed; Closed shows open when turned on.
                    const startsOpen =
                      (status.category !== "done" && status.category !== "cancelled") ||
                      openParam.has(status.id);
                    const groupTasks = !startsOpen
                      ? []
                      : allParam.has(status.id)
                        ? allGroupTasks
                        : allGroupTasks.slice(0, GROUP_PAGE);
                    return (
                      <StatusGroup
                        key={status.id}
                        id={status.id}
                        name={status.name}
                        color={status.color}
                        count={allGroupTasks.length}
                        defaultOpen={startsOpen}
                        loaded={startsOpen}
                        hiddenCount={startsOpen ? allGroupTasks.length - groupTasks.length : 0}
                      >
                        <div className="bg-surface overflow-hidden rounded-lg border">
                          <div
                            className={`${ROW_GRID} group text-muted-foreground items-center gap-x-2 border-b py-1.5 pr-9 pl-2 text-[11px] font-medium`}
                          >
                            {selectable ? (
                              <GroupCheckbox ids={groupTasks.map((t) => t.id)} label={status.name} />
                            ) : (
                              <span />
                            )}
                            <span aria-hidden />
                            <span aria-hidden />
                            <span aria-hidden>Name</span>
                            <span aria-hidden className="hidden md:block">
                              ID
                            </span>
                            <span aria-hidden className="hidden md:block">
                              Assignee
                            </span>
                            <span aria-hidden className="hidden md:block">
                              Priority
                            </span>
                            <span aria-hidden className="hidden md:block">
                              Due date
                            </span>
                            <span aria-hidden className="hidden md:block">
                              Time tracked
                            </span>
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
                      </StatusGroup>
                    );
                  })}
              </div>
            </ListKeyboard>
          </BulkSelection>
        )}
      </div>
    </>
  );
}
