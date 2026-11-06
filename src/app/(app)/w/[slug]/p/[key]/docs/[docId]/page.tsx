import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { getDocPage } from "@/modules/docs/queries";
import { DocEditor } from "@/components/docs/doc-editor";
import { DeleteDocButton } from "@/components/docs/delete-doc-button";
import { NewDocButton } from "@/components/docs/doc-tree";

export const metadata: Metadata = { title: "Doc" };

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string; key: string; docId: string }>;
}) {
  const { slug, key, docId } = await params;
  const { doc, project, ancestors, children, can } = await getDocPage(slug, key, docId);
  const base = `/w/${slug}/p/${project.key}/docs`;
  const parentId = ancestors.at(-1)?.id ?? null;
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-5 px-8 py-6">
      <nav
        aria-label="Breadcrumb"
        className="text-muted-foreground flex flex-wrap items-center gap-1 text-[13px]"
      >
        <Link href={`/w/${slug}/p/${project.key}`} className="hover:text-foreground">
          {project.name}
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <Link href={base} className="hover:text-foreground">
          Docs
        </Link>
        {ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1">
            <ChevronRight className="size-3.5" aria-hidden />
            <Link href={`${base}/${a.id}`} className="hover:text-foreground max-w-48 truncate">
              {a.title || "Untitled"}
            </Link>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3">
          {doc.list ? <span>In {doc.list.name}</span> : null}
          <span>
            Last edited by {doc.updatedByName} · {new Date(doc.updatedAt).toLocaleString()}
          </span>
          {can.delete ? (
            <DeleteDocButton
              workspaceSlug={slug}
              projectKey={project.key}
              docId={doc.id}
              parentId={parentId}
              title={doc.title}
              hasChildren={children.length > 0}
            />
          ) : null}
        </span>
      </nav>
      <DocEditor key={doc.id} workspaceSlug={slug} doc={doc} canEdit={can.edit} />
      {children.length || can.edit ? (
        <section aria-label="Sub-pages" className="grid gap-2">
          <h2 className="text-[13px] font-semibold">Sub-pages</h2>
          {children.length ? (
            <ul className="grid gap-0.5">
              {children.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`${base}/${c.id}`}
                    className="hover:bg-surface-muted flex items-center gap-2 rounded-md px-2 py-1.5"
                  >
                    <FileText className="text-muted-foreground size-4" aria-hidden />
                    {c.title || "Untitled"}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {can.edit ? (
            <div>
              <NewDocButton
                workspaceSlug={slug}
                projectKey={project.key}
                projectId={project.id}
                parentId={doc.id}
                label="Add sub-page"
                variant="ghost"
              />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
