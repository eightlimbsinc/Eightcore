import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { linkPreviews } from "@/server/db/schema";
import { isPrivateAddress } from "@/modules/webhooks/service";
import { skipPreview, type LinkPreview } from "@/lib/links";

export type { LinkPreview };

const FRESH_MS = 7 * 86_400_000;
const RETRY_FAILED_MS = 86_400_000;
const MAX_HTML = 400_000;
const MAX_HOPS = 3;

/** A public http(s) address only: no credentials, no private or internal hosts (also after DNS). */
async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not http");
  if (url.username || url.password) throw new Error("credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal"))
    throw new Error("internal");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error("private");
}

/** Reads at most `max` bytes of the body as text. */
async function readSome(res: Response, max: number) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks).subarray(0, max));
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

/** Title, description, image and site name from a page's <head> (Open Graph first). */
export function parsePreview(html: string, pageUrl: string): Omit<LinkPreview, "url"> {
  const head = html.slice(0, MAX_HTML);
  const meta = (names: string[]) => {
    for (const name of names) {
      const re = new RegExp(
        `<meta[^>]+(?:property|name)=["']${name}["'][^>]*>|<meta[^>]+content=["'][^"']*["'][^>]+(?:property|name)=["']${name}["'][^>]*>`,
        "i",
      );
      const tag = re.exec(head)?.[0];
      const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
      if (content) return decode(content);
    }
    return null;
  };
  const tag = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1];
  const title = meta(["og:title", "twitter:title"]) ?? (tag ? decode(tag) : null);
  let imageUrl = meta(["og:image", "og:image:url", "twitter:image"]);
  if (imageUrl) {
    try {
      const abs = new URL(imageUrl, pageUrl);
      imageUrl = abs.protocol === "https:" ? abs.toString() : null;
    } catch {
      imageUrl = null;
    }
  }
  const cut = (s: string | null, n: number) => (s ? s.slice(0, n) : null);
  return {
    title: cut(title, 200),
    description: cut(meta(["og:description", "description", "twitter:description"]), 300),
    imageUrl: cut(imageUrl, 2000),
    siteName: cut(meta(["og:site_name"]) ?? new URL(pageUrl).hostname.replace(/^www\./, ""), 80),
  };
}

async function fetchPreview(raw: string): Promise<Omit<LinkPreview, "url"> | null> {
  let url = new URL(raw);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; EightcoreLinkPreview/1.0)",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => undefined);
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("image/") && url.protocol === "https:") {
      await res.body?.cancel().catch(() => undefined);
      return { title: null, description: null, imageUrl: url.toString(), siteName: url.hostname };
    }
    if (!type.includes("html")) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return parsePreview(await readSome(res, MAX_HTML), url.toString());
  }
  return null;
}

/** Previews for up to 6 links (cached; pages are read at most weekly). Unreadable links are left out. */
export async function linkPreviewsFor(rawUrls: string[]): Promise<LinkPreview[]> {
  const urls = [
    ...new Set(
      rawUrls
        .filter(
          (u) => typeof u === "string" && u.length <= 2000 && /^https?:\/\//i.test(u) && !skipPreview(u),
        )
        .map((u) => {
          try {
            return new URL(u).toString();
          } catch {
            return null;
          }
        })
        .filter((u): u is string => !!u),
    ),
  ].slice(0, 6);
  if (!urls.length) return [];
  const cached = new Map(
    (await db().select().from(linkPreviews).where(inArray(linkPreviews.url, urls))).map((r) => [r.url, r]),
  );
  const now = Date.now();
  const stale = urls.filter((u) => {
    const row = cached.get(u);
    return !row || now - row.fetchedAt.getTime() > (row.ok ? FRESH_MS : RETRY_FAILED_MS);
  });
  await Promise.all(
    stale.map(async (u) => {
      const found = await fetchPreview(u).catch(() => null);
      const row = {
        url: u,
        ok: !!found && !!(found.title || found.imageUrl),
        title: found?.title ?? null,
        description: found?.description ?? null,
        imageUrl: found?.imageUrl ?? null,
        siteName: found?.siteName ?? null,
        fetchedAt: new Date(),
      };
      await db().insert(linkPreviews).values(row).onConflictDoUpdate({ target: linkPreviews.url, set: row });
      cached.set(u, row);
    }),
  );
  return urls
    .map((u) => cached.get(u))
    .filter((r): r is NonNullable<typeof r> => !!r && r.ok)
    .map(({ url, title, description, imageUrl, siteName }) => ({
      url,
      title,
      description,
      imageUrl,
      siteName,
    }));
}
