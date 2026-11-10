import "server-only";
// Uploads that go from the browser straight to file storage (up to 25 MB), because the host only
// lets about 6 MB through the app per request. The app hands out a one-time upload address, the
// browser sends the file there, and the file becomes an attachment when the form or comment that
// uses it is saved. Its type is read from its first bytes, never taken from the browser.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { pendingUploads } from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import { env } from "@/server/env";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { DIRECT_UPLOAD_MAX_BYTES, discardStored, storage, storageDriver } from "@/server/storage";
import { cleanFileName, detectMimeType, type PreparedUpload } from "./service";

const UPLOAD_TTL_MS = 60 * 60_000;
export const MAX_DIRECT_FILES = 10;

const fileMeta = z.object({
  name: z.string().max(500),
  size: z
    .number()
    .int()
    .min(1, "That file is empty")
    .max(DIRECT_UPLOAD_MAX_BYTES, "Files can be at most 25 MB each"),
});
export type FileMeta = z.input<typeof fileMeta>;

/** Proof that an upload address for the app's own route (local storage) came from us. */
export function uploadSignature(id: string) {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update(`upload:${id}`).digest("base64url");
}
export function checkUploadSignature(id: string, sig: string) {
  const a = Buffer.from(uploadSignature(id));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function start(
  owner: { workspaceId: string; createdBy: string; formId?: string; ipHash?: string },
  rawFiles: FileMeta[],
  maxFiles: number,
) {
  if (!Array.isArray(rawFiles) || !rawFiles.length) throw new ValidationError("Choose a file");
  if (rawFiles.length > maxFiles) throw new ValidationError(`At most ${maxFiles} files at a time`);
  const files = rawFiles.map((f) => {
    const parsed = fileMeta.safeParse(f);
    if (!parsed.success)
      throw new ValidationError(
        `“${cleanFileName(String(f?.name ?? ""))}”: ${parsed.error.issues[0]!.message}`,
      );
    return parsed.data;
  });
  const rows = await db()
    .insert(pendingUploads)
    .values(
      files.map((f) => ({
        workspaceId: owner.workspaceId,
        storageKey: `ws/${owner.workspaceId}/${randomUUID()}`,
        originalName: cleanFileName(f.name),
        sizeBytes: f.size,
        createdBy: owner.createdBy,
        formId: owner.formId ?? null,
        ipHash: owner.ipHash ?? null,
        expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
      })),
    )
    .returning({ id: pendingUploads.id, storageKey: pendingUploads.storageKey });
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      // Straight to storage when it can sign an address; else the app's own route (local development).
      url:
        (await storage().signedUploadUrl(r.storageKey, "application/octet-stream")) ??
        `/api/uploads/${r.id}?sig=${uploadSignature(r.id)}`,
    })),
  );
}

/** Upload addresses for files going onto a task (its files, a comment, QA evidence). */
export async function startTaskUploads(actor: ActorContext, taskId: string, files: FileMeta[]) {
  const { loadTaskAccess } = await import("@/modules/tasks/service");
  const { role } = await loadTaskAccess(db(), actor, taskId);
  if (!canProject(role, "attachment.upload")) throw new ForbiddenError();
  return start({ workspaceId: actor.workspaceId, createdBy: actor.userId }, files, MAX_DIRECT_FILES);
}

/** Upload addresses for a public form's files question (no sign-in; limited per sender). */
export async function startFormUploads(
  form: { id: string; workspaceId: string; createdBy: string },
  files: FileMeta[],
  ipHash: string,
  maxFiles: number,
) {
  const [{ n }] = (await db()
    .select({ n: count() })
    .from(pendingUploads)
    .where(
      and(
        eq(pendingUploads.ipHash, ipHash),
        gt(pendingUploads.createdAt, new Date(Date.now() - 10 * 60_000)),
      ),
    )) as [{ n: number }];
  if (n + files.length > 30)
    throw new ValidationError("Too many files just now. Please try again in a few minutes.");
  return start(
    { workspaceId: form.workspaceId, createdBy: form.createdBy, formId: form.id, ipHash },
    files,
    maxFiles,
  );
}

/**
 * Turns finished direct uploads into attachments-to-be: each must be this person's (or this form's),
 * unused, unexpired, really stored, and within the size limit. Marks them used.
 */
