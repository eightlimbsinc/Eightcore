import "server-only";
import { getSession } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { NotFoundError } from "@/server/errors";
import { storage } from "@/server/storage";
import { getAttachmentForDownload, isInlineType } from "./service";

export type DownloadResult =
  | { kind: "not_found" }
  | { kind: "redirect"; url: string }
  | { kind: "bytes"; bytes: Uint8Array; mimeType: string; fileName: string; inline: boolean };

/** Session + permission check, then either a short-lived storage link or the bytes. */
export async function resolveDownload(
  slug: string,
  attachmentId: string,
  forceDownload: boolean,
): Promise<DownloadResult> {
  const session = await getSession();
  if (!session) return { kind: "not_found" };
  let attachment;
  try {
    attachment = await getAttachmentForDownload(await resolveActor(session.user.id, slug), attachmentId);
  } catch (error) {
    if (error instanceof NotFoundError) return { kind: "not_found" };
    throw error;
  }
  const inline = !forceDownload && isInlineType(attachment.mimeType);
  const store = storage();
  const url = await store.signedDownloadUrl(attachment.storageKey, {
    fileName: attachment.originalName,
    contentType: attachment.mimeType,
    inline,
  });
  if (url) return { kind: "redirect", url };
  const bytes = await store.read(attachment.storageKey);
  if (!bytes) return { kind: "not_found" };
  return { kind: "bytes", bytes, mimeType: attachment.mimeType, fileName: attachment.originalName, inline };
}
