import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, CornerLeftUp } from "lucide-react";
import { getTaskPage } from "@/modules/tasks/queries";
import { describeActivity } from "@/lib/task-format";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewTaskForm } from "@/components/tasks/new-task-form";
import { ArchiveTaskButton, AssigneesForm, TaskForm } from "@/components/tasks/task-forms";
import { AssigneeStack, DueDateLabel, PriorityLabel, StatusPill } from "@/components/tasks/task-bits";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  return { title: decodeURIComponent((await params).ref).toUpperCase() };
}

const timeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function TaskPage({ params }: { params: Promise<{ slug: string; ref: string }> }) {
  const { slug, ref } = await params;
  const { task, project, list, parent, statuses, assignees, assignable, subtasks, activity, can } =
    await getTaskPage(slug, ref);
  const taskRef = `${project.key}-${task.number}`;
  const status = statuses.find((s) => s.id === task.statusId);
  const names = new Map(assignable.map((a) => [a.userId, a.name]));

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1">
            <Link href={`/w/${slug}/p/${project.key}`} className="hover:text-foreground">
              {project.name}
            </Link>
            <ChevronRight className="size-3" aria-hidden />
            <Link href={`/w/${slug}/l/${list.id}`} className="hover:text-foreground">
              {list.name}
            </Link>
            <ChevronRight className="size-3" aria-hidden />
            <span className="font-mono">{taskRef}</span>
          </span>
        }
        title={task.title}
        actions={status ? <StatusPill name={status.name} color={status.color} /> : null}
      />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid content-start gap-6">
          {parent ? (
            <Link
              href={`/w/${slug}/t/${parent.ref}`}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-[13px]"
            >
              <CornerLeftUp className="size-3.5" aria-hidden /> Subtask of{" "}
              <span className="font-mono">{parent.ref}</span> {parent.title}
            </Link>
          ) : null}
          <Card>
            <CardContent className="pt-5">
              <TaskForm workspaceSlug={slug} task={task} statuses={statuses} canEdit={can.update} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Subtasks{" "}
                {subtasks.length ? (
                  <span className="text-muted-foreground font-normal">({subtasks.length})</span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {subtasks.length ? (
                <ul className="divide-y rounded-md border">
                  {subtasks.map((s) => {
                    const subStatus = statuses.find((st) => st.id === s.statusId);
                    return (
                      <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                        <span className="text-muted-foreground w-16 font-mono text-[11px]">{s.ref}</span>
                        <Link
                          href={`/w/${slug}/t/${s.ref}`}
                          className="min-w-0 flex-1 truncate hover:underline hover:underline-offset-4"
                        >
                          {s.title}
                        </Link>
                        <PriorityLabel priority={s.priority} />
                        <DueDateLabel dueDate={s.dueDate} completed={Boolean(s.completedAt)} />
                        <AssigneeStack people={s.assignees} />
                        {subStatus ? <StatusPill name={subStatus.name} color={subStatus.color} /> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted-foreground">No subtasks.</p>
              )}
              {can.createSubtask ? (
                <NewTaskForm
                  workspaceSlug={slug}
                  listId={list.id}
                  parentTaskId={task.id}
                  statuses={statuses}
                  placeholder="Add a subtask…"
                />
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Assignees</CardTitle>
            </CardHeader>
            <CardContent>
              <AssigneesForm
                workspaceSlug={slug}
                taskId={task.id}
                assignable={assignable}
                assignedIds={assignees.map((a) => a.userId)}
                canEdit={can.update}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-3">
                {activity.map((event) => (
                  <li key={event.id} className="grid gap-0.5 text-[13px]">
                    {describeActivity(event, names).map((line, i) => (
                      <span key={i}>
                        <strong className="font-medium">
                          {event.actorName ?? (event.actorKind === "user" ? "Someone" : "Eightcore")}
                        </strong>{" "}
                        {line}
                      </span>
                    ))}
                    <time
                      dateTime={new Date(event.createdAt).toISOString()}
                      className="text-muted-foreground text-[11px]"
                    >
                      {timeFormat.format(new Date(event.createdAt))}
                    </time>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {can.archive ? (
            <Card>
              <CardHeader>
                <CardTitle>Archive</CardTitle>
              </CardHeader>
              <CardContent>
                <ArchiveTaskButton workspaceSlug={slug} taskId={task.id} listId={list.id} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
