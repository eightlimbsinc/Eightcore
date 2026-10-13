import type { Metadata } from "next";
import { Suspense } from "react";
import { FormHeading } from "@/components/auth/form-heading";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <FormHeading title="Welcome back" description="Sign in to your Eightcore account." />
      <Suspense>
        <SignInForm />
      </Suspense>
    </>
  );
}
