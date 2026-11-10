import type { Metadata } from "next";
import Link from "next/link";
import { getFormBuilderPage } from "@/modules/forms/queries";
import { PageHeader } from "@/components/app/page-header";
import { ListViewTabs } from "@/components/lists/list-view-tabs";
import { FormBuilder } from "@/components/forms/form-builder";

export const metadata: Metadata = { title: "Form" };

export default async function FormBuilderPage({
  params,
}: {
  params: Promise<{ slug: string; listId: string; formId: string }>;
}) {
  const { slug, listId, formId } = await params;
  const data = await getFormBuilderPage(slug, listId, formId);
  const listPath = `/w/${slug}/l/${listId}`;
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1">
            <Link href={`/w/${slug}/p/${data.project.key}`} className="hover:text-foreground">
              {data.project.name}
            </Link>
            /
            <Link href={listPath} className="hover:text-foreground">
              {data.list.name}
            </Link>
          </span>
        }
        title={data.form.name}
        description="A form anyone with the link can fill in. Each response becomes a ticket in this list."
      />
      <div className="grid gap-4 px-8 pt-4 pb-8">
        <ListViewTabs
          workspaceSlug={slug}
          listId={listId}
          layouts={[
            { key: "list", label: "List", href: listPath },
            { key: "board", label: "Board", href: `${listPath}/board` },
            { key: "calendar", label: "Calendar", href: `${listPath}/calendar` },
          ]}
          forms={data.forms}
          active={data.form.id}
          canManageForms
        />
        <FormBuilder
          key={data.form.id}
          workspaceSlug={slug}
          form={data.form}
          publicUrl={data.publicUrl}
          statuses={data.statuses}
          people={data.people}
          customFields={data.customFields}
        />
      </div>
    </>
  );
}
