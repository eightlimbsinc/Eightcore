"use client";
import { useState, useTransition } from "react";
import { Dialog } from "radix-ui";
import { deleteProjectAction } from "@/modules/projects/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

/** "Delete project": permanent, so the project key must be typed to confirm. */
export function DeleteProjectDialog({
  workspaceSlug,
  project,
  open,
  onOpenChange,
}: {
  workspaceSlug: string;
  project: { id: string; key: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matches = typed.trim().toUpperCase() === project.key;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setTyped("");
          setError(null);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <Dialog.Content
          aria-describedby="delete-project-warning"
          className="bg-surface text-foreground fixed top-[20vh] left-1/2 z-[60] grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 gap-3 rounded-xl border p-5 shadow-2xl"
        >
          <Dialog.Title className="text-base font-semibold">Delete “{project.name}”?</Dialog.Title>
          <p id="delete-project-warning" className="text-muted-foreground text-[13px]">
            This permanently deletes the project with all its folders, lists, tasks, comments, files, docs,
            custom fields, tags and automations. It can&apos;t be undone. To keep the work but hide it,
            archive the project instead.
          </p>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!matches) return;
              startTransition(async () => {
                const r = await deleteProjectAction(workspaceSlug, project.id, typed);
                if (r && !r.ok) setError(r.message);
              });
            }}
          >
            <label className="grid gap-1.5 text-[13px]">
              <span>
                Type <strong className="font-mono">{project.key}</strong> to confirm
              </span>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                aria-label="Project key to confirm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" variant="destructive" disabled={!matches || pending}>
                {pending ? "Deleting…" : "Delete project"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The project page's "Delete project" button (owners and admins). */
export function DeleteProjectButton({
  workspaceSlug,
  project,
}: {
  workspaceSlug: string;
  project: { id: string; key: string; name: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
        Delete project…
      </Button>
      <DeleteProjectDialog
        workspaceSlug={workspaceSlug}
        project={project}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
