"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { FileText, Plus } from "lucide-react";
import { createDocAction } from "@/modules/docs/actions";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

type Doc = {
  id: string;
  title: string;
  parentId: string | null;
  listName: string | null;
  updatedAt: Date;
  updatedByName: string | null;
};

/** "New doc" (in a list, when the person may only work in some lists). */
export function NewDocButton({
  workspaceSlug,
  projectKey,
  projectId,
  parentId = null,
  lists = [],
  mustPickList = false,
  label = "New doc",
  variant = "default",
}: {
  workspaceSlug: string;
  projectKey: string;
  projectId: string;
  parentId?: string | null;
  lists?: { id: string; name: string }[];
  mustPickList?: boolean;
  label?: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [listId, setListId] = useState<string>(mustPickList ? (lists[0]?.id ?? "") : "");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {!parentId && lists.length ? (
        <NativeSelect
          aria-label="Doc belongs to"
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          className="h-9 w-auto"
        >
          {mustPickList ? null : <option value="">Whole project</option>}
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
      ) : null}
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await createDocAction(workspaceSlug, projectKey, projectId, {
              parentId,
              listId: parentId ? undefined : listId || null,
            });
            setError(r && !r.ok ? r.message : null);
          })
        }
      >
        <Plus /> {label}
      </Button>
    </div>
  );
}

/** The project's docs as an outline: top-level docs with their sub-pages indented. */
export function DocTree({ base, docs }: { base: string; docs: Doc[] }) {
  const children = (id: string | null) => docs.filter((d) => d.parentId === id);
  const render = (items: Doc[], depth: number): React.ReactNode =>
    items.map((d) => (
      <li key={d.id}>
        <Link
          href={`${base}/${d.id}`}
          className="hover:bg-surface-muted flex items-center gap-2 rounded-md px-2 py-1.5"
          style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
        >
          <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{d.title || "Untitled"}</span>
          {d.listName ? (
            <span className="text-muted-foreground shrink-0 text-[12px]">{d.listName}</span>
          ) : null}
          <span className="text-muted-foreground hidden shrink-0 text-[12px] sm:inline">
            {d.updatedByName ? `${d.updatedByName} · ` : ""}
            {new Date(d.updatedAt).toLocaleDateString()}
          </span>
        </Link>
        {children(d.id).length ? <ul>{render(children(d.id), depth + 1)}</ul> : null}
      </li>
    ));
  if (!docs.length) return <p className="text-muted-foreground text-[13px]">No docs yet.</p>;
  return <ul className="grid gap-0.5">{render(children(null), 0)}</ul>;
}
