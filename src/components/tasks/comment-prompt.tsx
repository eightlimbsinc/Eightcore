"use client";
import { useRef, useState } from "react";
import { Dialog } from "radix-ui";
import type { ActionState } from "@/lib/action-state";

/** The server refused a status change because a rule asks for a comment. */
export const needsComment = (result: ActionState) =>
  Boolean(result && !result.ok && result.fieldErrors?.transition === "comment");

/**
 * Asks for the comment a status rule requires: `ask("Ready to Test")` opens a small window and
 * resolves with the text, or null if cancelled. Render `prompt` once in the component.
 */
export function useCommentPrompt() {
  const [open, setOpen] = useState<{ status: string; reason: string } | null>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);
  const [text, setText] = useState("");

  const ask = (status: string, reason: string) =>
    new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setText("");
      setOpen({ status, reason });
    });
  const finish = (value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(null);
  };

  const prompt = (
    <Dialog.Root open={open !== null} onOpenChange={(o) => !o && finish(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <Dialog.Content
          aria-describedby="comment-prompt-reason"
          className="bg-surface text-foreground fixed top-[20vh] left-1/2 z-[60] grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 gap-3 rounded-xl border p-5 shadow-2xl"
        >
          <Dialog.Title className="text-base font-semibold">Add a comment</Dialog.Title>
          <p id="comment-prompt-reason" className="text-muted-foreground text-[13px]">
            {open?.reason}
          </p>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) finish(text.trim());
            }}
          >
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
              }}
              rows={4}
              maxLength={10_000}
              aria-label="Comment"
              placeholder="What changed? e.g. Deployed to staging, ready for QA"
              className="border-input bg-surface rounded-md border p-2 text-[13px]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => finish(null)}
                className="hover:bg-surface-muted h-9 rounded-md border px-3 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!text.trim()}
                className="bg-primary text-primary-foreground h-9 rounded-md px-3 text-sm font-medium disabled:opacity-50"
              >
                Move to {open?.status}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
  return { ask, prompt };
}
