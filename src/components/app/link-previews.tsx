"use client";
import { useEffect, useState } from "react";
import { linkPreviewsAction } from "@/modules/links/actions";
import { findLinks, linkKind, skipPreview, splitLinks, type LinkPreview } from "@/lib/links";

/** Plain text with its links clickable (opening in a new tab). */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((p, i) =>
        p.href ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent-foreground break-all underline underline-offset-2"
          >
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const MAX_MEDIA = 8;

/** Under a comment or description: images and videos inline, a card for each web page. */
export function LinkPreviews({ workspaceSlug, text }: { workspaceSlug: string; text: string }) {
  const links = findLinks(text);
  const media = links.filter((l) => linkKind(l) !== "page").slice(0, MAX_MEDIA);
  const pages = links.filter((l) => linkKind(l) === "page" && !skipPreview(l)).slice(0, 3);
  const pageKey = pages.join(" ");
  const [cards, setCards] = useState<{ key: string; items: LinkPreview[] }>({ key: "", items: [] });
  const [broken, setBroken] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!pageKey) return;
    let live = true;
    linkPreviewsAction(workspaceSlug, pageKey.split(" "))
      .then((items) => live && setCards({ key: pageKey, items }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [workspaceSlug, pageKey]);

  const shownCards = cards.key === pageKey ? cards.items : [];
  const shownMedia = media.filter((m) => !broken.has(m));
  if (!shownMedia.length && !shownCards.length) return null;
  const hide = (url: string) => setBroken((b) => new Set(b).add(url));

  return (
    <div className="mt-2 grid gap-2">
      {shownMedia.length ? (
        <div className="flex flex-wrap gap-2">
          {shownMedia.map((url) =>
            linkKind(url) === "video" ? (
              <video
                key={url}
                src={url}
                controls
                preload="metadata"
                onError={() => hide(url)}
                className="max-h-64 max-w-full rounded-md border bg-black"
              />
            ) : (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer" title="Open full size">
                {/* External images: plain <img> (next/image would proxy them through our server). */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => hide(url)}
                  className="bg-surface-muted max-h-48 max-w-64 rounded-md border object-cover"
                />
              </a>
            ),
          )}
        </div>
      ) : null}
      {shownCards.map((c) => (
        <a
          key={c.url}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="bg-surface hover:bg-surface-muted flex max-w-xl overflow-hidden rounded-md border text-left"
        >
          {c.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-20 w-28 shrink-0 object-cover"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
          ) : null}
          <span className="grid min-w-0 content-center gap-0.5 px-3 py-2">
            <span className="text-muted-foreground truncate text-[11px]">{c.siteName}</span>
            {c.title ? <span className="truncate text-[13px] font-medium">{c.title}</span> : null}
            {c.description ? (
              <span className="text-muted-foreground line-clamp-2 text-[12px]">{c.description}</span>
            ) : null}
          </span>
        </a>
      ))}
    </div>
  );
}
