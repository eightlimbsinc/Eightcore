"use client";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { Maximize2, X } from "lucide-react";

/**
 * A task opened from a list shows in this window; the address bar still shows the task's
 * own link, so it can be shared or reloaded as a full page. Closing goes back.
 */
export function TaskModal({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Dialog.Root open onOpenChange={(open) => !open && router.back()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="bg-background fixed inset-x-2 top-4 bottom-4 z-50 mx-auto flex max-w-6xl flex-col overflow-hidden rounded-xl border shadow-2xl sm:inset-x-6 sm:top-8 sm:bottom-8"
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** "Open full page" and close, shown in the task header inside the window. */
export function TaskModalControls({ href }: { href: string }) {
  const router = useRouter();
  return (
    <span className="flex items-center gap-1">
      {/* A plain link with a full load, so the task opens as its own page instead of this window. */}
      <a
        href={href}
        aria-label="Open full page"
        title="Open full page"
        className="text-muted-foreground hover:text-foreground hover:bg-surface-muted grid size-8 place-items-center rounded-md"
      >
        <Maximize2 className="size-4" />
      </a>
      <button
        type="button"
        aria-label="Close"
        title="Close (Esc)"
        onClick={() => router.back()}
        className="text-muted-foreground hover:text-foreground hover:bg-surface-muted grid size-8 place-items-center rounded-md"
      >
        <X className="size-4" />
      </button>
    </span>
  );
}
