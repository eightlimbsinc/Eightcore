// Finding links in plain text (comments, descriptions) and telling images and videos from pages.

/** http(s) links, stopping before trailing punctuation that usually ends a sentence. */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/gi;

export function findLinks(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    try {
      const url = new URL(m[0]);
      if (url.protocol === "http:" || url.protocol === "https:") seen.add(url.toString());
    } catch {
      // not a URL after all
    }
  }
  return [...seen];
}

/** Splits text into plain pieces and links (for rendering links clickable). */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: m[0], href: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export type LinkKind = "image" | "video" | "page";

export function linkKind(href: string): LinkKind {
  let path: string;
  try {
    path = new URL(href).pathname.toLowerCase();
  } catch {
    return "page";
  }
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(path)) return "image";
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(path)) return "video";
  return "page";
}

/** Links not worth a preview card (they need a login, so there's nothing to show). */
export function skipPreview(href: string): boolean {
  try {
    const host = new URL(href).hostname;
    return host === "app.clickup.com" || host === "localhost";
  } catch {
    return true;
  }
}

/** A web page's preview card. */
export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};
