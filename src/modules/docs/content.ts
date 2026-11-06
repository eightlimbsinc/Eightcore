// Doc content: the editor's ProseMirror JSON, cleaned before it is stored.
// Only known nodes, marks and attributes survive; links must be http(s) or mailto.

export type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export const MAX_DOC_JSON = 600_000;
const MAX_DEPTH = 40;

const BLOCKS = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "text",
]);
const MARKS = new Set(["bold", "italic", "strike", "code", "underline", "link"]);
/** Blocks that end a line in the plain-text copy. */
const LINE_BREAKING = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "codeBlock",
  "blockquote",
  "hardBreak",
]);

export class DocContentError extends Error {}

export function safeHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  const href = value.trim();
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  // Bare addresses ("example.com/page") become https links.
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i.test(href)) return `https://${href}`;
  return null;
}

function cleanAttrs(
  type: string,
  attrs: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const a = attrs ?? {};
  switch (type) {
    case "heading": {
      const level = Number(a.level);
      return { level: [1, 2, 3].includes(level) ? level : 2 };
    }
    case "orderedList": {
      const start = Number(a.start);
      return { start: Number.isInteger(start) && start > 0 && start < 100000 ? start : 1 };
    }
    case "taskItem":
      return { checked: a.checked === true };
    case "codeBlock":
      return typeof a.language === "string" && /^[a-z0-9+#-]{1,20}$/i.test(a.language)
        ? { language: a.language }
        : { language: null };
    default:
      return undefined;
  }
}

function clean(node: unknown, depth: number): DocNode | null {
  if (depth > MAX_DEPTH) throw new DocContentError("The document is nested too deeply");
  if (!node || typeof node !== "object") return null;
  const n = node as DocNode;
  if (typeof n.type !== "string" || !BLOCKS.has(n.type)) return null;
  if (n.type === "text") {
    if (typeof n.text !== "string" || n.text.length === 0) return null;
    const marks = (Array.isArray(n.marks) ? n.marks : [])
      .filter((m) => m && typeof m.type === "string" && MARKS.has(m.type))
      .map((m) => {
        if (m.type !== "link") return { type: m.type };
        const href = safeHref(m.attrs?.href);
        return href ? { type: "link", attrs: { href } } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    return { type: "text", text: n.text, ...(marks.length ? { marks } : {}) };
  }
  const attrs = cleanAttrs(n.type, n.attrs);
  const content = Array.isArray(n.content)
    ? n.content.map((c) => clean(c, depth + 1)).filter((c): c is DocNode => c !== null)
    : [];
  return { type: n.type, ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) };
}

/** The cleaned document and its plain text. Throws DocContentError when it can't be used. */
export function sanitizeDocContent(raw: unknown): { content: DocNode; text: string } {
  if (JSON.stringify(raw ?? null).length > MAX_DOC_JSON)
    throw new DocContentError("The document is too long");
  const root = clean(raw, 0);
  if (!root || root.type !== "doc") return { content: { type: "doc", content: [] }, text: "" };
  return { content: root, text: plainText(root).slice(0, 200_000) };
}

export function plainText(node: DocNode): string {
  const out: string[] = [];
  const walk = (n: DocNode) => {
    if (n.type === "text") out.push(n.text ?? "");
    n.content?.forEach(walk);
    if (LINE_BREAKING.has(n.type)) out.push("\n");
  };
  walk(node);
  return out
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
