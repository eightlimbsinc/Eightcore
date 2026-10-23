"use client";
import { useActionState, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FolderPlus, ListPlus, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import {
  createFolderAction,
  createListAction,
  deleteFolderAction,
  deleteListAction,
  renameFolderAction,
  renameListAction,
} from "@/modules/lists/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** What the sidebar is currently editing inline. */
export type TreeEdit =
  | { kind: "new-list"; projectId: string; folderId: string | null }
  | { kind: "new-folder"; projectId: string }
  | { kind: "rename-folder"; folderId: string; name: string }
  | { kind: "rename-list"; listId: string; name: string };

const triggerClass =
  "text-muted-foreground hover:text-foreground grid size-6 shrink-0 place-items-center rounded-sm hover:bg-black/5 data-[state=open]:bg-black/5 data-[state=open]:opacity-100 dark:hover:bg-white/10 dark:data-[state=open]:bg-white/10";

/** Hidden until the row is hovered or focused (always shown on touch screens). */
const revealClass = "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100";

export function ProjectAddMenu({
  projectName,
  onPick,
}: {
  projectName: string;
  onPick: (kind: "new-list" | "new-folder") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Add to ${projectName}`} className={cn(triggerClass, revealClass)}>
        <Plus className="size-3.5" />
      </DropdownMenuTrigger>
      {/* Keep focus on the new input instead of returning it to this button. */}
      <DropdownMenuContent align="start" className="min-w-40" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem onSelect={() => onPick("new-list")}>
          <ListPlus /> New list
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick("new-folder")}>
          <FolderPlus /> New folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FolderMenu({
  workspaceSlug,
  folder,
  onPick,
}: {
  workspaceSlug: string;
  folder: { id: string; name: string; listCount: number };
  onPick: (kind: "new-list" | "rename-folder") => void;
}) {
  const [, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Folder options for ${folder.name}`}
        className={cn(triggerClass, revealClass)}
      >
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem onSelect={() => onPick("new-list")}>
          <ListPlus /> New list in folder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick("rename-folder")}>
          <Pencil /> Rename folder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive [&_svg]:text-destructive"
          onSelect={() => {
            const note = folder.listCount
              ? ` Its ${folder.listCount === 1 ? "list moves" : `${folder.listCount} lists move`} to the project, nothing is lost.`
              : "";
            if (!confirm(`Delete the folder “${folder.name}”?${note}`)) return;
            startTransition(async () => {
              const result = await deleteFolderAction(workspaceSlug, folder.id);
              if (result && !result.ok) alert(result.message);
            });
          }}
        >
          <Trash2 /> Delete folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ListMenu({
  workspaceSlug,
  projectHref,
  list,
  onPick,
}: {
  workspaceSlug: string;
  projectHref: string;
  list: { id: string; name: string };
  onPick: (kind: "rename-list") => void;
}) {
  const [, startTransition] = useTransition();
  const pathname = usePathname();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`List options for ${list.name}`}
        className={cn(triggerClass, revealClass)}
      >
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem onSelect={() => onPick("rename-list")}>
          <Pencil /> Rename list
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive [&_svg]:text-destructive"
          onSelect={() => {
            if (!confirm(`Delete the list “${list.name}” and hide its tasks?`)) return;
            const viewing = pathname.startsWith(`/w/${workspaceSlug}/l/${list.id}`);
            startTransition(async () => {
              const result = await deleteListAction(workspaceSlug, list.id);
              if (result && !result.ok) alert(result.message);
              else if (viewing) router.push(projectHref);
            });
          }}
        >
          <Trash2 /> Delete list
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One-line name input inside the tree. Enter saves, Escape cancels. */
export function InlineNameForm({
  workspaceSlug,
  edit,
  depth,
  onDone,
}: {
  workspaceSlug: string;
  edit: TreeEdit;
  depth: number;
  onDone: () => void;
}) {
  const serverAction = actionFor(workspaceSlug, edit);
  const [state, action, pending] = useActionState(serverAction, undefined);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) onDone();
  }
  const label = {
    "new-list": "New list name",
    "new-folder": "New folder name",
    "rename-folder": "Folder name",
    "rename-list": "List name",
  }[edit.kind];
  const defaultValue = edit.kind === "rename-folder" || edit.kind === "rename-list" ? edit.name : "";
  return (
    <form
      action={action}
      className="grid gap-0.5 py-0.5 pr-1"
      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
    >
      {edit.kind === "new-list" && edit.folderId ? (
        <input type="hidden" name="folderId" value={edit.folderId} />
      ) : null}
      <input
        suppressHydrationWarning
        name="name"
        aria-label={label}
        placeholder={label}
        defaultValue={defaultValue}
        required
        maxLength={100}
        autoFocus
        disabled={pending}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
        }}
        onBlur={(e) => {
          if (!pending && !e.currentTarget.value.trim()) onDone();
        }}
        className="border-input bg-surface h-7 w-full rounded-md border px-2 text-[13px]"
      />
      {state && !state.ok ? (
        <span role="alert" className="text-destructive text-[11px]">
          {state.fieldErrors?.name ?? state.message}
        </span>
      ) : (
        <span className="text-muted-foreground text-[11px]">Enter to save · Esc to cancel</span>
      )}
    </form>
  );
}

function actionFor(
  slug: string,
  edit: TreeEdit,
): (prev: ActionState, form: FormData) => Promise<ActionState> {
  switch (edit.kind) {
    case "new-list":
      return createListAction.bind(null, slug, edit.projectId);
    case "new-folder":
      return createFolderAction.bind(null, slug, edit.projectId);
    case "rename-folder":
      return renameFolderAction.bind(null, slug, edit.folderId);
    case "rename-list":
      return renameListAction.bind(null, slug, edit.listId);
  }
}
