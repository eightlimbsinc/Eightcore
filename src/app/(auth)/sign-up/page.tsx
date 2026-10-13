import type { Metadata } from "next";
import { Suspense } from "react";
import { FormHeading } from "@/components/auth/form-heading";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <>
      <FormHeading title="Create your account" description="You'll confirm your email before signing in." />
      <Suspense>
        <SignUpForm />
      </Suspense>
    </>
  );
}
