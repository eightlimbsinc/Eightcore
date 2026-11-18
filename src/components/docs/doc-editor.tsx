"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { BlockMenu, Toolbar } from "@/components/editor/rich-text";
import { saveDocAction } from "@/modules/docs/actions";
import { safeHref } from "@/modules/docs/content";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SAVE_DELAY = 800;

type Status =
  { kind: "saved"; at: string } | { kind: "dirty" } | { kind: "saving" } | { kind: "error"; message: string };

function hasBlocks(content: unknown) {
  const blocks = (content as { content?: unknown[] } | null)?.content;
  return Array.isArray(blocks) && blocks.length > 0;
}

function savedLabel(at: string) {
  const d = new Date(at);
  return `Saved ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * The doc: title and rich text, saved automatically a moment after you stop typing.
 * Saves carry the version they started from, so two people can't silently overwrite each other.
 */
export function DocEditor({
  workspaceSlug,
  doc,
  canEdit,
}: {
  workspaceSlug: string;
  doc: { id: string; title: string; content: unknown; version: number; updatedAt: Date | string };
  canEdit: boolean;
}) {
  const [title, setTitle] = useState(doc.title);
  const [status, setStatus] = useState<Status>({ kind: "saved", at: new Date(doc.updatedAt).toISOString() });
  const [conflict, setConflict] = useState(false);
  const version = useRef(doc.version);
  const pending = useRef<{ title?: string; content?: string }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const conflicted = useRef(false);
  const hasPending = () => pending.current.title !== undefined || pending.current.content !== undefined;

  /** Sends what's waiting, one save at a time, until nothing is left (or a save fails). */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current || conflicted.current) return;
    inFlight.current = true;
    while (hasPending() && !conflicted.current) {
      const patch = pending.current;
      pending.current = {};
      setStatus({ kind: "saving" });
      const result = await saveDocAction(workspaceSlug, doc.id, version.current, patch);
      if (result.ok) {
        version.current = result.version;
        if (!hasPending()) setStatus({ kind: "saved", at: result.savedAt });
      } else {
        // Keep what wasn't saved, so the next try includes it.
        pending.current = { ...patch, ...pending.current };
        if (result.conflict) {
          conflicted.current = true;
          setConflict(true);
        }
        setStatus({ kind: "error", message: result.message });
        break;
      }
    }
    inFlight.current = false;
  }, [workspaceSlug, doc.id]);

  const queue = useCallback(
    (patch: { title?: string; content?: string }) => {
      pending.current = { ...pending.current, ...patch };
      setStatus({ kind: "dirty" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY);
    },
    [flush],
  );

  // Built once: new extension objects on every render would make Tiptap rebuild the editor.
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: {
          openOnClick: !canEdit,
          autolink: true,
          protocols: ["mailto"],
          isAllowedUri: (url) => safeHref(url) !== null,
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: canEdit ? "Write something, or use the toolbar…" : "" }),
    ],
    [canEdit],
  );
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: canEdit,
      // A new doc's stored content has no blocks; let the editor start from one empty line
      // (an empty document starts with everything selected, and typing would replace it all).
      content: hasBlocks(doc.content) ? (doc.content as object) : "<p></p>",
      extensions,
      editorProps: { attributes: { class: "doc-content", "aria-label": "Doc content" } },
      // Sent as text: the editor's objects aren't plain enough to pass to the server as they are.
      onUpdate: ({ editor: e }) => queueRef.current({ content: JSON.stringify(e.getJSON()) }),
    },
    [doc.id, extensions],
  );

  // Save before leaving; warn if that can't happen in time.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (hasPending() || inFlight.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      void flush();
    };
  }, [flush]);

  return (
    <div className="grid gap-3">
      {conflict ? (
        <Alert variant="destructive" className="flex items-center justify-between gap-3">
          <span>
            Someone else changed this doc while you were editing. Your latest changes aren&apos;t saved.
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </Alert>
      ) : null}
      <div className="flex items-center gap-3">
        <input
          aria-label="Doc title"
          value={title}
          readOnly={!canEdit}
          maxLength={200}
          placeholder="Untitled"
          onChange={(e) => {
            setTitle(e.target.value);
            queue({ title: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor?.commands.focus("start");
            }
          }}
          className="placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-tight outline-none"
        />
        {canEdit ? (
          <span
            role="status"
            aria-live="polite"
            className={cn(
              "shrink-0 text-[12px] tabular-nums",
              status.kind === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {status.kind === "saved"
              ? savedLabel(status.at)
              : status.kind === "saving"
                ? "Saving…"
                : status.kind === "dirty"
                  ? "Unsaved changes"
                  : status.message}
          </span>
        ) : null}
      </div>
      <div className="bg-surface rounded-lg border">
        {canEdit && editor ? (
          <Toolbar
            editor={editor}
            levels={[1, 2, 3, 4]}
            className="bg-surface/95 sticky top-0 z-10 backdrop-blur"
          />
        ) : null}
        <div className="relative" data-block-menu-box>
          {canEdit && editor ? <BlockMenu editor={editor} levels={[1, 2, 3, 4]} /> : null}
          <EditorContent editor={editor} className="min-h-[50vh] px-8 py-5" />
        </div>
      </div>
    </div>
  );
}
