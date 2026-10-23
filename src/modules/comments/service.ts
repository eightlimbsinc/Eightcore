import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import { commentMentions, comments, users } from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import type { ProjectRole } from "@/server/authz/matrix";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, assertId } from "@/server/errors";
import { enqueueOutbox, recordActivity } from "@/modules/activity/service";
import { assignableUserIds, loadTaskAccess } from "@/modules/tasks/service";
import { addWatchersInTx, notifyInTx, watcherIds } from "@/modules/notifications/service";
import {
  attachmentsForTask,
  canDeleteAttachment,
  discardUploads,
  insertAttachmentsInTx,
  removeCommentAttachmentsInTx,
  storeUploads,
  type IncomingFile,
} from "@/modules/attachments/service";
import {
  commentEditInput,
  commentInput,
  mentionedIn,
  type CommentEditInput,
  type CommentInput,
} from "./validators";

const EXCERPT_LENGTH = 140;

function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
}

/** Mentioned people: picked in the UI, still named in the text, and able to see the project. */
async function resolveMentions(tx: DbOrTx, body: string, pickedIds: string[], allowed: Set<string>) {
  const candidates = [...new Set(pickedIds)].filter((id) => allowed.has(id));
  if (!candidates.length) return [];
  const people = await tx
    .select({ userId: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, candidates));
  return mentionedIn(body, people);
}

async function loadCommentAccess(tx: DbOrTx, actor: ActorContext, commentId: string) {
  assertId(commentId, "Comment not found");
  const [comment] = await tx
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.workspaceId, actor.workspaceId)));
  if (!comment || comment.deletedAt) throw new NotFoundError("Comment not found");
  const access = await loadTaskAccess(tx, actor, comment.taskId);
  return { comment, ...access };
}

function canEditComment(actor: ActorContext, role: ProjectRole, comment: { authorId: string }) {
  return comment.authorId === actor.userId && canProject(role, "comment.create");
}

function canDeleteComment(actor: ActorContext, role: ProjectRole, comment: { authorId: string }) {
  return canEditComment(actor, role, comment) || canProject(role, "comment.moderate");
}

// ── Create ────────────────────────────────────────────────────────────────────────────────

/**
 * Posts a comment (or a reply to a top-level comment), with optional files. Mentioned
 * people and the author start watching the task; watchers and mentioned people are notified.
 */
