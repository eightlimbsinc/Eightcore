import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getListSettingsPage } from "@/modules/lists/queries";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ListSettingsForm, StatusEditor } from "@/components/lists/status-editor";
import { StatusTemplatesPanel } from "@/components/lists/status-templates";
import { TransitionRules } from "@/components/lists/transition-rules";

export const metadata: Metadata = { title: "List settings" };

export default async function ListStatusesPage({
  params,
}: {
  params: Promise<{ slug: string; listId: string }>;
}) {
  const { slug, listId } = await params;
  const {
    list,
    project,
    statuses,
    can,
    transitions,
    templates: saved,
    listFields,
  } = await getListSettingsPage(slug, listId);
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
        title={can.manage ? "List settings" : "Status rules"}
        description={`${project.name} · ${list.name}`}
      />
      <div className="grid max-w-4xl gap-6 px-8 py-6">
        {can.manage ? (
          <>
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
          </>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Status rules</CardTitle>
            <CardDescription>
              Control how tasks move between statuses: who may make a move, whether it needs a comment, and
              which fields must be filled in first. Applies everywhere: the status menu, the board, bulk
              actions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TransitionRules
              workspaceSlug={slug}
              listId={list.id}
              statuses={statuses}
              fields={listFields}
              rules={transitions.rules}
              strict={transitions.strict}
              canEdit={transitions.can.manage}
            />
          </CardContent>
        </Card>
        {can.manage ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Status templates</CardTitle>
                <CardDescription>
                  Reuse a set of statuses across lists. Templates are shared with everyone in the workspace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StatusTemplatesPanel workspaceSlug={slug} listId={list.id} saved={saved} />
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
          </>
        ) : null}
      </div>
    </>
  );
}
