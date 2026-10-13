import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWorkspaceShell } from "@/modules/workspaces/queries";
import { PageHeader } from "@/components/app/page-header";
import { CreateProjectForm } from "@/components/app/create-project-form";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace, can } = await getWorkspaceShell(slug);
  if (!can.createProject) notFound();
  return (
    <>
      <PageHeader eyebrow={workspace.name} title="New project" />
      <section className="px-8 py-6">
        <CreateProjectForm workspaceSlug={workspace.slug} />
      </section>
    </>
  );
}
