"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword.length < MIN_PASSWORD_LENGTH)
      return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
    if (newPassword !== String(form.get("confirm"))) return setError("The passwords don't match");
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (error) return setError("This reset link is invalid or has expired. Request a new one.");
    setDone(true);
  }

  if (done) {
    return (
      <Alert variant="success">
        Password updated, and you’ve been signed out everywhere.{" "}
        <Link href="/sign-in" className="font-medium underline underline-offset-2">
          Sign in
        </Link>
      </Alert>
    );
  }
  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Field label="New password" htmlFor="password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
