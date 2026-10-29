"use client";
import { PersonAvatar } from "@/components/app/person-avatar";
import { startTransition, useActionState, useId, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

export interface Mentionable {
  userId: string;
  name: string;
}

/** "@query" right before the caret, if the caret is in a mention being typed. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[2]!.length - 1, query: match[2]! } : null;
}

/**
 * Comment text box with @mention suggestions. Picked people travel as hidden "mention"
 * fields; the server keeps those whose "@Name" is still in the text.
 */
export function CommentComposer({
  action: serverAction,
  members,
  label,
  placeholder,
  submitLabel,
  defaultBody = "",
  defaultMentionIds = [],
  allowFiles = false,
  autoFocus = false,
  onDone,
  onCancel,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  members: Mentionable[];
  label: string;
  placeholder?: string;
  submitLabel: string;
  defaultBody?: string;
  defaultMentionIds?: string[];
  allowFiles?: boolean;
  autoFocus?: boolean;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [state, action, pending] = useActionState(serverAction, undefined);
  const [body, setBody] = useState(defaultBody);
  const [mentionIds, setMentionIds] = useState<string[]>(defaultMentionIds);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [fileKey, setFileKey] = useState(0);
  const [seenState, setSeenState] = useState(state);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  // After a successful post, start over (adjusting state during render, not in an effect).
  if (state !== seenState) {
    setSeenState(state);
    if (state?.ok) {
      setBody(defaultBody);
      setMentionIds(defaultMentionIds);
      setFileKey((k) => k + 1);
      onDone?.();
    }
  }

  const suggestions = query
    ? members.filter((m) => m.name.toLowerCase().includes(query.query.toLowerCase())).slice(0, 6)
    : [];
  const open = suggestions.length > 0;

  function updateQuery(el: HTMLTextAreaElement) {
    setQuery(mentionQuery(el.value, el.selectionStart));
    setActive(0);
  }

  function pick(person: Mentionable) {
    if (!query || !textarea.current) return;
    const caret = textarea.current.selectionStart;
    const insert = `@${person.name} `;
    setBody(body.slice(0, query.start) + insert + body.slice(caret));
    setMentionIds((ids) => (ids.includes(person.userId) ? ids : [...ids, person.userId]));
    setQuery(null);
    const position = query.start + insert.length;
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(position, position);
    });
  }

  return (
    <form
      // Submitted by hand so React doesn't reset the form: on an error the text must stay.
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        // An empty file field still submits a blank entry; drop it.
        const files = form.getAll("files").filter((f) => typeof f !== "string" && f.size > 0);
        form.delete("files");
        files.forEach((f) => form.append("files", f));
        startTransition(() => action(form));
      }}
      className="grid gap-2"
    >
      <label htmlFor={`${id}-body`} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <Textarea
          ref={textarea}
          id={`${id}-body`}
          name="body"
          value={body}
          required
          maxLength={10_000}
          rows={3}
          autoFocus={autoFocus}
          placeholder={placeholder ?? "Write a comment… Type @ to mention someone"}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-mentions`}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${id}-option-${active}` : undefined}
          onChange={(e) => {
            setBody(e.target.value);
            updateQuery(e.target);
          }}
          onClick={(e) => updateQuery(e.currentTarget)}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(suggestions[active]!);
            } else if (e.key === "Escape") {
              setQuery(null);
            }
          }}
        />
        {open ? (
          <ul
            id={`${id}-mentions`}
            role="listbox"
            aria-label="People to mention"
            className="bg-surface absolute top-full left-0 z-20 mt-1 grid w-64 gap-0.5 rounded-md border p-1 shadow-lg"
          >
            {suggestions.map((person, i) => (
              <li
                key={person.userId}
                id={`${id}-option-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(person);
                }}
                className="aria-selected:bg-surface-muted flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-[13px]"
              >
                <PersonAvatar id={person.userId} name={person.name} size="xs" />
                {person.name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {mentionIds.map((userId) => (
        <input key={userId} type="hidden" name="mention" value={userId} />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? "Posting…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {allowFiles ? (
          <span className="text-muted-foreground flex items-center gap-1 text-[12px]">
            <Paperclip className="size-3.5" aria-hidden />
            <input
              key={fileKey}
              suppressHydrationWarning
              type="file"
              name="files"
              multiple
              aria-label="Attach files to this comment"
              className="max-w-52 text-[12px]"
            />
          </span>
        ) : null}
        {state && !state.ok ? (
          <span role="alert" className="text-destructive text-[12px]">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
