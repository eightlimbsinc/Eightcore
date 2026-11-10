import { describe, expect, it } from "vitest";
import { findLinks, linkKind, skipPreview, splitLinks } from "./links";

describe("links", () => {
  it("finds links without trailing punctuation, once each", () => {
    expect(
      findLinks("See https://blend360.com/about. And (https://x.io/a.png), https://x.io/a.png!"),
    ).toEqual(["https://blend360.com/about", "https://x.io/a.png"]);
    expect(findLinks("ftp://nope javascript:alert(1) www.x.io")).toEqual([]);
  });
  it("splits text for clickable links", () => {
    expect(splitLinks("go https://x.io now")).toEqual([
      { text: "go " },
      { text: "https://x.io", href: "https://x.io" },
      { text: " now" },
    ]);
  });
  it("tells images and videos from pages", () => {
    expect(linkKind("https://t1.p.clickup-attachments.com/t1/abc/image.PNG")).toBe("image");
    expect(linkKind("https://cdn.x.io/clip.mov?x=1")).toBe("video");
    expect(linkKind("https://blend360.com")).toBe("page");
    expect(skipPreview("https://app.clickup.com/t/abc")).toBe(true);
    expect(skipPreview("https://blend360.com")).toBe(false);
  });
});
