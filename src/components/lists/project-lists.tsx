import Link from "next/link";
import type { ItemAppearance } from "@/lib/appearance";
import { ItemIcon } from "@/components/app/item-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteFolderButton, NewFolderForm, NewListForm } from "./list-forms";

interface ListRow extends ItemAppearance {
  id: string;
  name: string;
  openTasks: number;
}

interface Tree {
  folders: (ItemAppearance & { id: string; name: string; lists: ListRow[] })[];
  rootLists: ListRow[];
  can: { manage: boolean };
}

function ListLink({ workspaceSlug, list }: { workspaceSlug: string; list: ListRow }) {
  return (
    <li>
      <Link
        href={`/w/${workspaceSlug}/l/${list.id}`}
        className="hover:bg-surface-muted flex items-center gap-2.5 rounded-md px-2 py-1.5"
      >
        <ItemIcon kind="list" appearance={list} name={list.name} />
        <span className="flex-1 truncate font-medium">{list.name}</span>
        <span className="text-muted-foreground text-[12px] tabular-nums">{list.openTasks} open</span>
      </Link>
    </li>
  );
}

export function ProjectLists({
  workspaceSlug,
  projectId,
  tree,
  statusTemplates = [],
}: {
  workspaceSlug: string;
  projectId: string;
  tree: Tree;
  /** Saved workspace templates, offered when creating a list. */
  statusTemplates?: { id: string; name: string; statuses: { name: string }[] }[];
}) {
  const empty = tree.folders.length === 0 && tree.rootLists.length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lists</CardTitle>
        <CardDescription>
          Organise work into lists, optionally grouped in folders. Each list has its own statuses.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {empty ? (
          <p className="text-muted-foreground">
            {tree.can.manage ? "No lists yet. Create the first one below." : "No lists yet."}
          </p>
        ) : (
          <div className="grid gap-4">
            {tree.folders.map((folder) => (
              <section key={folder.id} className="grid gap-1">
                <div className="flex items-center gap-2 px-2">
                  <ItemIcon kind="folder" appearance={folder} name={folder.name} />
                  <h3 className="flex-1 text-[13px] font-semibold">{folder.name}</h3>
                  {tree.can.manage ? (
                    <DeleteFolderButton
                      workspaceSlug={workspaceSlug}
                      folderId={folder.id}
                      name={folder.name}
                    />
                  ) : null}
                </div>
                {folder.lists.length ? (
                  <ul className="ml-4 grid gap-0.5 border-l pl-2">
                    {folder.lists.map((l) => (
                      <ListLink key={l.id} workspaceSlug={workspaceSlug} list={l} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground ml-6 text-[12px]">Empty folder</p>
                )}
              </section>
            ))}
            {tree.rootLists.length ? (
              <ul className="grid gap-0.5">
                {tree.rootLists.map((l) => (
                  <ListLink key={l.id} workspaceSlug={workspaceSlug} list={l} />
                ))}
              </ul>
            ) : null}
          </div>
        )}
        {tree.can.manage ? (
          <div className="grid gap-5 border-t pt-5">
            <NewListForm
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              folders={tree.folders}
              savedTemplates={statusTemplates}
            />
            <NewFolderForm workspaceSlug={workspaceSlug} projectId={projectId} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
