import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { FormHeading } from "@/components/auth/form-heading";

export const metadata: Metadata = { title: "Check your email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return (
    <>
      <MailCheck className="text-accent mb-6 size-8" aria-hidden />
      <FormHeading
        title="Check your email"
        description={
          <>
            We sent a verification link to{" "}
            {email ? <strong className="text-foreground">{email}</strong> : "your inbox"}. Open it to finish
            setting up your account.
          </>
        }
      />
      <p className="text-muted-foreground">
        Already verified?{" "}
        <Link href="/sign-in" className="text-foreground font-medium underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
