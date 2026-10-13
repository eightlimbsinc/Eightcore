import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listWorkspacesForUser } from "@/modules/workspaces/queries";
import { Logo } from "@/components/brand/logo";
import { CreateWorkspaceForm } from "@/components/app/create-workspace-form";

export const metadata: Metadata = { title: "Create workspace" };

export default async function NewWorkspacePage() {
  const user = await requireUser();
  const existing = await listWorkspacesForUser(user.id);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Logo className="mb-10" />
      <h1 className="text-2xl font-semibold tracking-tight">Create a workspace</h1>
      <p className="text-muted-foreground mt-1.5 mb-8">
        A workspace holds your team, projects and workflows. You’ll be its owner.
      </p>
      <CreateWorkspaceForm />
      {existing.length > 0 ? (
        <p className="text-muted-foreground mt-6">
          Or go back to{" "}
          <Link
            href={`/w/${existing[0]!.slug}`}
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            {existing[0]!.name}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
