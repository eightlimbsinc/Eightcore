"use client";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteDocAction } from "@/modules/docs/actions";

export function DeleteDocButton({
  workspaceSlug,
  projectKey,
  docId,
  parentId,
  title,
  hasChildren,
}: {
  workspaceSlug: string;
  projectKey: string;
  docId: string;
  parentId: string | null;
  title: string;
  hasChildren: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label="Delete doc"
      title="Delete doc"
      disabled={pending}
      className="hover:text-destructive grid size-7 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
      onClick={() => {
        const name = title || "Untitled";
        const note = hasChildren ? " Its sub-pages are deleted too." : "";
        if (!confirm(`Delete “${name}”? This can't be undone.${note}`)) return;
        startTransition(async () => {
          const r = await deleteDocAction(workspaceSlug, projectKey, docId, parentId);
          if (r && !r.ok) alert(r.message);
        });
      }}
    >
      <Trash2 className="size-4" />
    </button>
  );
}
