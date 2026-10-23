"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ContextMenu, DropdownMenu } from "radix-ui";
import { Archive, Copy, ExternalLink, Hash, MoreHorizontal, PanelTop, Trash2 } from "lucide-react";
import { archiveTaskFromListAction, deleteTaskAction } from "@/modules/tasks/actions";
import { cn } from "@/lib/utils";

export interface TaskMenuTarget {
  workspaceSlug: string;
  taskId: string;
  /** e.g. "WEB-12" */
  taskRef: string;
  title: string;
  canArchive: boolean;
  canDelete: boolean;
}

type Kit = typeof ContextMenu | typeof DropdownMenu;

const contentClass =
  "bg-surface text-foreground z-50 min-w-52 overflow-hidden rounded-md border p-1 text-sm shadow-lg shadow-black/5";
const itemClass =
  "data-[highlighted]:bg-surface-muted [&_svg]:text-muted-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none select-none [&_svg]:size-4";

function useTaskMenu(target: TaskMenuTarget) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `/w/${target.workspaceSlug}/t/${target.taskRef}`;
  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  return {
    pending,
    open: () => router.push(href),
    openInNewTab: () => window.open(href, "_blank", "noopener"),
    copyLink: () => copy(new URL(href, window.location.origin).toString()),
    copyId: () => copy(target.taskRef),
    archive: () => {
      if (
        !confirm(
          `Archive ${target.taskRef} “${target.title}”? It disappears from the list but keeps its history.`,
        )
      )
        return;
      startTransition(async () => {
        const result = await archiveTaskFromListAction(target.workspaceSlug, target.taskId);
        if (result && !result.ok) alert(result.message);
      });
    },
    remove: () => {
      if (
        !confirm(
          `Delete ${target.taskRef} “${target.title}” permanently?\n\nIts subtasks, comments and files are deleted too. This can't be undone. (Archive keeps it instead.)`,
        )
      )
        return;
      startTransition(async () => {
        const result = await deleteTaskAction(target.workspaceSlug, target.taskId, false);
        if (result && !result.ok) alert(result.message);
      });
    },
  };
}

function MenuItems({ kit, target }: { kit: Kit; target: TaskMenuTarget }) {
  const m = useTaskMenu(target);
  const Item = kit.Item;
  const Separator = kit.Separator;
  return (
    <>
      <Item className={itemClass} onSelect={m.open}>
        <PanelTop /> Open
      </Item>
      <Item className={itemClass} onSelect={m.openInNewTab}>
        <ExternalLink /> Open in new tab
      </Item>
      <Item className={itemClass} onSelect={m.copyLink}>
        <Copy /> Copy link
      </Item>
      <Item className={itemClass} onSelect={m.copyId}>
        <Hash /> Copy ID ({target.taskRef})
      </Item>
      {target.canArchive || target.canDelete ? <Separator className="bg-border -mx-1 my-1 h-px" /> : null}
      {target.canArchive ? (
        <Item className={itemClass} disabled={m.pending} onSelect={m.archive}>
          <Archive /> Archive
        </Item>
      ) : null}
      {target.canDelete ? (
        <Item
          className={cn(itemClass, "text-destructive [&_svg]:text-destructive")}
          disabled={m.pending}
          onSelect={m.remove}
        >
          <Trash2 /> Delete
        </Item>
      ) : null}
    </>
  );
}

/** Right-click anywhere on the row for the task menu. */
export function TaskContextMenu({ target, children }: { target: TaskMenuTarget; children: React.ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={contentClass} aria-label={`Actions for ${target.taskRef}`}>
          <MenuItems kit={ContextMenu} target={target} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** The same menu from a "⋯" button (touch screens, keyboard). Shown on row hover. */
export function TaskMenuButton({ target }: { target: TaskMenuTarget }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Task actions for ${target.taskRef}`}
        className="text-muted-foreground hover:text-foreground grid size-6 place-items-center rounded-sm opacity-100 hover:bg-black/5 data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 dark:hover:bg-white/10"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={contentClass}>
          <MenuItems kit={DropdownMenu} target={target} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Delete button for the task page. */
export function DeleteTaskButton({
  workspaceSlug,
  taskId,
  taskRef,
}: {
  workspaceSlug: string;
  taskId: string;
  taskRef: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            `Delete ${taskRef} permanently? Its subtasks, comments and files are deleted too. This can't be undone.`,
          )
        )
          return;
        startTransition(async () => {
          const result = await deleteTaskAction(workspaceSlug, taskId, true);
          if (result && !result.ok) alert(result.message);
        });
      }}
      className="text-destructive border-destructive/40 hover:bg-destructive-soft inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm disabled:opacity-60 [&_svg]:size-4"
    >
      <Trash2 /> {pending ? "Deleting…" : "Delete task"}
    </button>
  );
}
