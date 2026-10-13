"use client";
import { useActionState, useState, useTransition } from "react";
import { Mail, X } from "lucide-react";
import {
  changeMemberRoleAction,
  inviteMemberAction,
  revokeInvitationAction,
  setMemberStatusAction,
} from "@/modules/workspaces/actions";
import type { ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/utils";

const ROLES = ["owner", "admin", "member", "guest"] as const;
type Role = (typeof ROLES)[number];

interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "deactivated";
}

interface Permissions {
  invite: boolean;
  inviteAdmin: boolean;
  changeRole: boolean;
  manageOwners: boolean;
  deactivate: boolean;
}

export function InviteForm({
  workspaceSlug,
  canInviteAdmin,
}: {
  workspaceSlug: string;
  canInviteAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(inviteMemberAction.bind(null, workspaceSlug), undefined);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-3">
      {state ? <Alert variant={state.ok ? "success" : "destructive"}>{state.message ?? "Done"}</Alert> : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Field label="Email" htmlFor="invite-email" error={errors?.email}>
            <Input id="invite-email" name="email" type="email" required placeholder="name@agency.com" />
          </Field>
        </div>
        <Field label="Role" htmlFor="invite-role" error={errors?.role}>
          <NativeSelect id="invite-role" name="role" defaultValue="member">
            {canInviteAdmin ? <option value="admin">Admin</option> : null}
            <option value="member">Member</option>
            <option value="guest">Guest</option>
          </NativeSelect>
        </Field>
        <Button type="submit" disabled={pending}>
          <Mail /> {pending ? "Sending…" : "Send invite"}
        </Button>
      </div>
    </form>
  );
}

export function MembersTable({
  workspaceSlug,
  members,
  can,
  currentUserId,
}: {
  workspaceSlug: string;
  members: Member[];
  can: Permissions;
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionState>(undefined);

  function run(fn: () => Promise<ActionState>) {
    startTransition(async () => setResult(await fn()));
  }

  return (
    <div className="grid gap-3">
      {result && !result.ok ? <Alert variant="destructive">{result.message}</Alert> : null}
      <div className="bg-surface overflow-hidden rounded-lg border">
        <table className="w-full text-left">
          <thead className="bg-surface-muted/60 text-muted-foreground border-b text-[12px]">
            <tr>
              <th className="px-4 py-2 font-medium">Person</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {members.map((m) => {
              const isOwnerRow = m.role === "owner";
              const roleEditable = can.changeRole && (!isOwnerRow || can.manageOwners);
              const statusEditable = can.deactivate && (!isOwnerRow || can.manageOwners);
              return (
                <tr
                  key={m.userId}
                  className={m.status === "deactivated" ? "text-muted-foreground" : undefined}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="bg-accent-soft text-accent-foreground grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold">
                        {initials(m.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="text-foreground truncate font-medium">
                          {m.name}{" "}
                          {m.userId === currentUserId ? (
                            <span className="text-muted-foreground font-normal">(you)</span>
                          ) : null}
                        </div>
                        <div className="text-muted-foreground truncate text-[12px]">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {roleEditable && m.status === "active" ? (
                      <NativeSelect
                        aria-label={`Role for ${m.name}`}
                        value={m.role}
                        disabled={pending}
                        onChange={(e) =>
                          run(() => changeMemberRoleAction(workspaceSlug, m.userId, e.target.value))
                        }
                        className="h-8"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r} disabled={r === "owner" && !can.manageOwners}>
                            {r[0]!.toUpperCase() + r.slice(1)}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Badge variant={m.role === "owner" ? "accent" : "default"} className="capitalize">
                        {m.role}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {m.status === "active" ? (
                      <Badge variant="outline">Active</Badge>
                    ) : (
                      <Badge>Deactivated</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {statusEditable ? (
                      m.status === "active" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            if (
                              confirm(
                                `Deactivate ${m.name}? They lose access immediately; their history stays.`,
                              )
                            )
                              run(() => setMemberStatusAction(workspaceSlug, m.userId, "deactivated"));
                          }}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => setMemberStatusAction(workspaceSlug, m.userId, "active"))}
                        >
                          Reactivate
                        </Button>
                      )
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PendingInvitations({
  workspaceSlug,
  invitations,
}: {
  workspaceSlug: string;
  invitations: { id: string; email: string; role: string; expiresAt: Date }[];
}) {
  const [pending, startTransition] = useTransition();
  if (invitations.length === 0) return <p className="text-muted-foreground">No pending invitations.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {invitations.map((inv) => (
        <li key={inv.id} className="flex items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{inv.email}</div>
            <div className="text-muted-foreground text-[12px]">
              Expires {new Date(inv.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </div>
          </div>
          <Badge className="capitalize">{inv.role}</Badge>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Revoke invitation for ${inv.email}`}
            disabled={pending}
            onClick={() =>
              startTransition(async () => void (await revokeInvitationAction(workspaceSlug, inv.id)))
            }
          >
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}
