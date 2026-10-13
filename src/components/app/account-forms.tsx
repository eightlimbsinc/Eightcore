"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

export function ChangePasswordForm() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const newPassword = String(form.get("newPassword"));
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return setResult({ ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (newPassword !== String(form.get("confirm")))
      return setResult({ ok: false, message: "The passwords don't match" });
    setPending(true);
    const { error } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword")),
      newPassword,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) {
      return setResult({
        ok: false,
        message:
          error.status === 429
            ? "Too many attempts. Try again in a minute."
            : "Your current password is incorrect.",
      });
    }
    formEl.reset();
    setResult({ ok: true, message: "Password changed. Other devices have been signed out." });
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-sm gap-4">
      {result ? <Alert variant={result.ok ? "success" : "destructive"}>{result.message}</Alert> : null}
      <Field label="Current password" htmlFor="currentPassword">
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="New password" htmlFor="newPassword" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
