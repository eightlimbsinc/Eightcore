import Link from "next/link";
import { CalendarDays, ChevronRight, Columns3, List, Settings2 } from "lucide-react";
import { viewQuery, type ViewSettings } from "@/modules/lists/view-settings";
import { filterQuery, type TaskFilter } from "@/modules/tasks/filters";
import { PageHeader } from "@/components/app/page-header";
import { AppearancePicker } from "@/components/app/appearance-picker";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/tasks/filter-bar";
import { AddTaskButton } from "@/components/tasks/add-task-button";
import { ViewMenu } from "@/components/lists/view-menu";
import { cn } from "@/lib/utils";

/** Header shared by a list's List and Board pages: breadcrumbs, layout tabs, view menu, filters. */
export function ListHeader({
  slug,
  layout,
  list,
  project,
  folder,
  counts,
  view,
  savedView,
  filter,
  savedFilter,
  filtering,
  can,
  statuses,
  people,
  tagNames,
}: {
  slug: string;
  layout: "list" | "board" | "calendar";
  list: { id: string; name: string; viewProtected: boolean; icon: string | null; color: string | null };
  project: { key: string; name: string };
  folder: { name: string } | null;
  counts: { shown: number; total: number };
  view: ViewSettings;
  savedView: ViewSettings;
  filter: TaskFilter;
  savedFilter: TaskFilter;
  filtering: boolean;
  can: { manage: boolean; saveView: boolean; protectView: boolean; createTask: boolean };
  /** For "Add task". */
  statuses: { id: string; name: string }[];
  people: { userId: string; name: string }[];
  tagNames: string[];
}) {
  const listPath = `/w/${slug}/l/${list.id}`;
  const changes = filterQuery(filter, savedFilter).toString();
  // Switching layout keeps the view options and filters.
  const query = viewQuery(view, savedView, changes);
  const tabs = [
    { key: "list", label: "List", icon: List, href: `${listPath}${query}` },
    { key: "board", label: "Board", icon: Columns3, href: `${listPath}/board${query}` },
    { key: "calendar", label: "Calendar", icon: CalendarDays, href: `${listPath}/calendar${query}` },
  ] as const;
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
        title={
          <span className="flex items-center gap-2.5">
            <AppearancePicker
              workspaceSlug={slug}
              kind="list"
              id={list.id}
              name={list.name}
              appearance={list}
              canEdit={can.manage}
              size="md"
            />
            {list.name}
          </span>
        }
        description={
          filtering
            ? `${counts.shown} of ${counts.total} tasks match`
            : `${counts.shown} ${counts.shown === 1 ? "task" : "tasks"}`
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
              filterChanges={changes}
              layout={layout}
            />
            {can.manage ? (
              <Button asChild variant="outline">
                <Link href={`${listPath}/statuses`}>
                  <Settings2 /> List settings & statuses
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 px-8 pt-4">
        <nav aria-label="Layout" className="flex gap-1 border-b">
          {tabs.map(({ key, label, icon: Icon, href }) => (
            <Link
              key={key}
              href={href}
              aria-current={layout === key ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px]",
                layout === key
                  ? "border-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              <Icon className="size-4" aria-hidden /> {label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <FilterBar
              path={layout === "list" ? listPath : `${listPath}/${layout}`}
              filter={filter}
              defaults={savedFilter}
              extraQuery={viewQuery(view, savedView).replace(/^\?/, "")}
              people={people}
              tags={tagNames}
            />
          </div>
          {can.createTask ? (
            <AddTaskButton workspaceSlug={slug} listId={list.id} listName={list.name} statuses={statuses} />
          ) : null}
        </div>
      </div>
    </>
  );
}
