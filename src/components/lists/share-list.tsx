"use client";
import { useEffect, useState, useTransition } from "react";
import { Dialog } from "radix-ui";
import { Mail, UserPlus, X } from "lucide-react";
import {
  inviteGuestToListAction,
  listSharingAction,
  shareListAction,
  unshareListAction,
  type ListSharing,
} from "@/modules/projects/sharing-actions";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const ROLES = [
  { value: "viewer", label: "Can view" },
  { value: "commenter", label: "Can comment" },
  { value: "editor", label: "Can edit" },
] as const;

/** "Share & permissions" for one list: guests who see it, add or invite guests, change or remove access. */
export function ShareListDialog({
  workspaceSlug,
  list,
  onClose,
}: {
  workspaceSlug: string;
  list: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ listId: string; sharing: ListSharing } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState("");
  const [pickRole, setPickRole] = useState<string>("commenter");
  const [email, setEmail] = useState("");
  const [emailRole, setEmailRole] = useState<string>("commenter");
  const listId = list?.id ?? null;

  const reload = (id: string) =>
    listSharingAction(workspaceSlug, id).then((r) => {
      if (r.ok) setData({ listId: id, sharing: r.sharing });
      else setError(r.message);
    });

  useEffect(() => {
    if (!listId) return;
    let live = true;
    listSharingAction(workspaceSlug, listId)
      .then((r) => {
        if (!live) return;
        if (r.ok) setData({ listId, sharing: r.sharing });
        else setError(r.message);
      })
      .catch(() => live && setError("Couldn't load sharing. Try again."));
    return () => {
      live = false;
    };
  }, [workspaceSlug, listId]);

  const sharing = data && data.listId === listId ? data.sharing : null;
  const run = (fn: () => Promise<{ ok: boolean; message?: string } | undefined>, after?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (r && !r.ok) {
        setError(r.message ?? "Something went wrong");
        return;
      }
      setError(null);
      setNotice(r?.message ?? null);
      after?.();
      if (listId) await reload(listId);
    });

  return (
    <Dialog.Root
      open={!!list}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setError(null);
          setNotice(null);
          setPick("");
          setEmail("");
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <Dialog.Content
          aria-describedby="share-list-about"
          className="bg-surface text-foreground fixed top-[12vh] left-1/2 z-[60] grid max-h-[76vh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 gap-4 overflow-y-auto rounded-xl border p-5 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-base font-semibold">Share “{list?.name}”</Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <p id="share-list-about" className="text-muted-foreground text-[13px]">
            {sharing?.project.visibility === "private"
              ? `Members see this list if they're on the ${sharing.project.name} project. `
              : `Everyone in the workspace (except guests) can see this list. `}
            Guests only see the lists shared with them.
          </p>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          {notice ? (
            <p role="status" className="text-[13px] text-emerald-700 dark:text-emerald-400">
              {notice}
            </p>
          ) : null}

          {!sharing && !error ? <p className="text-muted-foreground text-[13px]">Loading…</p> : null}
          {sharing ? (
            <>
              <section aria-label="Guests with access" className="grid gap-2">
                <h3 className="text-[13px] font-semibold">Guests with access</h3>
                {sharing.guests.length === 0 ? (
                  <p className="text-muted-foreground text-[13px]">No guests yet.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {sharing.guests.map((g) => (
                      <li key={g.userId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{g.name}</div>
                          <div className="text-muted-foreground truncate text-[12px]">{g.email}</div>
                        </div>
                        {g.scope === "project" ? <Badge variant="outline">Whole project</Badge> : null}
                        <NativeSelect
                          aria-label={`Access for ${g.name}`}
                          value={g.role === "manager" ? "editor" : g.role}
                          disabled={pending}
                          onChange={(e) =>
                            run(() => shareListAction(workspaceSlug, list!.id, g.userId, e.target.value))
                          }
                          className="h-8 w-36"
                        >
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </NativeSelect>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${g.name} from this list`}
                          disabled={pending}
                          onClick={() => {
                            const note =
                              g.scope === "project" ? " They'll keep the project's other lists." : "";
                            if (confirm(`Stop sharing “${list!.name}” with ${g.name}?${note}`))
                              run(() => unshareListAction(workspaceSlug, list!.id, g.userId));
                          }}
                        >
                          <X />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {sharing.pending.length ? (
                  <p className="text-muted-foreground text-[12px]">
                    Invited, waiting to accept: {sharing.pending.map((p) => p.email).join(", ")}
                  </p>
                ) : null}
              </section>

              {sharing.candidates.length ? (
                <form
                  aria-label="Add a guest"
                  className="grid gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (pick)
                      run(
                        () => shareListAction(workspaceSlug, list!.id, pick, pickRole),
                        () => setPick(""),
                      );
                  }}
                >
                  <h3 className="text-[13px] font-semibold">Add a guest</h3>
                  <div className="flex flex-wrap gap-2">
                    <NativeSelect
                      aria-label="Guest"
                      value={pick}
                      onChange={(e) => setPick(e.target.value)}
                      className="h-9 min-w-48 flex-1"
                    >
                      <option value="">Choose a guest…</option>
                      {sharing.candidates.map((c) => (
                        <option key={c.userId} value={c.userId}>
                          {c.name} ({c.email})
                        </option>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      aria-label="Their access"
                      value={pickRole}
                      onChange={(e) => setPickRole(e.target.value)}
                      className="h-9 w-36"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button type="submit" variant="outline" disabled={!pick || pending}>
                      <UserPlus /> Add
                    </Button>
                  </div>
                </form>
              ) : null}

              {sharing.canInvite ? (
                <form
                  aria-label="Invite a guest by email"
                  className="grid gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (email.trim())
                      run(
                        () => inviteGuestToListAction(workspaceSlug, list!.id, email, emailRole),
                        () => setEmail(""),
                      );
                  }}
                >
                  <h3 className="text-[13px] font-semibold">Invite someone new as a guest</h3>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      type="email"
                      aria-label="Email"
                      placeholder="client@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-9 min-w-48 flex-1"
                    />
                    <NativeSelect
                      aria-label="Their access when they join"
                      value={emailRole}
                      onChange={(e) => setEmailRole(e.target.value)}
                      className="h-9 w-36"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button type="submit" disabled={!email.trim() || pending}>
                      <Mail /> Invite
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-[12px]">
                    They get an email; once they accept, they see only this list (and any others shared with
                    them).
                  </p>
                </form>
              ) : null}
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The list header's "Share" button. */
export function ShareListButton({
  workspaceSlug,
  list,
}: {
  workspaceSlug: string;
  list: { id: string; name: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus /> Share
      </Button>
      <ShareListDialog
        workspaceSlug={workspaceSlug}
        list={open ? list : null}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
