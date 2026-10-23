import { z } from "zod";

export const commentBody = z
  .string()
  .trim()
  .min(1, "Write something first")
  .max(10_000, "Comments can be at most 10,000 characters");

export const commentInput = z.object({
  body: commentBody,
  parentCommentId: z.uuid().optional(),
  /** People picked from the @mention list. Kept only if "@Name" is still in the text. */
  mentionIds: z.array(z.uuid()).max(50).default([]),
});
export type CommentInput = z.input<typeof commentInput>;

export const commentEditInput = z.object({
  body: commentBody,
  mentionIds: z.array(z.uuid()).max(50).default([]),
});
export type CommentEditInput = z.input<typeof commentEditInput>;

/** Users whose "@Name" appears in the text, from the candidates offered. */
export function mentionedIn(body: string, candidates: { userId: string; name: string }[]): string[] {
  const text = body.toLowerCase();
  return candidates.filter((c) => c.name && text.includes(`@${c.name.toLowerCase()}`)).map((c) => c.userId);
}
