import type { Metadata } from "next";
import Link from "next/link";
import { Lock, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getProjectPage } from "@/modules/projects/queries";
import { PageHeader } from "@/components/app/page-header";
import { AppearancePicker } from "@/components/app/appearance-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArchiveProjectButton, ProjectDetailsForm, ProjectMembers } from "@/components/app/project-settings";
import { ProjectLists } from "@/components/lists/project-lists";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  return { title: (await params).key.toUpperCase() };
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string; key: string }> }) {
  const { slug, key } = await params;
  const { actor, project, members, workspaceMembers, tree, statusTemplates } = await getProjectPage(
    slug,
    key,
  );
  return (
    <>
      <PageHeader
        eyebrow={<span className="text-accent-foreground font-mono tracking-wide">{project.key}</span>}
        title={
          <span className="flex items-center gap-2.5">
            <AppearancePicker
              workspaceSlug={slug}
              kind="project"
              id={project.id}
              name={project.name}
              appearance={project}
              canEdit={project.can.update}
              size="md"
            />
            {project.name}
            {project.visibility === "private" ? (
              <Lock className="text-muted-foreground size-4" aria-label="Private" />
            ) : null}
          </span>
        }
        description={project.description || undefined}
        actions={
          <>
            {project.can.manageFields ? (
              <Button asChild variant="outline">
                <Link href={`/w/${slug}/p/${project.key}/fields`}>
                  <SlidersHorizontal /> Custom fields
                </Link>
              </Button>
            ) : null}
            <Badge>
              Your role: <span className="capitalize">{project.role}</span>
            </Badge>
          </>
        }
      />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="grid content-start gap-6">
          <ProjectLists
            workspaceSlug={slug}
            projectId={project.id}
            tree={tree}
            statusTemplates={statusTemplates}
          />
          {project.can.update ? (
            <Card>
              <CardHeader>
                <CardTitle>Project details</CardTitle>
              </CardHeader>
              <CardContent>
                <ProjectDetailsForm workspaceSlug={slug} project={project} />
              </CardContent>
            </Card>
          ) : null}
          {project.can.archive ? (
            <Card>
              <CardHeader>
                <CardTitle>Archive</CardTitle>
                <CardDescription>Archived projects are hidden but keep all their history.</CardDescription>
              </CardHeader>
              <CardContent>
                <ArchiveProjectButton workspaceSlug={slug} projectId={project.id} />
              </CardContent>
            </Card>
          ) : null}
        </div>
        <Card className="content-start self-start">
          <CardHeader>
            <CardTitle>People</CardTitle>
            <CardDescription>Explicit project roles.</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            <ProjectMembers
              workspaceSlug={slug}
              projectId={project.id}
              members={members}
              candidates={workspaceMembers}
              canManage={project.can.manageMembers}
              currentUserId={actor.userId}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
