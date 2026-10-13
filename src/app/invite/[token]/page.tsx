import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/server/auth/session";
import { previewInvitation } from "@/modules/workspaces/queries";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { AcceptInvitation } from "@/components/app/accept-invitation";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invitation, session] = await Promise.all([previewInvitation(token), getSession()]);
  const here = `/invite/${token}`;

  let body: React.ReactNode;
  if (invitation.status === "invalid") {
    body = (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Invitation unavailable</h1>
        <p className="text-muted-foreground mt-2">
          This invitation is invalid, has expired, or was already used. Ask the person who invited you for a
          new one.
        </p>
      </>
    );
  } else {
    const intro = (
      <>
        <p className="text-accent-foreground mb-2 text-[11px] font-medium tracking-[0.2em] uppercase">
          Invitation
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Join {invitation.workspaceName}</h1>
        <p className="text-muted-foreground mt-2 mb-8">
          You’ve been invited as {invitation.role === "admin" ? "an" : "a"}{" "}
          <strong className="text-foreground">{invitation.role}</strong> using{" "}
          <strong className="text-foreground">{invitation.email}</strong>.
        </p>
      </>
    );
    if (!session) {
      body = (
        <>
          {intro}
          <div className="grid gap-2">
            <Button asChild>
              <Link href={`/sign-up?next=${encodeURIComponent(here)}`}>Create an account</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/sign-in?next=${encodeURIComponent(here)}`}>I already have an account</Link>
            </Button>
          </div>
        </>
      );
    } else if (session.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      body = (
        <>
          {intro}
          <Alert variant="destructive">
            You’re signed in as {session.user.email}. Sign out and sign in with {invitation.email} to accept.
          </Alert>
        </>
      );
    } else {
      body = (
        <>
          {intro}
          <AcceptInvitation token={token} />
        </>
      );
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Logo className="mb-10" />
      {body}
    </main>
  );
}
