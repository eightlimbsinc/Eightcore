import Link from "next/link";
import { FolderKanban, Lock, Plus } from "lucide-react";
import { getWorkspaceShell } from "@/modules/workspaces/queries";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default async function WorkspaceHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, workspace, projects, can } = await getWorkspaceShell(slug);
  const firstName = user.name.split(" ")[0];
  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title={`Welcome, ${firstName}`}
        description="Your projects in this workspace."
        actions={
          can.createProject ? (
            <Button asChild>
              <Link href={`/w/${workspace.slug}/projects/new`}>
                <Plus /> New project
              </Link>
            </Button>
          ) : null
        }
      />
      <section className="px-8 py-6">
        {projects.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed px-6 py-16 text-center">
            <FolderKanban className="text-accent mb-3 size-8" aria-hidden />
            <h2 className="font-semibold">No projects yet</h2>
            <p className="text-muted-foreground mt-1 max-w-sm">
              {can.createProject
                ? "Create a project for each client engagement or internal initiative."
                : "When someone shares a project with you, it will appear here."}
            </p>
            {can.createProject ? (
              <Button asChild variant="outline" className="mt-5">
                <Link href={`/w/${workspace.slug}/projects/new`}>
                  <Plus /> Create the first project
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/w/${workspace.slug}/p/${p.key}`}
                  className="group bg-surface hover:border-accent/60 grid h-full gap-2 rounded-lg border p-4 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-accent-foreground font-mono text-[11px] tracking-wide">
                      {p.key}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {p.visibility === "private" ? (
                        <Badge variant="outline">
                          <Lock className="size-3" /> Private
                        </Badge>
                      ) : null}
                      <Badge className="capitalize">{p.role}</Badge>
                    </div>
                  </div>
                  <h2 className="font-semibold group-hover:underline group-hover:underline-offset-4">
                    {p.name}
                  </h2>
                  {p.description ? (
                    <p className="text-muted-foreground line-clamp-2">{p.description}</p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
