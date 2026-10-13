"use client";
import { useActionState } from "react";
import { acceptInvitationAction } from "@/modules/workspaces/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function AcceptInvitation({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitationAction.bind(null, token), undefined);
  return (
    <form action={action} className="grid gap-3">
      {state && !state.ok ? <Alert variant="destructive">{state.message}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </form>
  );
}
