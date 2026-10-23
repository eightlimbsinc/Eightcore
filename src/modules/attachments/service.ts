import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { db, type DbOrTx } from "@/server/db";
import { attachments, users } from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import { ForbiddenError, NotFoundError, ValidationError, assertId } from "@/server/errors";
import { env } from "@/server/env";
import { storage } from "@/server/storage";
import { recordActivity } from "@/modules/activity/service";
import { loadTaskAccess } from "@/modules/tasks/service";

export const MAX_FILES_PER_UPLOAD = 10;

/** Types the browser may display in place. Everything else downloads. SVG is never inline. */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

export function isInlineType(mimeType: string): boolean {
  return INLINE_TYPES.has(mimeType);
}

export function isImageType(mimeType: string): boolean {
  return isInlineType(mimeType) && mimeType.startsWith("image/");
}

/** A file as received from a form: name, browser-claimed type and bytes. */
export interface IncomingFile {
  name: string;
  bytes: Uint8Array;
}

export interface PreparedUpload {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
}

/** Keeps the last path segment, drops control characters, caps the length. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
  return cleaned || "file";
}

/** True when the bytes look like UTF-8 text (no NUL bytes, valid encoding). */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    // stream: true tolerates a multi-byte character cut off at the end of the sample.
    new TextDecoder("utf-8", { fatal: true }).decode(sample, {
      stream: sample.byteLength < bytes.byteLength,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The stored type comes from the file's content, not from the browser: a recognised
 * signature, else plain text, else a generic binary type.
 */
export async function detectMimeType(bytes: Uint8Array): Promise<string> {
  const sniffed = await fileTypeFromBuffer(bytes);
  if (sniffed) return sniffed.mime;
  return looksLikeText(bytes) ? "text/plain" : "application/octet-stream";
}

/** Validates files and stores their bytes. Returns what to record in the database. */
export async function storeUploads(actor: ActorContext, files: IncomingFile[]): Promise<PreparedUpload[]> {
  const real = files.filter((f) => f.bytes.byteLength > 0 || f.name);
  if (real.length > MAX_FILES_PER_UPLOAD) {
    throw new ValidationError(`Attach at most ${MAX_FILES_PER_UPLOAD} files at a time`);
  }
  const max = env().MAX_UPLOAD_BYTES;
  const prepared: PreparedUpload[] = [];
  for (const file of real) {
    const name = cleanFileName(file.name);
    if (file.bytes.byteLength === 0) throw new ValidationError(`"${name}" is empty`);
    if (file.bytes.byteLength > max) {
      throw new ValidationError(`"${name}" is larger than ${Math.floor(max / (1024 * 1024))} MB`);
    }
    prepared.push({
      storageKey: `ws/${actor.workspaceId}/${randomUUID()}`,
      originalName: name,
      mimeType: await detectMimeType(file.bytes),
      sizeBytes: file.bytes.byteLength,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      bytes: file.bytes,
    });
  }
  const stored: PreparedUpload[] = [];
  try {
    for (const upload of prepared) {
      await storage().put(upload.storageKey, upload.bytes, upload.mimeType);
      stored.push(upload);
    }
  } catch (error) {
    await discardUploads(stored);
    throw error;
  }
  return prepared;
}

/** Removes stored bytes whose database rows were never written (or were deleted). */
export async function discardUploads(uploads: { storageKey: string }[]) {
  await Promise.all(
    uploads.map((u) =>
      storage()
        .delete(u.storageKey)
        .catch((error: unknown) => console.error("[storage] could not delete", u.storageKey, error)),
    ),
  );
}

/** Records stored uploads against a task (and optionally a comment), inside the caller's transaction. */
export async function insertAttachmentsInTx(
  tx: DbOrTx,
  actor: ActorContext,
  taskId: string,
  commentId: string | null,
  uploads: PreparedUpload[],
) {
  if (!uploads.length) return [];
  const rows = await tx
    .insert(attachments)
    .values(
      uploads.map((u) => ({
        workspaceId: actor.workspaceId,
        taskId,
        commentId,
        uploaderId: actor.userId,
        storageKey: u.storageKey,
        originalName: u.originalName,
        mimeType: u.mimeType,
        sizeBytes: u.sizeBytes,
        sha256: u.sha256,
      })),
    )
    .returning({ id: attachments.id, originalName: attachments.originalName });
  await recordActivity(tx, actor, {
    entityType: "task",
    entityId: taskId,
    action: "attachments_added",
    metadata: { names: rows.map((r) => r.originalName), commentId },
  });
  return rows;
}

/** Stores bytes first, then the rows; if the rows fail, the bytes are removed again. */
export async function uploadTaskAttachments(actor: ActorContext, taskId: string, files: IncomingFile[]) {
  // Check permissions before accepting any bytes.
  const { role } = await loadTaskAccess(db(), actor, taskId);
  if (!canProject(role, "attachment.upload") || !canProject(role, "task.update")) {
    throw new ForbiddenError();
  }
  const uploads = await storeUploads(actor, files);
  if (!uploads.length) throw new ValidationError("Choose a file to attach");
  try {
    return await db().transaction(async (tx) => {
      const { task, role: currentRole } = await loadTaskAccess(tx, actor, taskId);
      if (!canProject(currentRole, "attachment.upload") || !canProject(currentRole, "task.update")) {
        throw new ForbiddenError();
      }
      if (task.archivedAt) throw new NotFoundError("Task not found");
      return insertAttachmentsInTx(tx, actor, taskId, null, uploads);
    });
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
}

const attachmentColumns = {
  id: attachments.id,
  commentId: attachments.commentId,
  originalName: attachments.originalName,
  mimeType: attachments.mimeType,
  sizeBytes: attachments.sizeBytes,
  createdAt: attachments.createdAt,
  uploaderId: attachments.uploaderId,
  uploaderName: users.name,
};

export type AttachmentSummary = Awaited<ReturnType<typeof attachmentsForTask>>[number];

/** Every live attachment on a task (task-level and on comments). The caller has checked access. */
export async function attachmentsForTask(tx: DbOrTx, taskId: string) {
  return tx
    .select(attachmentColumns)
    .from(attachments)
    .innerJoin(users, eq(users.id, attachments.uploaderId))
    .where(and(eq(attachments.taskId, taskId), isNull(attachments.deletedAt)))
    .orderBy(asc(attachments.createdAt), asc(attachments.id));
}

export async function listTaskAttachments(actor: ActorContext, taskId: string) {
  const { role } = await loadTaskAccess(db(), actor, taskId);
  const rows = await attachmentsForTask(db(), taskId);
  return rows.map((a) => ({ ...a, canDelete: canDeleteAttachment(actor, role, a) }));
}

export function canDeleteAttachment(
  actor: ActorContext,
  role: Parameters<typeof canProject>[0],
  attachment: { uploaderId: string },
): boolean {
  return (
    canProject(role, "attachment.moderate") ||
    (attachment.uploaderId === actor.userId && canProject(role, "attachment.upload"))
  );
}

async function loadAttachmentAccess(tx: DbOrTx, actor: ActorContext, attachmentId: string) {
  assertId(attachmentId, "File not found");
  const [attachment] = await tx
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.workspaceId, actor.workspaceId),
        isNull(attachments.deletedAt),
      ),
    );
  if (!attachment) throw new NotFoundError("File not found");
  // Seeing the task is what grants the download.
  const { task, role } = await loadTaskAccess(tx, actor, attachment.taskId);
  if (task.archivedAt) throw new NotFoundError("File not found");
  return { attachment, task, role };
}

/** What the download route needs, after the permission check. Never exposes the storage key to callers' UI. */
export async function getAttachmentForDownload(actor: ActorContext, attachmentId: string) {
  const { attachment } = await loadAttachmentAccess(db(), actor, attachmentId);
  return attachment;
}

export async function deleteAttachment(actor: ActorContext, attachmentId: string) {
  const removed = await db().transaction(async (tx) => {
    const { attachment, role } = await loadAttachmentAccess(tx, actor, attachmentId);
    if (!canDeleteAttachment(actor, role, attachment)) throw new ForbiddenError();
    await tx.delete(attachments).where(eq(attachments.id, attachmentId));
    await recordActivity(tx, actor, {
      entityType: "task",
      entityId: attachment.taskId,
      action: "attachment_removed",
      metadata: { name: attachment.originalName },
    });
    return attachment;
  });
  await discardUploads([removed]);
}

/** Deletes the rows of a comment's attachments (inside the caller's transaction) and returns their keys. */
export async function removeCommentAttachmentsInTx(tx: DbOrTx, commentIds: string[]) {
  if (!commentIds.length) return [];
  return tx
    .delete(attachments)
    .where(inArray(attachments.commentId, commentIds))
    .returning({ storageKey: attachments.storageKey });
}
