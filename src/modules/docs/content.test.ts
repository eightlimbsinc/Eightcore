import { describe, expect, it } from "vitest";
import { DocContentError, safeHref, sanitizeDocContent } from "./content";

describe("doc content", () => {
  it("keeps known nodes and marks and drops the rest", () => {
    const { content, text } = sanitizeDocContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 9, onclick: "x" }, content: [{ type: "text", text: "Brief" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read ", marks: [{ type: "bold" }, { type: "evil" }] },
            { type: "text", text: "this", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
            { type: "text", text: " and ", marks: [{ type: "link", attrs: { href: "example.com/x" } }] },
          ],
        },
        { type: "iframe", attrs: { src: "https://evil.test" } },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: "yes" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Ship" }] }],
            },
          ],
        },
      ],
    });
    expect(content.content).toHaveLength(3);
    expect(content.content![0]).toEqual({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Brief" }],
    });
    const para = content.content![1]!.content!;
    expect(para[0]!.marks).toEqual([{ type: "bold" }]);
    expect(para[1]!.marks).toBeUndefined();
    expect(para[2]!.marks).toEqual([{ type: "link", attrs: { href: "https://example.com/x" } }]);
    expect(content.content![2]!.content![0]!.attrs).toEqual({ checked: false });
    expect(text).toBe("Brief\nRead this and \nShip");
  });

  it("handles junk and limits", () => {
    expect(sanitizeDocContent(null).content).toEqual({ type: "doc", content: [] });
    expect(sanitizeDocContent({ type: "paragraph" }).text).toBe("");
    let deep: object = { type: "text", text: "x" };
    for (let i = 0; i < 60; i++) deep = { type: "blockquote", content: [deep] };
    expect(() => sanitizeDocContent({ type: "doc", content: [deep] })).toThrow(DocContentError);
    expect(() =>
      sanitizeDocContent({ type: "doc", content: [{ type: "text", text: "x".repeat(700_000) }] }),
    ).toThrow(/too long/);
    expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref(" HTTPS://x.io ")).toBe("HTTPS://x.io");
  });
});
