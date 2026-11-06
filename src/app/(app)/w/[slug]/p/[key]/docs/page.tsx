import type { Metadata } from "next";
import Link from "next/link";
import { getDocsPage } from "@/modules/docs/queries";
import { PageHeader } from "@/components/app/page-header";
import { DocTree, NewDocButton } from "@/components/docs/doc-tree";

export const metadata: Metadata = { title: "Docs" };

export default async function ProjectDocsPage({
  params,
}: {
  params: Promise<{ slug: string; key: string }>;
}) {
  const { slug, key } = await params;
  const { project, docs, canCreate, lists, mustPickList } = await getDocsPage(slug, key);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/w/${slug}/p/${project.key}`} className="hover:text-foreground">
            {project.name}
          </Link>
        }
        title="Docs"
        description="Briefs, meeting notes, specs and how-tos for this project. A doc can belong to the whole project or to one list."
        actions={
          canCreate ? (
            <NewDocButton
              workspaceSlug={slug}
              projectKey={project.key}
              projectId={project.id}
              lists={lists}
              mustPickList={mustPickList}
            />
          ) : null
        }
      />
      <div className="max-w-4xl px-8 py-6">
        <DocTree base={`/w/${slug}/p/${project.key}/docs`} docs={docs} />
      </div>
    </>
  );
}
