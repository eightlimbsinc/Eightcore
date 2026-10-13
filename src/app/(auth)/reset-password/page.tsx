import type { Metadata } from "next";
import Link from "next/link";
import { FormHeading } from "@/components/auth/form-heading";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return (
    <>
      <FormHeading title="Choose a new password" />
      {!token || error ? (
        <Alert variant="destructive">
          This reset link is invalid or has expired.{" "}
          <Link href="/forgot-password" className="font-medium underline underline-offset-2">
            Request a new one
          </Link>
        </Alert>
      ) : (
        <ResetPasswordForm token={token} />
      )}
    </>
  );
}
