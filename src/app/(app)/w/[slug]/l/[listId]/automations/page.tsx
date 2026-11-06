import type { Metadata } from "next";
import Link from "next/link";
import { getListAutomationsPage } from "@/modules/automations/queries";
import { PageHeader } from "@/components/app/page-header";
import { AutomationManager } from "@/components/automations/automation-editor";

export const metadata: Metadata = { title: "Automations" };

export default async function ListAutomationsPage({
  params,
}: {
  params: Promise<{ slug: string; listId: string }>;
}) {
  const { slug, listId } = await params;
  const { list, project, automations, projectWide, lists, tags, people, endpoints, fields } =
    await getListAutomationsPage(slug, listId);
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1">
            <Link href={`/w/${slug}/p/${project.key}`} className="hover:text-foreground">
              {project.name}
            </Link>
            /
            <Link href={`/w/${slug}/l/${list.id}`} className="hover:text-foreground">
              {list.name}
            </Link>
          </span>
        }
        title={`Automations: ${list.name}`}
        description="When something happens to a task in this list, do something for you. Automations act as the person who made them."
      />
      <div className="grid max-w-4xl gap-4 px-8 py-6">
        {projectWide ? (
          <p className="text-muted-foreground text-[13px]">
            {projectWide} project-wide automation{projectWide === 1 ? "" : "s"} also{" "}
            {projectWide === 1 ? "applies" : "apply"} here.{" "}
            <Link href={`/w/${slug}/p/${project.key}/automations`} className="underline">
              See the project&apos;s automations
            </Link>
          </p>
        ) : null}
        <AutomationManager
          workspaceSlug={slug}
          projectId={project.id}
          fixedListId={list.id}
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
