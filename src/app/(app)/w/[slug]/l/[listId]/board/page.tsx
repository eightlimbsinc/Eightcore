import type { Metadata } from "next";
import { getListView } from "@/modules/lists/queries";
import { canProject } from "@/server/authz/policy";
import { ListHeader } from "@/components/lists/list-header";
import { Board } from "@/components/tasks/board";

export const metadata: Metadata = { title: "Board" };

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; listId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, listId } = await params;
  const data = await getListView(slug, listId, await searchParams);
  const { user, list, project, tasks, role, can, ordered, topLevel, allTopLevel, today } = data;
  const own = (createdBy: string) => createdBy === user.id;

  return (
    <>
      <ListHeader
        slug={slug}
        layout="board"
        list={list}
        project={project}
        folder={data.folder}
        counts={{ shown: topLevel.length, total: allTopLevel.length }}
        view={data.view}
        savedView={data.savedView}
        filter={data.filter}
        savedFilter={data.savedFilter}
        filtering={data.filtering}
        can={can}
        statuses={data.statuses}
        people={data.people.map((p) => ({ userId: p.userId, name: p.name }))}
        tagNames={[...new Set(tasks.flatMap((t) => t.tags.map((g) => g.name)))].sort()}
      />
      <div className="px-8 py-5">
        <Board
          workspaceSlug={slug}
          listId={list.id}
          statuses={ordered}
          today={today}
          canEdit={can.updateTask}
          canCreate={can.createTask}
          tasks={topLevel.map((t) => ({
            id: t.id,
            ref: `${project.key}-${t.number}`,
            title: t.title,
            version: t.version,
            statusId: t.statusId,
            priority: t.priority,
            dueDate: t.dueDate,
            completed: Boolean(t.completedAt),
            assignees: t.assignees,
            tags: t.tags,
            subtaskCount: t.subtaskCount,
            openBlockers: t.openBlockers,
            canArchive:
              canProject(role, "task.archive") || (own(t.createdBy) && canProject(role, "task.archive_own")),
            canDelete:
              canProject(role, "task.delete") || (own(t.createdBy) && canProject(role, "task.delete_own")),
          }))}
        />
      </div>
    </>
  );
}
