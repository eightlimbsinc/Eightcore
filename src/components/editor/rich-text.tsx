"use client";
// Shared pieces of the rich-text editors (Docs and task descriptions): the formatting toolbar,
// and the ⋮ menu beside the current line that turns it into a heading, list, quote…
import { useEffect, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  EllipsisVertical,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { safeHref } from "@/modules/docs/content";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type HeadingLevel = 1 | 2 | 3 | 4;
const HEADING_ICONS = { 1: Heading1, 2: Heading2, 3: Heading3, 4: Heading4 } as const;

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "text-muted-foreground hover:text-foreground grid size-8 place-items-center rounded-md hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10 [&_svg]:size-4",
        active && "text-foreground bg-black/5 dark:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}

/** The block a line can be turned into, for the toolbar's active state and the ⋮ menu. */
function blockKind(e: Editor) {
  for (const level of [1, 2, 3, 4] as const) if (e.isActive("heading", { level })) return `h${level}`;
  if (e.isActive("taskList")) return "task";
  if (e.isActive("bulletList")) return "bullet";
  if (e.isActive("orderedList")) return "ordered";
  if (e.isActive("blockquote")) return "quote";
  if (e.isActive("codeBlock")) return "code";
  return "text";
}

/** Turns the current line (block) into `kind`, undoing any list or quote it was in first. */
function turnInto(editor: Editor, kind: string) {
  let chain = editor.chain().focus();
  const current = blockKind(editor);
  if (current === kind) return;
  if (current === "bullet") chain = chain.toggleBulletList();
  if (current === "ordered") chain = chain.toggleOrderedList();
  if (current === "task") chain = chain.toggleTaskList();
  if (current === "quote") chain = chain.toggleBlockquote();
  chain = chain.setParagraph();
  if (kind.startsWith("h")) chain = chain.setHeading({ level: Number(kind.slice(1)) as HeadingLevel });
  else if (kind === "bullet") chain = chain.toggleBulletList();
  else if (kind === "ordered") chain = chain.toggleOrderedList();
  else if (kind === "task") chain = chain.toggleTaskList();
  else if (kind === "quote") chain = chain.toggleBlockquote();
  else if (kind === "code") chain = chain.toggleCodeBlock();
  chain.run();
}

export function Toolbar({
  editor,
  levels = [1, 2, 3],
  className,
  onImage,
}: {
  editor: Editor;
  levels?: HeadingLevel[];
  className?: string;
  /** Shows an "Add image" button that calls this (the editor uploads and inserts the image). */
  onImage?: () => void;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: blockKind(e),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  function setLink() {
    const current = editor.getAttributes("link").href as string | undefined;
    const input = window.prompt("Link address (leave empty to remove)", current ?? "https://");
    if (input === null) return;
    const href = safeHref(input);
    if (!input.trim() || !href) chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href }).run();
  }
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className={cn("flex flex-wrap items-center gap-0.5 border-b px-2 py-1", className)}
    >
      {levels.map((level) => {
        const Icon = HEADING_ICONS[level];
        return (
          <ToolButton
            key={level}
            label={`Heading ${level}`}
            active={s.block === `h${level}`}
            onClick={() => chain().toggleHeading({ level }).run()}
          >
            <Icon />
          </ToolButton>
        );
      })}
      <span className="bg-border mx-1 h-5 w-px" aria-hidden />
      <ToolButton label="Bold" active={s.bold} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label="Italic" active={s.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton label="Underline" active={s.underline} onClick={() => chain().toggleUnderline().run()}>
        <Underline />
      </ToolButton>
      <ToolButton label="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough />
      </ToolButton>
      <ToolButton label="Inline code" active={s.code} onClick={() => chain().toggleCode().run()}>
        <Code />
      </ToolButton>
      <ToolButton label="Add link" active={s.link} onClick={setLink}>
        <Link2 />
      </ToolButton>
      <span className="bg-border mx-1 h-5 w-px" aria-hidden />
      <ToolButton
        label="Bulleted list"
        active={s.block === "bullet"}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={s.block === "ordered"}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolButton>
      <ToolButton
        label="Checklist"
        active={s.block === "task"}
        onClick={() => chain().toggleTaskList().run()}
      >
        <ListChecks />
      </ToolButton>
      <ToolButton label="Quote" active={s.block === "quote"} onClick={() => chain().toggleBlockquote().run()}>
        <Quote />
      </ToolButton>
      <ToolButton
        label="Code block"
        active={s.block === "code"}
        onClick={() => chain().toggleCodeBlock().run()}
      >
        <SquareCode />
      </ToolButton>
      <ToolButton label="Divider" onClick={() => chain().setHorizontalRule().run()}>
        <Minus />
      </ToolButton>
      {onImage ? (
        <ToolButton label="Add image" onClick={onImage}>
          <ImagePlus />
        </ToolButton>
      ) : null}
      <span className="bg-border mx-1 h-5 w-px" aria-hidden />
      <ToolButton label="Undo" disabled={!s.canUndo} onClick={() => chain().undo().run()}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Redo" disabled={!s.canRedo} onClick={() => chain().redo().run()}>
        <Redo2 />
      </ToolButton>
    </div>
  );
}

