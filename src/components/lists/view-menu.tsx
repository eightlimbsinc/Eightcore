"use client";
import Link from "next/link";
import { useTransition } from "react";
import { Popover } from "radix-ui";
import { Check, Lock, LockOpen, Save, SlidersHorizontal, Undo2 } from "lucide-react";
import { saveListViewAction, setListViewProtectedAction } from "@/modules/lists/actions";
import { sameView, viewQuery, type ViewSettings } from "@/modules/lists/view-settings";
import { cn } from "@/lib/utils";

const CHOICES: { key: keyof ViewSettings; title: string; options: [string, string][] }[] = [
  {
    key: "order",
    title: "Status groups",
    options: [
      ["asc", "First status first"],
      ["desc", "Last status first"],
    ],
  },
  {
    key: "subtasks",
    title: "Subtasks",
    options: [
      ["collapsed", "Collapsed"],
      ["expanded", "Expanded"],
    ],
  },
  {
    key: "closed",
    title: "Closed tasks",
    options: [
      ["show", "Show"],
      ["hide", "Hide"],
    ],
  },
];

/**
 * The list's view options. Changes apply right away (and live in the address bar, so they
 * can be shared); "Save view" makes them everyone's default. Managers can protect the view.
 */
export function ViewMenu({
  workspaceSlug,
  listId,
  view,
  saved,
  isProtected,
  canSave,
  canProtect,
}: {
  workspaceSlug: string;
  listId: string;
  view: ViewSettings;
  saved: ViewSettings;
  isProtected: boolean;
  canSave: boolean;
  canProtect: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const base = `/w/${workspaceSlug}/l/${listId}`;
  const dirty = !sameView(view, saved);
  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      const result = (await fn()) as { ok: boolean; message?: string } | undefined;
      if (result && !result.ok && result.message) alert(result.message);
    });

  return (
    <Popover.Root>
      <Popover.Trigger
        className="border-input bg-surface hover:bg-surface-muted inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm [&_svg]:size-4"
        aria-label={`View options${dirty ? " (unsaved changes)" : ""}${isProtected ? " (protected)" : ""}`}
      >
        <SlidersHorizontal /> View
        {isProtected ? <Lock className="text-muted-foreground" aria-hidden /> : null}
        {dirty ? <span className="bg-accent size-2 rounded-full" aria-hidden /> : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="bg-surface text-foreground z-50 w-72 rounded-lg border p-2 shadow-lg"
        >
          {CHOICES.map(({ key, title, options }) => (
            <div key={key} className="grid gap-0.5 pb-2" role="group" aria-label={title}>
              <p className="text-muted-foreground px-2 pt-1 text-[11px] font-medium tracking-wide uppercase">
                {title}
              </p>
              {options.map(([value, label]) => {
                const on = view[key] === value;
                return (
                  <Link
                    key={value}
                    href={`${base}${viewQuery({ ...view, [key]: value } as ViewSettings, saved)}`}
                    aria-current={on ? "true" : undefined}
                    className={cn(
                      "hover:bg-surface-muted flex items-center justify-between rounded-md px-2 py-1.5 text-[13px]",
                      on && "font-medium",
                    )}
                  >
                    {label}
                    {on ? <Check className="size-4" aria-hidden /> : null}
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="grid gap-1 border-t pt-2">
            {dirty ? (
              <>
                {canSave ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => saveListViewAction(workspaceSlug, listId, view))}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-60"
                  >
                    <Save className="size-4" /> {pending ? "Saving…" : "Save view for everyone"}
                  </button>
                ) : (
                  <p className="text-muted-foreground px-2 text-[12px]">
                    {isProtected
                      ? "This view is protected: only managers can save changes. Yours apply to you only."
                      : "Only you see these changes."}
                  </p>
                )}
                <Link
                  href={base}
                  className="text-muted-foreground hover:text-foreground flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-[13px]"
                >
                  <Undo2 className="size-4" /> Back to the saved view
                </Link>
              </>
            ) : (
              <p className="text-muted-foreground px-2 text-[12px]">This is the list&apos;s saved view.</p>
            )}
            {canProtect ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setListViewProtectedAction(workspaceSlug, listId, !isProtected))}
                className="hover:bg-surface-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] disabled:opacity-60"
              >
                {isProtected ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
                <span className="flex-1">{isProtected ? "Unprotect view" : "Protect view"}</span>
                <span className="text-muted-foreground text-[11px]">
                  {isProtected ? "managers only" : "anyone who edits"}
                </span>
              </button>
            ) : isProtected ? (
              <p className="text-muted-foreground flex items-center gap-1.5 px-2 text-[12px]">
                <Lock className="size-3.5" aria-hidden /> Protected by a manager
              </p>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
