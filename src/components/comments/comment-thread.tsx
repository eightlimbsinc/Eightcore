"use client";
import { PersonAvatar } from "@/components/app/person-avatar";
import { useState, useTransition } from "react";
import { Pencil, Reply, Trash2 } from "lucide-react";
import { createCommentAction, deleteCommentAction, updateCommentAction } from "@/modules/comments/actions";
import { Alert } from "@/components/ui/alert";
import { AttachmentList, type AttachmentItem } from "@/components/tasks/task-side-panels";
import { CommentComposer, type Mentionable } from "./comment-composer";

export interface CommentView {
  authorId: string;
  id: string;
  authorName: string;
  body: string;
  deleted: boolean;
  editedAt: Date | null;
  createdAt: Date;
  mentions: Mentionable[];
  attachments: AttachmentItem[];
  can: { edit: boolean; delete: boolean };
}

export interface ThreadView extends CommentView {
  replies: CommentView[];
}

const timeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Plain text, with "@Name" highlighted for the people actually mentioned. */
function CommentBody({ body, mentions }: { body: string; mentions: Mentionable[] }) {
  if (!mentions.length) return <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{body}</p>;
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length).map((m) => escapeRegExp(m.name));
  const parts = body.split(new RegExp(`(@(?:${names.join("|")}))`, "gi"));
  return (
    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="bg-accent-soft text-accent-foreground rounded-sm px-0.5 font-medium">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function CommentItem({
  workspaceSlug,
  comment,
  members,
  onReply,
}: {
  workspaceSlug: string;
  comment: CommentView;
  members: Mentionable[];
  onReply?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (comment.deleted) {
    return <p className="text-muted-foreground py-1 text-[13px] italic">This comment was deleted.</p>;
  }
  return (
    <article className="flex gap-3" aria-label={`Comment by ${comment.authorName}`}>
      <PersonAvatar id={comment.authorId} name={comment.authorName} size="md" />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <strong className="text-[13px] font-medium">{comment.authorName}</strong>
          <time
            dateTime={new Date(comment.createdAt).toISOString()}
            className="text-muted-foreground text-[11px]"
          >
            {timeFormat.format(new Date(comment.createdAt))}
          </time>
          {comment.editedAt ? <span className="text-muted-foreground text-[11px]">(edited)</span> : null}
        </div>
        {editing ? (
          <CommentComposer
            action={updateCommentAction.bind(null, workspaceSlug, comment.id)}
            members={members}
            label="Edit comment"
            submitLabel="Save"
            defaultBody={comment.body}
            defaultMentionIds={comment.mentions.map((m) => m.userId)}
            autoFocus
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <CommentBody body={comment.body} mentions={comment.mentions} />
        )}
        <AttachmentList workspaceSlug={workspaceSlug} files={comment.attachments} />
        {!editing ? (
          <div className="text-muted-foreground flex gap-3 text-[12px]">
            {onReply ? (
              <button
                type="button"
                onClick={onReply}
                className="hover:text-foreground inline-flex items-center gap-1"
              >
                <Reply className="size-3" aria-hidden /> Reply
              </button>
            ) : null}
            {comment.can.edit ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="hover:text-foreground inline-flex items-center gap-1"
              >
                <Pencil className="size-3" aria-hidden /> Edit
              </button>
            ) : null}
            {comment.can.delete ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm("Delete this comment and its files?")) return;
                  startTransition(async () => {
                    const result = await deleteCommentAction(workspaceSlug, comment.id);
                    setError(result && !result.ok ? result.message : null);
                  });
                }}
                className="hover:text-destructive inline-flex items-center gap-1"
              >
                <Trash2 className="size-3" aria-hidden /> Delete
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? <Alert variant="destructive">{error}</Alert> : null}
      </div>
    </article>
  );
}

export function CommentsSection({
  workspaceSlug,
  taskId,
  threads,
  members,
  canComment,
  canAttach,
}: {
  workspaceSlug: string;
  taskId: string;
  threads: ThreadView[];
  members: Mentionable[];
  canComment: boolean;
  canAttach: boolean;
}) {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  return (
    <div className="grid gap-5">
      {threads.length ? (
        <ol className="grid gap-5">
          {threads.map((thread) => (
            <li key={thread.id} className="grid gap-3">
              <CommentItem
                workspaceSlug={workspaceSlug}
                comment={thread}
                members={members}
                onReply={canComment && !thread.deleted ? () => setReplyTo(thread.id) : undefined}
              />
              {thread.replies.length || replyTo === thread.id ? (
                <ol className="ml-10 grid gap-3 border-l pl-4">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentItem workspaceSlug={workspaceSlug} comment={reply} members={members} />
                    </li>
                  ))}
                  {replyTo === thread.id ? (
                    <li>
                      <CommentComposer
                        action={createCommentAction.bind(null, workspaceSlug, taskId, thread.id)}
                        members={members}
                        label={`Reply to ${thread.authorName}`}
                        placeholder="Write a reply…"
                        submitLabel="Reply"
                        allowFiles={canAttach}
                        autoFocus
                        onDone={() => setReplyTo(null)}
                        onCancel={() => setReplyTo(null)}
                      />
                    </li>
                  ) : null}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground">No comments yet.</p>
      )}
      {canComment ? (
        <div className="border-t pt-4">
          <CommentComposer
            action={createCommentAction.bind(null, workspaceSlug, taskId, null)}
            members={members}
            label="New comment"
            submitLabel="Comment"
            allowFiles={canAttach}
          />
        </div>
      ) : null}
    </div>
  );
}
