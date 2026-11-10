import type { Metadata } from "next";
import Link from "next/link";
import { getStoragePage } from "@/modules/attachments/queries";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Storage" };

function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default async function StoragePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const u = await getStoragePage(slug);
  const share = Math.min(100, (u.usedBytes / u.limitBytes) * 100);
  const left = Math.max(0, u.limitBytes - u.usedBytes);
  const tone = share >= 90 ? "bg-destructive" : share >= 75 ? "bg-amber-500" : "bg-accent";
  return (
    <>
      <PageHeader
        title="Storage"
        description="Files attached to tasks, comments, QA rounds and form responses. Only owners and admins see this page."
      />
      <div className="grid max-w-5xl gap-6 px-8 py-6">
        <Card>
          <CardHeader>
            <CardTitle>
              {size(left)} left of {size(u.limitBytes)}
            </CardTitle>
            <CardDescription>
              {size(u.usedBytes)} used by {u.files} file{u.files === 1 ? "" : "s"}
              {u.uploadingBytes ? ` (plus ${size(u.uploadingBytes)} being uploaded)` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <div
              role="meter"
              aria-label="Storage used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(share)}
              className="bg-surface-muted h-3 overflow-hidden rounded-full"
            >
              <div className={`h-full ${tone}`} style={{ width: `${Math.max(share, 0.5)}%` }} />
            </div>
            <p className="text-muted-foreground text-[12px]">
              {share >= 90
                ? "Almost full: new uploads will fail when it's full. Delete large files you don't need, or move to a bigger storage plan."
                : share >= 75
                  ? "Getting full. The largest files are listed below."
                  : "Plenty of room."}{" "}
              The limit is your storage plan&apos;s size (set by STORAGE_QUOTA_MB; Supabase&apos;s free plan is 1 GB).
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="content-start">
            <CardHeader>
              <CardTitle>By project</CardTitle>
            </CardHeader>
            <CardContent>
              {u.byProject.length === 0 ? (
                <p className="text-muted-foreground text-[13px]">No files yet.</p>
              ) : (
                <ul className="grid gap-2">
                  {u.byProject.map((p) => (
                    <li key={p.projectId} className="grid gap-1">
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <Link href={`/w/${slug}/p/${p.key}`} className="truncate font-medium hover:underline">
                          {p.name}
                        </Link>
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {size(p.bytes)} · {p.files} file{p.files === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="bg-surface-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
                        <div className="bg-accent h-full" style={{ width: `${(p.bytes / Math.max(u.usedBytes, 1)) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="content-start">
            <CardHeader>
              <CardTitle>Largest files</CardTitle>
              <CardDescription>Open the task to delete a file you no longer need.</CardDescription>
            </CardHeader>
            <CardContent>
              {u.largest.length === 0 ? (
                <p className="text-muted-foreground text-[13px]">No files yet.</p>
              ) : (
                <ul className="divide-y text-[13px]">
                  {u.largest.map((f) => (
                    <li key={f.id} className="flex items-baseline gap-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate" title={f.name}>
                        {f.name}
                      </span>
                      <Link href={`/w/${slug}/t/${f.ref}`} className="text-muted-foreground shrink-0 font-mono text-[11px] hover:underline">
                        {f.ref}
                      </Link>
                      <span className="w-16 shrink-0 text-right tabular-nums">{size(f.bytes)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
