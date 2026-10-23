import type { Metadata } from "next";
import Link from "next/link";
import { getProjectFieldsPage } from "@/modules/projects/queries";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldList, NewFieldForm } from "@/components/fields/field-manager";

export const metadata: Metadata = { title: "Custom fields" };

export default async function ProjectFieldsPage({
  params,
}: {
  params: Promise<{ slug: string; key: string }>;
}) {
  const { slug, key } = await params;
  const { project, fields, lists } = await getProjectFieldsPage(slug, key);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/w/${slug}/p/${project.key}`} className="hover:text-foreground">
            {project.name}
          </Link>
        }
        title="Custom fields"
        description="Extra details to track on every task, such as budget, client or channel. A field can apply to the whole project or to one list."
      />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Fields</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldList workspaceSlug={slug} fields={fields} />
          </CardContent>
        </Card>
        <Card className="content-start">
          <CardHeader>
            <CardTitle>New field</CardTitle>
            <CardDescription>Everyone who can edit tasks can fill fields in.</CardDescription>
          </CardHeader>
          <CardContent>
            <NewFieldForm workspaceSlug={slug} projectId={project.id} lists={lists} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
