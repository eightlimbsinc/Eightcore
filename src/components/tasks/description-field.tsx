"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { moveFilesToStorage, UploadError } from "@/lib/direct-upload";
import { startTaskUploadsAction, uploadDescriptionImageAction } from "@/modules/attachments/actions";
import { notify } from "@/components/app/toast";
import { safeHref } from "@/modules/docs/content";
import { BlockMenu, Toolbar } from "@/components/editor/rich-text";
import { cn } from "@/lib/utils";

const COLLAPSED_PX = 200;

/**
 * A task description in rich text: headings (H1–H4), bullets, numbering, checklists, quotes,
 * links, and images pasted, dropped or added with the toolbar (stored as the task's files). It's
 * stored as Markdown (what ClickUp's import and older descriptions already use), so
 * search, webhooks and forms keep working with plain text. Shows its first lines with "Expand"
 * (like ClickUp) and grows to fit while editing.
 */
export function DescriptionField({
  id,
  name,
  defaultValue,
  disabled,
  placeholder,
  form,
  images,
}: {
  id: string;
  name: string;
  defaultValue: string;
  disabled?: boolean;
  placeholder?: string;
  form?: string;
  /** Where pasted images go (the task's files); without it images can't be added. */
  images?: { workspaceSlug: string; taskId: string };
}) {
  const [markdown, setMarkdown] = useState(defaultValue);
  const [expanded, setExpanded] = useState(false);
  const [tall, setTall] = useState(false);
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);

  // Built once: new extension objects on every render would make Tiptap rebuild the editor.
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: {
          openOnClick: Boolean(disabled),
          autolink: true,
          protocols: ["mailto"],
          isAllowedUri: (url) => safeHref(url) !== null,
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder ?? "", showOnlyWhenEditable: false }),
      Image.configure({
        allowBase64: false,
        HTMLAttributes: { class: "description-image", loading: "lazy" },
      }),
      Markdown,
    ],
    [disabled, placeholder],
  );
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !disabled,
      content: defaultValue || "",
      contentType: "markdown",
      extensions,
      editorProps: {
        // Screenshots pasted or dropped in upload as the task's files and show where they landed.
        handlePaste: (_view, event) => addImages([...(event.clipboardData?.files ?? [])]),
        handleDrop: (_view, event) => addImages([...((event as DragEvent).dataTransfer?.files ?? [])]),
        attributes: {
          id,
          class: "doc-content description-content",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": "Description",
        },
      },
      onUpdate: ({ editor: e }) => setMarkdown(e.isEmpty ? "" : e.getMarkdown()),
      onFocus: () => {
        setFocused(true);
        setExpanded(true); // editing shows everything
      },
      onBlur: () => setFocused(false),
    },
    [extensions],
  );

  // Uploads each image, then puts it in the description at the cursor.
  const upload = async (file: File) => {
    if (!images || !editor) return;
    setUploading((n) => n + 1);
    try {
      const form = new FormData();
      form.append("files", file, file.name || "pasted-image.png");
      const data = await moveFilesToStorage(form, "files", (meta) =>
        startTaskUploadsAction(images.workspaceSlug, images.taskId, meta),
      );
      const result = await uploadDescriptionImageAction(images.workspaceSlug, images.taskId, data);
      if (!result.ok) notify(result.message);
      else
        editor
          .chain()
          .focus()
          .setImage({ src: `/w/${images.workspaceSlug}/files/${result.id}`, alt: result.name })
          .run();
    } catch (error) {
      notify(error instanceof UploadError ? error.message : "Couldn't add the image. Please try again.");
    } finally {
      setUploading((n) => n - 1);
    }
  };
  const uploadRef = useRef(upload);
  useEffect(() => {
    uploadRef.current = upload;
  });
  /** Takes the image files out of a paste or drop (true: handled here). */
  function addImages(files: File[]) {
    const pics = files.filter((f) => f.type.startsWith("image/"));
    if (!pics.length) return false;
    if (!images) {
      notify("Images can be added once the task is saved.");
      return true;
    }
    pics.forEach((f) => void uploadRef.current(f));
    return true;
  }

  // Whether the text is longer than the collapsed height (re-checked as it changes).
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(".description-content");
    if (!el) return;
    const check = () => setTall(el.scrollHeight > COLLAPSED_PX + 24);
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [editor]);

  const clipped = !expanded && tall;
  return (
    <div className="grid gap-1">
      <input type="hidden" name={name} form={form} value={markdown} />
      <div
        className={cn(
          "border-input bg-surface rounded-md border",
          focused && "ring-ring/40 ring-2",
          disabled && "opacity-90",
        )}
      >
        {editor && !disabled ? (
          <Toolbar
            editor={editor}
            levels={[1, 2, 3, 4]}
            className="px-1"
            onImage={images ? () => picker.current?.click() : undefined}
          />
        ) : null}
        {images ? (
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              addImages([...(e.currentTarget.files ?? [])]);
              e.currentTarget.value = "";
            }}
          />
        ) : null}
        {uploading > 0 ? (
          <p role="status" className="text-muted-foreground flex items-center gap-1.5 px-3 pt-2 text-[12px]">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Uploading {uploading === 1 ? "image" : `${uploading} images`}…
          </p>
        ) : null}
        <div ref={box} className="relative" data-block-menu-box>
          {editor && !disabled ? <BlockMenu editor={editor} levels={[1, 2, 3, 4]} /> : null}
          <div
            className={cn("py-2 pr-3 text-sm", disabled ? "pl-3" : "pl-8", clipped && "overflow-hidden")}
            style={clipped ? { maxHeight: COLLAPSED_PX } : undefined}
          >
            <EditorContent editor={editor} />
          </div>
          {clipped ? (
            <div
              aria-hidden
              className="from-surface pointer-events-none absolute inset-x-px bottom-px h-12 rounded-b-md bg-gradient-to-t to-transparent"
            />
          ) : null}
        </div>
      </div>
      {tall ? (
        <div className="flex justify-center">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground hover:text-foreground hover:bg-surface-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-[12px]"
          >
            {expanded ? (
              <ChevronUp className="size-3.5" aria-hidden />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden />
            )}
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
