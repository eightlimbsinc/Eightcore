"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { ChevronDown, ChevronUp } from "lucide-react";
import { safeHref } from "@/modules/docs/content";
import { BlockMenu, Toolbar } from "@/components/editor/rich-text";
import { cn } from "@/lib/utils";

const COLLAPSED_PX = 200;

/**
 * A task description in rich text: headings (H1–H4), bullets, numbering, checklists, quotes,
 * links. It's stored as Markdown (what ClickUp's import and older descriptions already use), so
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
}: {
  id: string;
  name: string;
  defaultValue: string;
  disabled?: boolean;
  placeholder?: string;
  form?: string;
}) {
  const [markdown, setMarkdown] = useState(defaultValue);
  const [expanded, setExpanded] = useState(false);
  const [tall, setTall] = useState(false);
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);

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
        {editor && !disabled ? <Toolbar editor={editor} levels={[1, 2, 3, 4]} className="px-1" /> : null}
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