export async function claimUploads(
  actor: ActorContext,
  ids: string[],
  options: { formId?: string } = {},
): Promise<PreparedUpload[]> {
  if (!ids.length) return [];
  if (ids.some((id) => !z.uuid().safeParse(id).success)) throw new NotFoundError("Upload not found");
  const rows = await db()
    .select()
    .from(pendingUploads)
    .where(
      and(
        inArray(pendingUploads.id, ids),
        eq(pendingUploads.workspaceId, actor.workspaceId),
        eq(pendingUploads.createdBy, actor.userId),
        isNull(pendingUploads.usedAt),
        gt(pendingUploads.expiresAt, new Date()),
        options.formId ? eq(pendingUploads.formId, options.formId) : isNull(pendingUploads.formId),
      ),
    );
  if (rows.length !== new Set(ids).size)
    throw new ValidationError("An upload expired or didn't finish. Add the file again.");
  const prepared: PreparedUpload[] = [];
  for (const row of rows) {
    const stored = await storage().stat(row.storageKey);
    if (!stored || stored.size === 0)
      throw new ValidationError(`“${row.originalName}” didn't finish uploading. Add it again.`);
    if (stored.size > DIRECT_UPLOAD_MAX_BYTES) {
      await discardStored([{ storageKey: row.storageKey }]);
      throw new ValidationError(`“${row.originalName}” is larger than 25 MB`);
    }
    const head = await storage().readStart(row.storageKey, 8192);
    prepared.push({
      storageKey: row.storageKey,
      originalName: row.originalName,
      mimeType: await detectMimeType(head),
      sizeBytes: stored.size,
      sha256: `etag:${stored.etag ?? "none"}`,
      bytes: null,
    });
  }
  await db()
    .update(pendingUploads)
    .set({ usedAt: new Date() })
    .where(
      inArray(
        pendingUploads.id,
        rows.map((r) => r.id),
      ),
    );
  return prepared;
}

/** True when these direct uploads belong to the form and are ready to be used. */
export async function formUploadsReady(formId: string, ids: string[]) {
  if (!ids.length) return true;
  if (ids.some((id) => !z.uuid().safeParse(id).success)) return false;
  const [{ n }] = (await db()
    .select({ n: count() })
    .from(pendingUploads)
    .where(
      and(
        inArray(pendingUploads.id, ids),
        eq(pendingUploads.formId, formId),
        isNull(pendingUploads.usedAt),
        gt(pendingUploads.expiresAt, new Date()),
      ),
    )) as [{ n: number }];
  return n === new Set(ids).size;
}

/** Removes uploads nobody used before they expired (and old bookkeeping rows). */
export async function cleanupPendingUploads(limit = 50) {
  const now = new Date();
  const expired = await db()
    .select({ id: pendingUploads.id, storageKey: pendingUploads.storageKey })
    .from(pendingUploads)
    .where(and(isNull(pendingUploads.usedAt), lt(pendingUploads.expiresAt, now)))
    .limit(limit);
  if (expired.length) {
    await discardStored(expired);
    await db()
      .delete(pendingUploads)
      .where(
        inArray(
          pendingUploads.id,
          expired.map((r) => r.id),
        ),
      );
  }
  await db()
    .delete(pendingUploads)
    .where(
      and(
        isNotNull(pendingUploads.usedAt),
        or(lt(pendingUploads.usedAt, new Date(now.getTime() - 86_400_000)))!,
      ),
    );
  return expired.length;
}

/**
 * The app's own upload address (local storage only; with S3 the browser uploads to storage).
 * Returns an HTTP status.
 */
export async function receiveLocalUpload(id: string, sig: string, body: () => Promise<ArrayBuffer>) {
  if (!/^[0-9a-f-]{36}$/.test(id) || !checkUploadSignature(id, sig) || storageDriver() !== "local")
    return 404;
  const [row] = await db()
    .select({ storageKey: pendingUploads.storageKey })
    .from(pendingUploads)
    .where(
      and(eq(pendingUploads.id, id), isNull(pendingUploads.usedAt), gt(pendingUploads.expiresAt, new Date())),
    );
  if (!row) return 404;
  const bytes = new Uint8Array(await body());
  if (bytes.byteLength === 0 || bytes.byteLength > DIRECT_UPLOAD_MAX_BYTES) return 413;
  await storage().put(row.storageKey, bytes, "application/octet-stream");
  return 204;
}
