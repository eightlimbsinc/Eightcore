"use client";
import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

/**
 * Errors from a tab opened before a new release: its page code no longer matches the
 * server (a Server Action or script chunk that was replaced). Reloading fixes them.
 */
export function isStaleVersionError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /UnrecognizedActionError|was not found on the server|failed-to-find-server-action|ChunkLoadError|Loading chunk|dynamically imported module/i.test(
    text,
  );
}

const RELOAD_KEY = "eightcore:auto-reloaded-at";

/** Reload at most once a minute, so a real fault can't cause a reload loop. */
function claimAutoReload(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage blocked: reload anyway; the reloaded page is the current version.
  }
  return true;
}

/** What people see when a page fails: a plain explanation, Reload and Back. */
export function ErrorScreen({ error }: { error: Error & { digest?: string } }) {
  const stale = isStaleVersionError(error);
  useEffect(() => {
    if (stale && claimAutoReload()) window.location.reload();
    else if (!stale) console.error(error);
  }, [error, stale]);

  return (
    <div className="grid min-h-[60vh] place-items-center p-8">
      <div className="grid max-w-md gap-3" role="alert">
        <TriangleAlert className="text-accent size-8" aria-hidden />
        <h1 className="text-lg font-semibold">
          {stale ? "Eightcore was updated" : "This page couldn’t load"}
        </h1>
        {stale ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <RefreshCw className="size-4 shrink-0 animate-spin" aria-hidden />
            Eightcore was updated while this tab was open. Loading the latest version…
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Something went wrong on our side. Reload to try again, or go back. Nothing you saved is lost.
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => history.back()}
            className="bg-surface inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
          >
            Back
          </button>
        </div>
        {error.digest ? (
          <p className="text-muted-foreground font-mono text-[11px]">Reference: {error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
