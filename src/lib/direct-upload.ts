// Browser side of direct uploads: files go straight to storage (up to 25 MB each), then the form
// carries "<upload id>|<name>" references instead of the bytes. If a direct upload can't be made,
// small files still go along with the form the old way.
import type { ActionState } from "@/lib/action-state";

export const DIRECT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
/** What the host lets through the app in one request, with room for the rest of the form. */
export const THROUGH_APP_MAX_BYTES = 3 * 1024 * 1024;

export type StartUploads = (
  files: { name: string; size: number }[],
) => Promise<{ ok: true; uploads: { id: string; url: string }[] } | { ok: false; message: string }>;

export class UploadError extends Error {}

const mb = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

/** The form with `field`'s files uploaded to storage and replaced by references. */
export async function moveFilesToStorage(
  data: FormData,
  field: string,
  start: StartUploads,
): Promise<FormData> {
  const files = data.getAll(field).filter((v): v is File => v instanceof File && v.size > 0);
  if (!files.length) return data;
  const big = files.find((f) => f.size > DIRECT_UPLOAD_MAX_BYTES);
  if (big) throw new UploadError(`“${big.name}” is ${mb(big.size)}; files can be at most 25 MB each.`);
  const smallEnough = files.reduce((sum, f) => sum + f.size, 0) <= THROUGH_APP_MAX_BYTES;
  let started: Awaited<ReturnType<StartUploads>>;
  try {
    started = await start(files.map((f) => ({ name: f.name, size: f.size })));
  } catch {
    if (smallEnough) return data;
    throw new UploadError("Couldn't start the upload. Check your connection and try again.");
  }
  if (!started.ok) throw new UploadError(started.message);
  try {
    await Promise.all(
      files.map(async (f, i) => {
        const res = await fetch(started.uploads[i]!.url, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: f,
        });
        if (!res.ok) throw new Error(String(res.status));
      }),
    );
  } catch {
    if (smallEnough) return data;
    throw new UploadError("The upload didn't go through. Check your connection and try again.");
  }
  const next = new FormData();
  for (const [key, value] of data.entries()) if (key !== field) next.append(key, value);
  started.uploads.forEach((u, i) => next.append(`${field}__upload`, `${u.id}|${files[i]!.name}`));
  return next;
}

/** A form action that first moves `field`'s files to storage (for useActionState). */
export function withDirectUploads(
  action: (prev: ActionState, form: FormData) => Promise<ActionState>,
  field: string,
  start: StartUploads,
) {
  return async (prev: ActionState, form: FormData): Promise<ActionState> => {
    try {
      return await action(prev, await moveFilesToStorage(form, field, start));
    } catch (error) {
      if (error instanceof UploadError) return { ok: false, message: error.message };
      throw error;
    }
  };
}
