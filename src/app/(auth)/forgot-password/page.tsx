import type { Metadata } from "next";
import Link from "next/link";
import { FormHeading } from "@/components/auth/form-heading";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <FormHeading title="Reset your password" description="We'll email you a link to choose a new one." />
      <ForgotPasswordForm />
      <p className="text-muted-foreground mt-6">
        <Link href="/sign-in" className="text-foreground font-medium underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
