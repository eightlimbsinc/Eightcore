import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ListChecks, Settings2 } from "lucide-react";
import { getListPage } from "@/modules/lists/queries";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { NewTaskForm } from "@/components/tasks/new-task-form";
import { StatusSelect } from "@/components/tasks/status-select";
import { AssigneeStack, DueDateLabel, PriorityLabel, StatusDot, TagList } from "@/components/tasks/task-bits";

export const metadata: Metadata = { title: "List" };

export default async function ListPage({ params }: { params: Promise<{ slug: string; listId: string }> }) {
  const { slug, listId } = await params;
  const { list, project, folder, statuses, tasks, can } = await getListPage(slug, listId);
  const groups = statuses.map((status) => ({ status, tasks: tasks.filter((t) => t.statusId === status.id) }));

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
        description={`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
        actions={
          can.manage ? (
            <Button asChild variant="outline">
              <Link href={`/w/${slug}/l/${list.id}/statuses`}>
                <Settings2 /> List settings & statuses
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-6 px-8 py-6">
        {can.createTask ? <NewTaskForm workspaceSlug={slug} listId={list.id} statuses={statuses} /> : null}

        {tasks.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed px-6 py-12 text-center">
            <ListChecks className="text-accent mb-3 size-8" aria-hidden />
            <h2 className="font-semibold">No tasks yet</h2>
            <p className="text-muted-foreground mt-1">
              {can.createTask ? "Add the first task above." : "Tasks added to this list will appear here."}
            </p>
          </div>
        ) : (
          <div className="grid gap-5">
            {groups
              .filter((g) => g.tasks.length > 0)
              .map(({ status, tasks: groupTasks }) => (
                <section
                  key={status.id}
                  aria-labelledby={`status-${status.id}`}
                  className="bg-surface overflow-hidden rounded-lg border"
                >
                  <h2
                    id={`status-${status.id}`}
                    className="bg-surface-muted/50 flex items-center gap-2 border-b px-4 py-2 text-[13px] font-semibold"
                  >
                    <StatusDot color={status.color} />
                    {status.name}
                    <span className="text-muted-foreground font-normal tabular-nums">
                      {groupTasks.length}
                    </span>
                  </h2>
                  <ul className="divide-y">
                    {groupTasks.map((task) => {
                      const ref = `${project.key}-${task.number}`;
                      return (
                        <li key={task.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
                          <span className="text-muted-foreground w-16 shrink-0 font-mono text-[11px]">
                            {ref}
                          </span>
                          <Link
                            href={`/w/${slug}/t/${ref}`}
                            className="min-w-0 flex-1 truncate font-medium hover:underline hover:underline-offset-4"
                          >
                            {task.title}
                          </Link>
                          {task.subtaskCount > 0 ? (
                            <span className="text-muted-foreground text-[12px]">
                              {task.subtaskCount} {task.subtaskCount === 1 ? "subtask" : "subtasks"}
                            </span>
                          ) : null}
                          <TagList tags={task.tags} />
                          <PriorityLabel priority={task.priority} />
                          <DueDateLabel dueDate={task.dueDate} completed={Boolean(task.completedAt)} />
                          <AssigneeStack people={task.assignees} />
                          {can.updateTask ? (
                            <StatusSelect
                              workspaceSlug={slug}
                              taskId={task.id}
                              version={task.version}
                              statusId={task.statusId}
                              statuses={statuses}
                              label={`Status of ${ref}`}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </div>
    </>
  );
}
