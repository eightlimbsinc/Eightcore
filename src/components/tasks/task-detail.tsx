import Link from "next/link";
import { ChevronRight, CircleDot, CornerLeftUp, Eye, Tag, UserRound } from "lucide-react";
import { getTaskPage } from "@/modules/tasks/queries";
import { describeActivity } from "@/lib/task-format";
import { cn } from "@/lib/utils";
import { TaskSidePanel } from "@/components/tasks/task-side-panel";
import { NewTaskForm } from "@/components/tasks/new-task-form";
import { ArchiveTaskButton, TaskForm, TaskTitleInput } from "@/components/tasks/task-forms";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { DeleteTaskButton } from "@/components/tasks/task-row-menu";
import {
  AssigneeStack,
  BlockedBadge,
  DueDateLabel,
  PriorityLabel,
  StatusPill,
} from "@/components/tasks/task-bits";
import { AttachmentsPanel, TagsPanel, WatchButton } from "@/components/tasks/task-side-panels";
import { CommentsSection } from "@/components/comments/comment-thread";
import { DependenciesPanel, FieldsPanel } from "@/components/tasks/task-relations";
import { env } from "@/server/env";
import { StatusMenu } from "@/components/tasks/status-menu";
import { TaskModalControls } from "@/components/tasks/task-modal";

const timeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * Everything about one task. Rendered as the task page, and inside a window over the list
 * (`variant="modal"`), where the header offers "open full page" and close.
 */
