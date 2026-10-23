import "server-only";
import { effectiveView } from "./view-settings";
import { isClosedCategory } from "./templates";
import { isFiltering, matchesFilter, readFilter } from "@/modules/tasks/filters";
import { viewerToday } from "@/server/today";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { listAssignableMembers, listTasks } from "@/modules/tasks/service";
import { tagsForTasks } from "@/modules/tags/service";
import { openBlockerCounts } from "@/modules/dependencies/service";
import { fieldValuesForTasks } from "@/modules/fields/service";
import { db } from "@/server/db";
import { getList, getProjectTree } from "./service";

export async function getListPage(slug: string, listId: string) {
  const { user, actor } = await getWorkspaceContext(slug);
  try {
    const [detail, tasks] = await Promise.all([getList(actor, listId), listTasks(actor, listId)]);
    if (detail.list.archivedAt) notFound();
    // listTasks has checked access to this list, so its task ids are safe to look up.
    const ids = tasks.map((t) => t.id);
    const [tags, blockers, fields, people] = await Promise.all([
      tagsForTasks(db(), ids),
      openBlockerCounts(db(), actor, ids),
      fieldValuesForTasks(db(), ids),
      listAssignableMembers(actor, detail.list.projectId),
    ]);
    return {
      user,
      actor,
      ...detail,
      people,
      tasks: tasks.map((t) => ({
        ...t,
        tags: tags.get(t.id) ?? [],
        openBlockers: blockers.get(t.id) ?? 0,
        fields: fields.get(t.id) ?? [],
      })),
    };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function getProjectTreeForPage(slug: string, projectId: string) {
  const { actor } = await getWorkspaceContext(slug);
  return getProjectTree(actor, projectId);
}

/**
 * A list page's data with its view applied: the saved view and filters, overridden by the
 * address bar, then which tasks show (a parent shows when a subtask matches) and the
 * status groups in view order. Shared by the list and board pages.
 */
export async function getListView(
  slug: string,
  listId: string,
  query: Record<string, string | string[] | undefined>,
) {
  const data = await getListPage(slug, listId);
  const { user, project, statuses, tasks, view: savedView } = data;
  // The saved view, with any changes from the address bar on top.
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
  return {
    ...data,
    view,
    savedView,
    savedFilter,
    filter,
    filtering,
    today,
    ordered,
    allTopLevel,
    topLevel,
    groups,
    shown,
  };
}
