import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, CornerLeftUp } from "lucide-react";
import { getTaskPage } from "@/modules/tasks/queries";
import { describeActivity } from "@/lib/task-format";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewTaskForm } from "@/components/tasks/new-task-form";
import { ArchiveTaskButton, AssigneesForm, TaskForm } from "@/components/tasks/task-forms";
import {
  AssigneeStack,
  BlockedBadge,
  DueDateLabel,
  PriorityLabel,
  StatusPill,
  TagList,
} from "@/components/tasks/task-bits";
import { AttachmentsPanel, TagsPanel, WatchButton } from "@/components/tasks/task-side-panels";
import { CommentsSection } from "@/components/comments/comment-thread";
import { DependenciesPanel, FieldsPanel } from "@/components/tasks/task-relations";
import { env } from "@/server/env";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  return { title: decodeURIComponent((await params).ref).toUpperCase() };
}

const timeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function TaskPage({ params }: { params: Promise<{ slug: string; ref: string }> }) {
  const { slug, ref } = await params;
  const {
    task,
    project,
    list,
    parent,
    statuses,
    assignees,
    assignable,
    subtasks,
    activity,
    can,
    watchers,
    watching,
    comments,
    attachments,
    projectTags,
    tags,
    dependencies,
    fields,
  } = await getTaskPage(slug, ref);
  const fieldsHref = fields.canManage ? `/w/${slug}/p/${project.key}/fields` : null;
  const mentionable = assignable.map((a) => ({ userId: a.userId, name: a.name }));
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
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {dependencies.openBlockers > 0 ? <BlockedBadge count={dependencies.openBlockers} /> : null}
            <TagList tags={tags} />
            {status ? <StatusPill name={status.name} color={status.color} /> : null}
          </span>
        }
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
              <TaskForm
                workspaceSlug={slug}
                task={task}
                statuses={statuses}
                canEdit={can.update}
                openBlockers={dependencies.openBlockers}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fields</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldsPanel
                workspaceSlug={slug}
                taskId={task.id}
                fields={fields.fields}
                people={mentionable}
                canEdit={fields.canEdit}
                manageHref={fieldsHref}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dependencies</CardTitle>
            </CardHeader>
            <CardContent>
              <DependenciesPanel
                workspaceSlug={slug}
                taskId={task.id}
                blockedBy={dependencies.blockedBy}
                blocking={dependencies.blocking}
                canEdit={dependencies.canEdit}
              />
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

          <Card>
            <CardHeader>
              <CardTitle>
                Comments{" "}
                {comments.threads.length ? (
                  <span className="text-muted-foreground font-normal">({comments.threads.length})</span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CommentsSection
                workspaceSlug={slug}
                taskId={task.id}
                threads={comments.threads}
                members={mentionable}
                canComment={comments.can.comment}
                canAttach={comments.can.attach}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Watching</CardTitle>
            </CardHeader>
            <CardContent>
              <WatchButton
                workspaceSlug={slug}
                taskId={task.id}
                watching={watching}
                watcherNames={watchers.map((w) => w.name)}
              />
            </CardContent>
          </Card>
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
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <TagsPanel
                workspaceSlug={slug}
                projectId={project.id}
                taskId={task.id}
                projectTags={projectTags}
                taskTagIds={tags.map((t) => t.id)}
                canEdit={can.update}
                canManage={can.manageTags}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Files</CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentsPanel
                workspaceSlug={slug}
                taskId={task.id}
                files={attachments}
                canUpload={can.attach}
                maxMb={Math.floor(env().MAX_UPLOAD_BYTES / (1024 * 1024))}
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