export async function TaskDetail({
  slug,
  reference,
  variant = "page",
}: {
  slug: string;
  /** The task's reference from the URL, e.g. "WEB-12". */
  reference: string;
  variant?: "page" | "modal";
}) {
  const {
    user,
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
  } = await getTaskPage(slug, reference);
  const fieldsHref = fields.canManage ? `/w/${slug}/p/${project.key}/fields` : null;
  const mentionable = assignable.map((a) => ({ userId: a.userId, name: a.name }));
  const taskRef = `${project.key}-${task.number}`;
  const names = new Map(assignable.map((a) => [a.userId, a.name]));

  const actorName = (event: (typeof activity)[number]) =>
    event.actorName ?? (event.actorKind === "user" ? "Someone" : "Eightcore");
  // Comments appear in the timeline themselves, so their "commented" history lines are left out.
  const events = activity
    .filter((event) => event.action !== "commented" && event.action !== "replied")
    .map((event) => ({
      id: String(event.id),
      at: new Date(event.createdAt).toISOString(),
      content: (
        <span className="grid gap-0.5">
          {describeActivity(event, names).map((line, i) => (
            <span key={i}>
              <strong className="text-foreground font-medium">{actorName(event)}</strong> {line}
            </span>
          ))}
          <time dateTime={new Date(event.createdAt).toISOString()} className="text-[11px]">
            {timeFormat.format(new Date(event.createdAt))}
          </time>
        </span>
      ),
    }));
  const commentCount = comments.threads.reduce((n, t) => n + 1 + t.replies.length, 0);

  return (
    <div className={cn("flex flex-col", variant === "modal" ? "lg:h-full" : "lg:h-[calc(100dvh-3.25rem)]")}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-2.5">
        <nav
          aria-label="Task location"
          className="text-muted-foreground flex flex-wrap items-center gap-1 text-[12px]"
        >
          <Link href={`/w/${slug}/p/${project.key}`} className="hover:text-foreground">
            {project.name}
          </Link>
          <ChevronRight className="size-3" aria-hidden />
          <Link href={`/w/${slug}/l/${list.id}`} className="hover:text-foreground">
            {list.name}
          </Link>
          <ChevronRight className="size-3" aria-hidden />
          <span className="font-mono">{taskRef}</span>
        </nav>
        <span className="flex flex-wrap items-center gap-2">
          {dependencies.openBlockers > 0 ? <BlockedBadge count={dependencies.openBlockers} /> : null}
          {variant === "modal" ? <TaskModalControls href={`/w/${slug}/t/${taskRef}`} /> : null}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-w-0 flex-1 lg:overflow-y-auto">
          <div className="mx-auto grid max-w-4xl content-start gap-6 px-6 py-6 lg:px-10">
            {parent ? (
              <Link
                href={`/w/${slug}/t/${parent.ref}`}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-[13px]"
              >
                <CornerLeftUp className="size-3.5" aria-hidden /> Subtask of{" "}
                <span className="font-mono">{parent.ref}</span> {parent.title}
              </Link>
            ) : null}
            {/* The page's name for screen readers; the visible title is the editable field. */}
            <h1 className="sr-only">{task.title}</h1>
            <TaskTitleInput task={task} canEdit={can.update} />

            <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-[8rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground flex items-center gap-2 pt-1.5">
                <CircleDot className="size-4" aria-hidden /> Status
              </dt>
              <dd>
                <StatusMenu
                  workspaceSlug={slug}
                  taskId={task.id}
                  version={task.version}
                  statusId={task.statusId}
                  statuses={statuses}
                  label="Status"
                  variant="pill"
                  openBlockers={dependencies.openBlockers}
                  canEdit={can.update}
                />
              </dd>
              <dt className="text-muted-foreground flex items-center gap-2 pt-1.5">
                <UserRound className="size-4" aria-hidden /> Assignees
              </dt>
              <dd>
                <AssigneePicker
                  workspaceSlug={slug}
                  taskId={task.id}
                  people={assignable}
                  assignedIds={assignees.map((a) => a.userId)}
                  currentUserId={user.id}
                  canEdit={can.update}
                  label="Assignees"
                  variant="field"
                />
              </dd>
              <dt className="text-muted-foreground flex items-center gap-2 pt-1.5">
                <Tag className="size-4" aria-hidden /> Tags
              </dt>
              <dd>
                <TagsPanel
                  workspaceSlug={slug}
                  projectId={project.id}
                  taskId={task.id}
                  projectTags={projectTags}
                  taskTagIds={tags.map((t) => t.id)}
                  canEdit={can.update}
                  canManage={can.manageTags}
                />
              </dd>
              <dt className="text-muted-foreground flex items-center gap-2 pt-1.5">
                <Eye className="size-4" aria-hidden /> Watching
              </dt>
              <dd>
                <WatchButton
                  workspaceSlug={slug}
                  taskId={task.id}
                  watching={watching}
                  watcherNames={watchers.map((w) => w.name)}
                />
              </dd>
            </dl>

            <section aria-label="Details" className="border-t pt-5">
              <TaskForm workspaceSlug={slug} task={task} canEdit={can.update} />
            </section>

            <section aria-labelledby="subtasks-heading" className="grid gap-3 border-t pt-5">
              <h2 id="subtasks-heading" className="text-[13px] font-semibold">
                Subtasks{" "}
                {subtasks.length ? (
                  <span className="text-muted-foreground font-normal">({subtasks.length})</span>
                ) : null}
              </h2>
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
                <p className="text-muted-foreground text-[13px]">No subtasks.</p>
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
            </section>

            <section aria-labelledby="fields-heading" className="grid gap-3 border-t pt-5">
              <h2 id="fields-heading" className="text-[13px] font-semibold">
                Fields
              </h2>
              <FieldsPanel
                workspaceSlug={slug}
                taskId={task.id}
                fields={fields.fields}
                people={mentionable}
                canEdit={fields.canEdit}
                manageHref={fieldsHref}
              />
            </section>

            {can.archive || can.delete ? (
              <div className="flex flex-wrap gap-2 border-t pt-5">
                {can.archive ? (
                  <ArchiveTaskButton workspaceSlug={slug} taskId={task.id} listId={list.id} />
                ) : null}
                {can.delete ? (
                  <DeleteTaskButton workspaceSlug={slug} taskId={task.id} taskRef={taskRef} />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <TaskSidePanel
          tabs={[
            {
              key: "activity",
              label: "Activity",
              count: commentCount,
              content: (
                <CommentsSection
                  workspaceSlug={slug}
                  taskId={task.id}
                  threads={comments.threads}
                  members={mentionable}
                  canComment={comments.can.comment}
                  canAttach={comments.can.attach}
                  events={events}
                  layout="panel"
                />
              ),
            },
            {
              key: "relations",
              label: "Relationships",
              count: dependencies.blockedBy.length + dependencies.blocking.length,
              content: (
                <div className="overflow-y-auto p-4">
                  <DependenciesPanel
                    workspaceSlug={slug}
                    taskId={task.id}
                    blockedBy={dependencies.blockedBy}
                    blocking={dependencies.blocking}
                    canEdit={dependencies.canEdit}
                  />
                </div>
              ),
            },
            {
              key: "files",
              label: "Files",
              count: attachments.length,
              content: (
                <div className="overflow-y-auto p-4">
                  <AttachmentsPanel
                    workspaceSlug={slug}
                    taskId={task.id}
                    files={attachments}
                    canUpload={can.attach}
                    maxMb={Math.floor(env().MAX_UPLOAD_BYTES / (1024 * 1024))}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
