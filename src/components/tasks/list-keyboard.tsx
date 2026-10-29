"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Keyboard, X } from "lucide-react";

const SHORTCUTS: [string[], string][] = [
  [["↓", "j"], "Next task"],
  [["↑", "k"], "Previous task"],
  [["Enter", "o"], "Open the task"],
  [["x"], "Select or unselect (for bulk actions)"],
  [["→", "l"], "Show subtasks"],
  [["←", "h"], "Hide subtasks"],
  [["Menu", "Shift F10"], "Task actions"],
  [["n"], "New task"],
  [["/"], "Search"],
  [["Esc"], "Stop navigating"],
  [["?"], "Show these shortcuts"],
];

/** Typing somewhere, or working in a menu or window: leave the keys alone. */
function isBusy(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  return Boolean(
    el.closest(
      "input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=true], [role=menu], [role=listbox], [role=dialog]",
    ),
  );
}

/**
 * Keyboard navigation for the list view: moves focus between task rows (any element with
 * `data-row` inside it) and acts on the focused row. Renders the "Keyboard shortcuts" help.
 */
export function ListKeyboard({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isBusy(e.target)) return;
      const container = root.current;
      if (!container) return;
      const rows = [...container.querySelectorAll<HTMLElement>("[data-row]")];
      const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-row]");
      const index = current ? rows.indexOf(current) : -1;
      const focusRow = (i: number) => {
        const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
        if (!row) return;
        row.focus();
        row.scrollIntoView({ block: "nearest" });
      };
      const key = e.key;
      const handled = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (key === "?") return handled(() => setHelp((h) => !h));
      if (key === "/") {
        const search = document.querySelector<HTMLInputElement>('input[aria-label="Search tasks"]');
        if (search) handled(() => search.focus());
        return;
      }
      if (key === "n") {
        const add = document.querySelector<HTMLElement>("[data-add-task]");
        if (add) handled(() => add.click());
        return;
      }
      if (key === "ArrowDown" || key === "j") return handled(() => focusRow(index + 1));
      if (key === "ArrowUp" || key === "k") return handled(() => focusRow(index === -1 ? 0 : index - 1));
      // The rest act on the focused row itself (not a button inside it, which has its own keys).
      if (!current || document.activeElement !== current) return;
      if (key === "Escape") return handled(() => current.blur());
      if (key === "Enter" || key === "o") {
        const link = current.querySelector<HTMLAnchorElement>('a[href*="/t/"]');
        if (link) handled(() => link.click());
        return;
      }
      if (key === "x") {
        const box = current.querySelector<HTMLInputElement>("input[data-bulk-id]");
        if (box) handled(() => box.click());
        return;
      }
      if (key === "ArrowRight" || key === "l" || key === "ArrowLeft" || key === "h") {
        const open = key === "ArrowRight" || key === "l";
        const toggle = current.querySelector<HTMLButtonElement>("button[aria-expanded]");
        if (toggle && (toggle.getAttribute("aria-expanded") === "true") !== open)
          handled(() => toggle.click());
        else if (!open) {
          // Already collapsed: go up to the parent task.
          const parentRow = current
            .closest("li")
            ?.parentElement?.closest("li")
            ?.querySelector<HTMLElement>("[data-row]");
          if (parentRow) handled(() => parentRow.focus());
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={root}>
      {children}
      <Dialog.Root open={help} onOpenChange={setHelp}>
        <Dialog.Trigger
          className="text-muted-foreground hover:text-foreground mt-2 inline-flex items-center gap-1.5 text-[12px]"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="size-3.5" aria-hidden /> Keyboard shortcuts
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            aria-describedby={undefined}
            className="bg-surface text-foreground fixed top-[15vh] left-1/2 z-50 grid w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 gap-3 rounded-xl border p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-base font-semibold">Keyboard shortcuts</Dialog.Title>
              <Dialog.Close aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13px]">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={what} className="contents">
                  <dt className="flex gap-1">
                    {keys.map((k) => (
                      <kbd
                        key={k}
                        className="bg-surface-muted rounded border px-1.5 py-0.5 font-mono text-[11px]"
                      >
                        {k}
                      </kbd>
                    ))}
                  </dt>
                  <dd className="text-muted-foreground">{what}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted-foreground text-[12px]">Also: Ctrl K / ⌘K to search or jump anywhere.</p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
