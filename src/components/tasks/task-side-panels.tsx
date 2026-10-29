"use client";
import { useActionState, useOptimistic, useState, useTransition } from "react";
import { Popover } from "radix-ui";
import {
  Bell,
  BellOff,
  Check,
  Download,
  FileText,
  Paperclip,
  Plus,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import { setWatchingAction } from "@/modules/tasks/actions";
import { createTagAction, setTaskTagsAction } from "@/modules/tags/actions";
import { deleteAttachmentAction, uploadAttachmentsAction } from "@/modules/attachments/actions";
import { TAG_COLORS } from "@/modules/tags/validators";
import { formatBytes, isPreviewableImage } from "@/lib/file-format";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { TagChip } from "./task-bits";

interface Tag {
  id: string;
  name: string;
  color: string;
}

function InlineStatus({ state }: { state: { ok: boolean; message?: string } | undefined }) {
  if (!state?.message) return null;
  return (
    <span role="status" className={state.ok ? "text-success text-[12px]" : "text-destructive text-[12px]"}>
      {state.message}
    </span>
  );
}

export function WatchButton({
  workspaceSlug,
  taskId,
  watching,
  watcherNames,
}: {
  workspaceSlug: string;
  taskId: string;
  watching: boolean;
  watcherNames: string[];
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-2">
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-pressed={watching}
          onClick={() =>
            startTransition(async () => void (await setWatchingAction(workspaceSlug, taskId, !watching)))
          }
        >
          {watching ? <BellOff /> : <Bell />} {watching ? "Stop watching" : "Watch"}
        </Button>
      </div>
      <p className="text-muted-foreground text-[12px]">
        {watcherNames.length ? `Watching: ${watcherNames.join(", ")}` : "Nobody is watching this task."}
      </p>
    </div>
  );
}

/**
 * The task's tags as chips; click to open a picker. Search the project's tags, tick or
 * untick (saved straight away), or type a new name to create it (tag managers).
 */
export function TagsPanel({
  workspaceSlug,
  projectId,
  taskId,
  projectTags,
  taskTagIds,
  canEdit,
  canManage,
}: {
  workspaceSlug: string;
  projectId: string;
  taskId: string;
  projectTags: Tag[];
  taskTagIds: string[];
  canEdit: boolean;
  canManage: boolean;
}) {
  const [selected, setSelected] = useOptimistic(taskTagIds);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const current = projectTags.filter((t) => selected.includes(t.id));
  const chips = current.length ? (
    <span className="flex flex-wrap gap-1">
      {current.map((t) => (
        <TagChip key={t.id} name={t.name} color={t.color} />
      ))}
    </span>
  ) : null;
  if (!canEdit) return chips ?? <span className="text-muted-foreground">Empty</span>;

  const q = query.trim();
  const shown = projectTags.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  const exact = projectTags.some((t) => t.name.toLowerCase() === q.toLowerCase());
  const save = (ids: string[]) =>
    startTransition(async () => {
      setSelected(ids);
      const form = new FormData();
      ids.forEach((id) => form.append("tag", id));
      const result = await setTaskTagsAction(workspaceSlug, taskId, undefined, form);
      setStatus(result && !result.ok ? { ok: false, message: result.message } : null);
    });
  const create = () =>
    startTransition(async () => {
      const form = new FormData();
      form.set("name", q);
      // A colour of its own, picked from the name so it stays the same.
      let hash = 0;
      for (const ch of q.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      form.set("color", TAG_COLORS[hash % TAG_COLORS.length]!);
      const result = await createTagAction(workspaceSlug, projectId, taskId, selected, undefined, form);
      setStatus(result ? { ok: result.ok, message: result.message ?? "" } : null);
      if (result?.ok) setQuery("");
    });

  return (
    <div className="grid gap-1">
      <Popover.Root onOpenChange={(open) => !open && setQuery("")}>
        <Popover.Trigger
          aria-label={`Tags: ${current.length ? current.map((t) => t.name).join(", ") : "none"}`}
          disabled={pending}
          className="hover:bg-surface-muted -mx-1.5 flex min-h-8 items-center justify-self-start rounded-md px-1.5 text-left"
        >
          {chips ?? (
            <span className="text-muted-foreground flex items-center gap-1.5 text-[13px]">
              <TagIcon className="size-3.5" aria-hidden /> Add tags
            </span>
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className="bg-surface text-foreground z-50 grid w-64 gap-1 rounded-lg border p-1.5 shadow-lg"
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && q && !exact && canManage) {
                  e.preventDefault();
                  create();
                }
              }}
              maxLength={40}
              autoFocus
              aria-label={canManage ? "Search or create tags" : "Search tags"}
              placeholder={canManage ? "Search or create…" : "Search tags…"}
              className="border-input bg-surface h-8 rounded-md border px-2 text-[13px] outline-none"
            />
            <div className="grid max-h-64 gap-0.5 overflow-y-auto" role="group" aria-label="Project tags">
              {shown.map((t) => {
                const on = selected.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    aria-label={t.name}
                    onClick={() => save(on ? selected.filter((id) => id !== t.id) : [...selected, t.id])}
                    className="hover:bg-surface-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-left"
                  >
                    <TagChip name={t.name} color={t.color} />
                    <span className="flex-1" />
                    {on ? <Check className="size-3.5" aria-hidden /> : null}
                  </button>
                );
              })}
              {projectTags.length === 0 && !q ? (
                <p className="text-muted-foreground px-2 py-1.5 text-[12px]">
                  No tags yet.{canManage ? " Type a name to create one." : ""}
                </p>
              ) : null}
              {q && !exact && canManage ? (
                <button
                  type="button"
                  onClick={create}
                  className="hover:bg-surface-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]"
                >
                  <Plus className="size-3.5" aria-hidden /> Create “{q}”
                </button>
              ) : null}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {status?.message ? (
        <span
          role="status"
          className={status.ok ? "text-success text-[12px]" : "text-destructive text-[12px]"}
        >
          {status.message}
        </span>
      ) : null}
    </div>
  );
}

