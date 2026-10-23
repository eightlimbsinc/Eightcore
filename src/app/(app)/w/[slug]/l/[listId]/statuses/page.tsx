import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getListPage } from "@/modules/lists/queries";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ListSettingsForm, StatusEditor } from "@/components/lists/status-editor";

export const metadata: Metadata = { title: "List settings" };

export default async function ListStatusesPage({
  params,
}: {
  params: Promise<{ slug: string; listId: string }>;
}) {
  const { slug, listId } = await params;
  const { list, project, statuses, can } = await getListPage(slug, listId);
  if (!can.manage) notFound();
  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/w/${slug}/l/${list.id}`}
            className="hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="size-3" aria-hidden /> Back to {list.name}
          </Link>
        }
        title="List settings"
        description={`${project.name} · ${list.name}`}
      />
      <div className="grid max-w-4xl gap-6 px-8 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Statuses</CardTitle>
            <CardDescription>
              These statuses belong to this list only. Changing them doesn&apos;t affect other lists.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StatusEditor workspaceSlug={slug} listId={list.id} statuses={statuses} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>List</CardTitle>
          </CardHeader>
          <CardContent>
            <ListSettingsForm
              workspaceSlug={slug}
              listId={list.id}
              name={list.name}
              projectKey={project.key}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
