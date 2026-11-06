import type { Metadata } from "next";
import Link from "next/link";
import { getAutomationsPage } from "@/modules/automations/queries";
import { PageHeader } from "@/components/app/page-header";
import { AutomationManager } from "@/components/automations/automation-editor";

export const metadata: Metadata = { title: "Automations" };

export default async function ProjectAutomationsPage({
  params,
}: {
  params: Promise<{ slug: string; key: string }>;
}) {
  const { slug, key } = await params;
  const { project, automations, lists, tags, people, endpoints, fields } = await getAutomationsPage(
    slug,
    key,
  );
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/w/${slug}/p/${project.key}`} className="hover:text-foreground">
            {project.name}
          </Link>
        }
        title="Automations"
        description="When something happens to a task, do something for you: move it, assign someone, comment, or send it to Make. Automations act as the person who made them."
      />
      <div className="grid max-w-4xl gap-6 px-8 py-6">
        <AutomationManager
          workspaceSlug={slug}
          projectId={project.id}
          automations={automations}
          lists={lists}
          tags={tags}
          people={people}
          endpoints={endpoints}
          fields={fields}
        />
      </div>
    </>
  );
}