export interface AttachmentItem {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploaderName: string;
  canDelete: boolean;
}

export function AttachmentList({ workspaceSlug, files }: { workspaceSlug: string; files: AttachmentItem[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!files.length) return null;
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1.5" aria-label="Attachments">
        {files.map((f) => {
          const href = `/w/${workspaceSlug}/files/${f.id}`;
          return (
            <li key={f.id} className="flex items-center gap-2.5 rounded-md border px-2 py-1.5">
              {isPreviewableImage(f.mimeType) ? (
                // eslint-disable-next-line @next/next/no-img-element -- authorised, short-lived URLs; no optimisation wanted
                <img
                  src={href}
                  alt=""
                  className="size-9 shrink-0 rounded-sm border object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="bg-surface-muted grid size-9 shrink-0 place-items-center rounded-sm">
                  <FileText className="text-muted-foreground size-4" aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener"
                  className="block truncate text-[13px] font-medium hover:underline"
                >
                  {f.originalName}
                </a>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {formatBytes(f.sizeBytes)} · {f.uploaderName}
                </span>
              </span>
              <a
                href={`${href}?download`}
                aria-label={`Download ${f.originalName}`}
                className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-sm"
              >
                <Download className="size-3.5" />
              </a>
              {f.canDelete ? (
                <button
                  type="button"
                  aria-label={`Delete ${f.originalName}`}
                  disabled={pending}
                  className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-sm"
                  onClick={() => {
                    if (!confirm(`Delete “${f.originalName}”? This can't be undone.`)) return;
                    startTransition(async () => {
                      const result = await deleteAttachmentAction(workspaceSlug, f.id);
                      setError(result && !result.ok ? result.message : null);
                    });
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}

export function AttachmentsPanel({
  workspaceSlug,
  taskId,
  files,
  canUpload,
  maxMb,
}: {
  workspaceSlug: string;
  taskId: string;
  files: AttachmentItem[];
  canUpload: boolean;
  maxMb: number;
}) {
  const [state, action, pending] = useActionState(
    uploadAttachmentsAction.bind(null, workspaceSlug, taskId),
    undefined,
  );
  return (
    <div className="grid gap-3">
      {files.length ? (
        <AttachmentList workspaceSlug={workspaceSlug} files={files} />
      ) : (
        <p className="text-muted-foreground">No files attached.</p>
      )}
      {canUpload ? (
        <form action={action} className="grid gap-2 border-t pt-3">
          <label htmlFor="task-files" className="flex items-center gap-1.5 text-[12px] font-medium">
            <Paperclip className="size-3.5" aria-hidden /> Attach files (up to {maxMb} MB each)
          </label>
          <input
            suppressHydrationWarning
            id="task-files"
            type="file"
            name="files"
            multiple
            required
            className="file:border-input file:bg-surface text-[12px] file:mr-2 file:rounded-md file:border file:px-2 file:py-1"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {pending ? "Uploading…" : "Upload"}
            </Button>
            <InlineStatus state={state} />
          </div>
        </form>
      ) : null}
    </div>
  );
}
