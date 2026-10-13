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
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";

export function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeRedirectPath(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name")).trim();
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    const errors: Record<string, string> = {};
    if (!name) errors.name = "Enter your name";
    if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = "Enter a valid email";
    if (password.length < MIN_PASSWORD_LENGTH)
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters`;
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({ name, email, password, callbackURL: next });
    setPending(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : error.code === "USER_ALREADY_EXISTS" || error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
            ? "An account with that email already exists. Try signing in."
            : (error.message ?? "Couldn't create the account."),
      );
      return;
    }
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Field label="Full name" htmlFor="name" error={fieldErrors.name}>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          autoFocus
          aria-invalid={!!fieldErrors.name}
        />
      </Field>
      <Field label="Work email" htmlFor="email" error={fieldErrors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={!!fieldErrors.email}
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        error={fieldErrors.password}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A passphrase works well.`}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-invalid={!!fieldErrors.password}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-muted-foreground text-center">
        Already have an account?{" "}
        <Link
          href={`/sign-in${next !== "/w" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="text-foreground font-medium underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
