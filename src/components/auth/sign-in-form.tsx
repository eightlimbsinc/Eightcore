"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { safeRedirectPath } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeRedirectPath(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    params.get("signedOut") === "everywhere" ? "You've been signed out on every device." : null,
  );
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    setPending(true);
    setError(null);
    setNotice(null);
    const { error } = await authClient.signIn.email({ email, password: String(form.get("password")) });
    setPending(false);
    if (error) {
      if (error.status === 403) {
        setUnverifiedEmail(email);
        setError("Please verify your email address first. Check your inbox for the link.");
      } else if (error.status === 429) {
        setError("Too many attempts. Wait a minute and try again.");
      } else {
        setError("Incorrect email or password.");
      }
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function resend() {
    if (!unverifiedEmail) return;
    await authClient.sendVerificationEmail({ email: unverifiedEmail, callbackURL: next });
    setNotice("If that account needs verifying, a new link is on its way.");
    setError(null);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      {error ? (
        <Alert variant="destructive">
          {error}{" "}
          {unverifiedEmail ? (
            <button type="button" onClick={resend} className="font-medium underline underline-offset-2">
              Resend link
            </button>
          ) : null}
        </Alert>
      ) : null}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground text-[13px]">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-muted-foreground text-center">
        New to Eightcore?{" "}
        <Link
          href={`/sign-up${next !== "/w" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="text-foreground font-medium underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