export async function createComment(
  actor: ActorContext,
  taskId: string,
  raw: CommentInput,
  files: IncomingFile[] = [],
) {
  const input = commentInput.parse(raw);
  // Permission first, so a denied user can't make us store bytes.
  const pre = await loadTaskAccess(db(), actor, taskId);
  if (!canProject(pre.role, "comment.create")) throw new ForbiddenError();
  if (files.length && !canProject(pre.role, "attachment.upload")) throw new ForbiddenError();

  const uploads = files.length ? await storeUploads(actor, files) : [];
  try {
    return await db().transaction(async (tx) => {
      const { task, project, role } = await loadTaskAccess(tx, actor, taskId);
      if (!canProject(role, "comment.create")) throw new ForbiddenError();
      if (task.archivedAt) throw new ConflictError("This task is archived");

      if (input.parentCommentId) {
        const [parent] = await tx
          .select({
            id: comments.id,
            parentCommentId: comments.parentCommentId,
            deletedAt: comments.deletedAt,
          })
          .from(comments)
          .where(and(eq(comments.id, input.parentCommentId), eq(comments.taskId, taskId)));
        if (!parent || parent.deletedAt) throw new NotFoundError("Comment not found");
        if (parent.parentCommentId) throw new ValidationError("Replies can't have replies of their own");
      }

      const allowed = await assignableUserIds(tx, actor, project.id, project.visibility);
      const mentioned = await resolveMentions(tx, input.body, input.mentionIds, allowed);

      const [comment] = await tx
        .insert(comments)
        .values({
          workspaceId: actor.workspaceId,
          taskId,
          parentCommentId: input.parentCommentId ?? null,
          authorId: actor.userId,
          body: input.body,
        })
        .returning({ id: comments.id });
      const commentId = comment!.id;

      if (mentioned.length) {
        await tx
          .insert(commentMentions)
          .values(mentioned.map((userId) => ({ workspaceId: actor.workspaceId, commentId, userId })));
      }
      await insertAttachmentsInTx(tx, actor, taskId, commentId, uploads);

      const watchersBefore = await watcherIds(tx, taskId);
      await addWatchersInTx(tx, actor, taskId, [actor.userId, ...mentioned]);
      const data = { commentId, excerpt: excerpt(input.body) };
      const notifiedMentions = await notifyInTx(tx, actor, {
        taskId,
        type: "mentioned",
        userIds: mentioned,
        allowed,
        data,
      });
      await notifyInTx(tx, actor, {
        taskId,
        type: "commented",
        userIds: watchersBefore.filter((id) => !notifiedMentions.includes(id)),
        allowed,
        data,
      });

      await recordActivity(tx, actor, {
        entityType: "task",
        entityId: taskId,
        action: input.parentCommentId ? "replied" : "commented",
        metadata: { commentId, excerpt: excerpt(input.body) },
      });
      await enqueueOutbox(tx, actor.workspaceId, "comment.created", { taskId, commentId });
      return { id: commentId };
    });
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
}

// ── Update / delete ───────────────────────────────────────────────────────────────────────

/** Authors edit their own comments. Newly mentioned people are notified. */
export async function updateComment(actor: ActorContext, commentId: string, raw: CommentEditInput) {
  const input = commentEditInput.parse(raw);
  await db().transaction(async (tx) => {
    const { comment, project, role } = await loadCommentAccess(tx, actor, commentId);
    if (!canEditComment(actor, role, comment)) throw new ForbiddenError();
    if (comment.body === input.body) return;

    const allowed = await assignableUserIds(tx, actor, project.id, project.visibility);
    const previous = await mentionIdsOf(tx, commentId);
    const mentioned = await resolveMentions(tx, input.body, [...input.mentionIds, ...previous], allowed);
    const added = mentioned.filter((id) => !previous.includes(id));
    const removed = previous.filter((id) => !mentioned.includes(id));

    await tx
      .update(comments)
      .set({ body: input.body, editedAt: new Date() })
      .where(eq(comments.id, commentId));
    if (removed.length) {
      await tx
        .delete(commentMentions)
        .where(and(eq(commentMentions.commentId, commentId), inArray(commentMentions.userId, removed)));
    }
    if (added.length) {
      await tx
        .insert(commentMentions)
        .values(added.map((userId) => ({ workspaceId: actor.workspaceId, commentId, userId })));
      await addWatchersInTx(tx, actor, comment.taskId, added);
      await notifyInTx(tx, actor, {
        taskId: comment.taskId,
        type: "mentioned",
        userIds: added,
        allowed,
        data: { commentId, excerpt: excerpt(input.body) },
      });
    }
    await recordActivity(tx, actor, {
      entityType: "comment",
      entityId: commentId,
      action: "edited",
      metadata: { taskId: comment.taskId },
    });
  });
}

async function mentionIdsOf(tx: DbOrTx, commentId: string) {
  const rows = await tx
    .select({ userId: commentMentions.userId })
    .from(commentMentions)
    .where(eq(commentMentions.commentId, commentId));
  return rows.map((r) => r.userId);
}

/**
 * Soft-deletes a comment: its text and files are removed; a placeholder stays while it
 * still has replies. Authors delete their own; managers delete any.
 */
export async function deleteComment(actor: ActorContext, commentId: string) {
  const keys = await db().transaction(async (tx) => {
    const { comment, role } = await loadCommentAccess(tx, actor, commentId);
    if (!canDeleteComment(actor, role, comment)) throw new ForbiddenError();
    await tx
      .update(comments)
      .set({ deletedAt: new Date(), body: "[deleted]" })
      .where(eq(comments.id, commentId));
    await tx.delete(commentMentions).where(eq(commentMentions.commentId, commentId));
    const removedFiles = await removeCommentAttachmentsInTx(tx, [commentId]);
    await recordActivity(tx, actor, {
      entityType: "task",
      entityId: comment.taskId,
      action: "comment_deleted",
      metadata: { commentId, byAuthor: comment.authorId === actor.userId },
    });
    return removedFiles;
  });
  await discardUploads(keys);
}

// ── Read ──────────────────────────────────────────────────────────────────────────────────

/** A task's comments as threads (top-level, oldest first, each with its replies). */
export async function listComments(actor: ActorContext, taskId: string) {
  const { role } = await loadTaskAccess(db(), actor, taskId);
  const [rows, files] = await Promise.all([
    db()
      .select({
        id: comments.id,
        parentCommentId: comments.parentCommentId,
        authorId: comments.authorId,
        authorName: users.name,
        body: comments.body,
        editedAt: comments.editedAt,
        deletedAt: comments.deletedAt,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.taskId, taskId))
      .orderBy(asc(comments.createdAt), asc(comments.id)),
    attachmentsForTask(db(), taskId),
  ]);
  const ids = rows.map((r) => r.id);
  const mentionRows = ids.length
    ? await db()
        .select({ commentId: commentMentions.commentId, userId: users.id, name: users.name })
        .from(commentMentions)
        .innerJoin(users, eq(users.id, commentMentions.userId))
        .where(inArray(commentMentions.commentId, ids))
    : [];

  const shape = (r: (typeof rows)[number]) => {
    const deleted = Boolean(r.deletedAt);
    return {
      id: r.id,
      authorId: r.authorId,
      authorName: r.authorName,
      body: deleted ? "" : r.body,
      deleted,
      editedAt: r.editedAt,
      createdAt: r.createdAt,
      mentions: mentionRows.filter((m) => m.commentId === r.id).map(({ userId, name }) => ({ userId, name })),
      attachments: files
        .filter((f) => f.commentId === r.id)
        .map((f) => ({ ...f, canDelete: canDeleteAttachment(actor, role, f) })),
      can: {
        edit: !deleted && canEditComment(actor, role, r),
        delete: !deleted && canDeleteComment(actor, role, r),
      },
    };
  };
  const threads = rows
    .filter((r) => !r.parentCommentId)
    .map((r) => ({
      ...shape(r),
      replies: rows.filter((c) => c.parentCommentId === r.id && !c.deletedAt).map(shape),
    }))
    // A deleted comment stays as a placeholder only while it still has replies.
    .filter((t) => !t.deleted || t.replies.length > 0);
  return {
    threads,
    can: {
      comment: canProject(role, "comment.create"),
      attach: canProject(role, "attachment.upload"),
    },
  };
}
