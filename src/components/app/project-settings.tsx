"use client";
import { useActionState, useTransition, useState } from "react";
import { Archive, ChevronDown, UserPlus, X } from "lucide-react";
import { Popover } from "radix-ui";
import {
  setProjectArchivedAction,
  setProjectMemberAction,
  updateProjectAction,
} from "@/modules/projects/actions";
import type { ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { VisibilityOption } from "./create-project-form";

const PROJECT_ROLES = ["manager", "editor", "commenter", "viewer"] as const;

export function ProjectDetailsForm({
  workspaceSlug,
  project,
}: {
  workspaceSlug: string;
  project: { id: string; name: string; description: string; visibility: "workspace" | "private" };
}) {
  const [state, action, pending] = useActionState(
    updateProjectAction.bind(null, workspaceSlug, project.id),
    undefined,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-4">
      {state ? (
        <Alert variant={state.ok ? "success" : "destructive"}>{state.message ?? "Saved"}</Alert>
      ) : null}
      <Field label="Name" htmlFor="name" error={errors?.name}>
        <Input id="name" name="name" defaultValue={project.name} required maxLength={120} />
      </Field>
      <Field label="Description" htmlFor="description" error={errors?.description}>
        <Textarea id="description" name="description" defaultValue={project.description} maxLength={2000} />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-medium">Visibility</legend>
        <VisibilityOption
          value="workspace"
          defaultChecked={project.visibility === "workspace"}
          title="Workspace"
          text="Every workspace member can see and edit it."
        />
        <VisibilityOption
          value="private"
          defaultChecked={project.visibility === "private"}
          title="Private"
          text="Only people added below, plus workspace admins."
        />
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

interface Member {
  userId: string;
  name: string;
  email: string;
  role: (typeof PROJECT_ROLES)[number];
  workspaceRole: string;
  /** Guests: the lists they can see (null = all). */
  listIds: string[] | null;
}

type ListOption = { id: string; name: string; folder: string | null };

/** "All lists", or the lists a guest can see. `value` null = every list. */
function GuestListsPicker({
  label,
  lists,
  value,
  disabled,
  onChange,
}: {
  label: string;
  lists: ListOption[];
  value: string[] | null;
  disabled?: boolean;
  onChange: (next: string[] | null) => void;
}) {
  const [draft, setDraft] = useState<string[] | null>(value);
  const chosen = new Set(draft ?? []);
  const summary =
    value === null
      ? "All lists"
      : value.length === 0
        ? "No lists"
        : value.length === 1
          ? (lists.find((l) => l.id === value[0])?.name ?? "1 list")
          : `${value.length} lists`;
  const changed =
    JSON.stringify(draft === null ? null : [...draft].sort()) !==
    JSON.stringify(value === null ? null : [...value].sort());
  return (
    <Popover.Root onOpenChange={(open) => open && setDraft(value)}>
      <Popover.Trigger
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${summary}`}
        className="border-input bg-surface hover:bg-muted flex h-8 max-w-44 items-center gap-1 rounded-md border px-2 text-[13px] disabled:opacity-50"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="bg-surface text-foreground z-50 grid w-72 gap-2 rounded-lg border p-3 shadow-lg"
        >
          <p className="text-[13px] font-medium">Lists this guest can see</p>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={draft === null}
              onChange={(e) => setDraft(e.target.checked ? null : [])}
            />
            All lists in this project (including new ones)
          </label>
          {draft !== null ? (
            <div className="grid max-h-64 gap-1 overflow-y-auto border-t pt-2">
              {lists.length === 0 ? (
                <p className="text-muted-foreground text-[12px]">This project has no lists yet.</p>
              ) : null}
              {lists.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={chosen.has(l.id)}
                    onChange={(e) =>
                      setDraft(e.target.checked ? [...chosen, l.id] : [...chosen].filter((id) => id !== l.id))
                    }
                  />
                  <span className="truncate">
                    {l.folder ? <span className="text-muted-foreground">{l.folder} / </span> : null}
                    {l.name}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          <Popover.Close asChild>
            <Button type="button" size="sm" disabled={!changed} onClick={() => onChange(draft)}>
              Save
            </Button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ProjectMembers({
  workspaceSlug,
  projectId,
  members,
  candidates,
  lists,
  canManage,
  currentUserId,
}: {
  workspaceSlug: string;
  projectId: string;
  members: Member[];
  lists: ListOption[];
  candidates: { userId: string; name: string; email: string; role: string }[];
  canManage: boolean;
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionState>(undefined);
  const memberIds = new Set(members.map((m) => m.userId));
  const addable = candidates.filter(
    (c) => !memberIds.has(c.userId) && c.role !== "owner" && c.role !== "admin",
  );

  const [addId, setAddId] = useState(addable[0]?.userId ?? "");
  const addingGuest = addable.find((c) => c.userId === (addId || addable[0]?.userId))?.role === "guest";
  const [addLists, setAddLists] = useState<string[] | null>([]);

  function run(userId: string, role: string | null, listIds?: string[] | null) {
    startTransition(async () => {
      setResult(await setProjectMemberAction(workspaceSlug, projectId, userId, role, listIds));
    });
  }

  return (
    <div className="grid gap-4">
      {result && !result.ok ? <Alert variant="destructive">{result.message}</Alert> : null}
      <ul className="divide-y rounded-md border">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {m.name}{" "}
                {m.userId === currentUserId ? <span className="text-muted-foreground">(you)</span> : null}
              </div>
              <div className="text-muted-foreground truncate text-[12px]">{m.email}</div>
            </div>
            {m.workspaceRole === "guest" ? <Badge variant="outline">Guest</Badge> : null}
            {m.workspaceRole === "guest" && canManage ? (
              <GuestListsPicker
                label={`Lists ${m.name} can see`}
                lists={lists}
                value={m.listIds}
                disabled={pending}
                onChange={(next) => run(m.userId, m.role, next)}
              />
            ) : null}
            {canManage ? (
              <>
                <NativeSelect
                  aria-label={`Project role for ${m.name}`}
                  value={m.role}
                  disabled={pending}
                  onChange={(e) => run(m.userId, e.target.value)}
                  className="h-8 w-32 capitalize"
                >
                  {PROJECT_ROLES.map((r) => (
                    <option key={r} value={r} disabled={m.workspaceRole === "guest" && r === "manager"}>
                      {r}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${m.name}`}
                  disabled={pending}
                  onClick={() => run(m.userId, null)}
                >
                  <X />
                </Button>
              </>
            ) : (
              <Badge className="capitalize">{m.role}</Badge>
            )}
          </li>
        ))}
      </ul>
      {canManage && addable.length > 0 ? (
        <form
          method="post"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            if (addingGuest && addLists !== null && addLists.length === 0) {
              setResult({ ok: false, message: "Choose the lists this guest can see" });
              return;
            }
            run(String(form.get("userId")), String(form.get("role")), addingGuest ? addLists : undefined);
            setAddLists([]);
          }}
        >
          <Field label="Add person" htmlFor="add-member">
            <NativeSelect
              id="add-member"
              name="userId"
              required
              className="w-full"
              value={addId || addable[0]?.userId}
              onChange={(e) => setAddId(e.target.value)}
            >
              {addable.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name} ({c.email}){c.role === "guest" ? " · guest" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {addingGuest ? (
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span>Lists this guest can see</span>
              <GuestListsPicker
                label="Lists the new guest can see"
                lists={lists}
                value={addLists}
                onChange={setAddLists}
              />
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Role" htmlFor="add-role">
                <NativeSelect id="add-role" name="role" defaultValue="editor" className="w-full capitalize">
                  {PROJECT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Button type="submit" variant="outline" disabled={pending}>
              <UserPlus /> Add
            </Button>
          </div>
        </form>
      ) : null}
      <p className="text-muted-foreground text-[12px]">
        Workspace owners and admins always manage every project. Guests can be at most editors, and see only
        the lists you choose for them.
      </p>
    </div>
  );
}

export function ArchiveProjectButton({
  workspaceSlug,
  projectId,
}: {
  workspaceSlug: string;
  projectId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (!confirm("Archive this project? It disappears from the sidebar for everyone.")) return;
            startTransition(async () => {
              const result = await setProjectArchivedAction(workspaceSlug, projectId, true);
              if (result && !result.ok) setError(result.message);
            });
          }}
        >
          <Archive /> {pending ? "Archiving…" : "Archive project"}
        </Button>
      </div>
    </div>
  );
}