/**
 * The ⋮ button beside the line being edited, with "Turn into": text, headings, lists, quote,
 * code. Place it inside a `relative` box that also holds the editor.
 */
export function BlockMenu({ editor, levels = [1, 2, 3] }: { editor: Editor; levels?: HeadingLevel[] }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: blockKind(e),
      focused: e.isFocused,
      from: e.state.selection.from,
    }),
  });
  const [top, setTop] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  // Line up with the top of the block the cursor is in (re-measured as the cursor moves).
  useEffect(() => {
    if (!editor.isEditable) return;
    const measure = () => {
      try {
        const box = editor.view.dom.parentElement?.closest<HTMLElement>("[data-block-menu-box]");
        const { $from } = editor.state.selection;
        const depth = $from.depth > 0 ? 1 : 0;
        const node = editor.view.nodeDOM($from.before(depth || 1)) as HTMLElement | null;
        if (!box || !node || !(node instanceof HTMLElement)) return setTop(null);
        setTop(node.getBoundingClientRect().top - box.getBoundingClientRect().top);
      } catch {
        setTop(null);
      }
    };
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [editor, s.from, s.block]);

  if (top === null || (!s.focused && !open)) return null;
  const items: { kind: string; label: string; icon: React.ReactNode }[] = [
    { kind: "text", label: "Text", icon: <Pilcrow /> },
    ...levels.map((level) => {
      const Icon = HEADING_ICONS[level];
      return { kind: `h${level}`, label: `Heading ${level}`, icon: <Icon /> };
    }),
    { kind: "bullet", label: "Bulleted list", icon: <List /> },
    { kind: "ordered", label: "Numbered list", icon: <ListOrdered /> },
    { kind: "task", label: "Checklist", icon: <ListChecks /> },
    { kind: "quote", label: "Quote", icon: <Quote /> },
    { kind: "code", label: "Code block", icon: <SquareCode /> },
  ];
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label="Turn this line into…"
        title="Turn into…"
        onMouseDown={(e) => e.preventDefault()}
        style={{ top: top + 2 }}
        className="text-muted-foreground hover:text-foreground absolute left-1 grid size-6 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 [&_svg]:size-4"
      >
        <EllipsisVertical />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel>Turn into</DropdownMenuLabel>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.kind}
            onSelect={() => turnInto(editor, item.kind)}
            className={cn(s.block === item.kind && "font-medium")}
          >
            {item.icon} {item.label}
            {s.block === item.kind ? (
              <span className="text-muted-foreground ml-auto text-[11px]">current</span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
