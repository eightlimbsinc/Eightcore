"use client";
import { useActionState, useState, useTransition } from "react";
import { Bell, BellOff, Download, FileText, Paperclip, Trash2 } from "lucide-react";
import { setWatchingAction } from "@/modules/tasks/actions";
import { createTagAction, setTaskTagsAction } from "@/modules/tags/actions";
import { deleteAttachmentAction, uploadAttachmentsAction } from "@/modules/attachments/actions";
import { TAG_COLORS } from "@/modules/tags/validators";
import { formatBytes, isPreviewableImage } from "@/lib/file-format";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
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
  const [state, action, pending] = useActionState(
    setTaskTagsAction.bind(null, workspaceSlug, taskId),
    undefined,
  );
  const [createState, createAction, creating] = useActionState(
    createTagAction.bind(null, workspaceSlug, projectId, taskId, taskTagIds),
    undefined,
  );
  if (!canEdit) {
    const current = projectTags.filter((t) => taskTagIds.includes(t.id));
    return current.length ? (
      <div className="flex flex-wrap gap-1">
        {current.map((t) => (
          <TagChip key={t.id} name={t.name} color={t.color} />
        ))}
      </div>
    ) : (
      <p className="text-muted-foreground">No tags</p>
    );
  }
  return (
    <div className="grid gap-4">
      {projectTags.length ? (
        <form action={action} className="grid gap-3">
          <ul className="flex flex-wrap gap-1.5" aria-label="Project tags">
            {projectTags.map((t) => (
              <li key={t.id}>
                <label className="has-[:checked]:bg-surface-muted flex cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-1">
                  <input
                    suppressHydrationWarning
                    type="checkbox"
                    name="tag"
                    value={t.id}
                    defaultChecked={taskTagIds.includes(t.id)}
                    className="accent-[var(--accent)]"
                  />
                  <TagChip name={t.name} color={t.color} />
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save tags"}
            </Button>
            <InlineStatus state={state} />
          </div>
        </form>
      ) : (
        <p className="text-muted-foreground text-[13px]">This project has no tags yet.</p>
      )}
      {canManage ? (
        <form action={createAction} className="grid gap-2 border-t pt-3">
          <label htmlFor="new-tag-name" className="text-[12px] font-medium">
            New tag
          </label>
          <div className="flex gap-2">
            <Input
              id="new-tag-name"
              name="name"
              required
              maxLength={40}
              placeholder="e.g. Client feedback"
              className="h-8"
            />
            <NativeSelect
              name="color"
              aria-label="Tag colour"
              defaultValue={TAG_COLORS[6]}
              className="h-8 w-24"
            >
              {TAG_COLORS.map((c, i) => (
                <option key={c} value={c}>
                  {["Slate", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Violet", "Pink"][i]}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm" variant="outline" disabled={creating}>
              Add
            </Button>
          </div>
          <InlineStatus state={createState} />
        </form>
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
