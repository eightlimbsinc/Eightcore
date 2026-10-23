import Link from "next/link";
import { CircleUserRound, Home, Inbox, ListTodo, Plus, Users } from "lucide-react";
import { getWorkspaceShell } from "@/modules/workspaces/queries";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { UserMenu } from "@/components/app/user-menu";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { NavLink, ProjectTree } from "@/components/app/sidebar-nav";
import { LogoMark } from "@/components/brand/logo";
import { TimeZoneCookie } from "@/components/app/time-zone-cookie";

export default async function WorkspaceLayout({
  children,
  modal,
  params,
}: {
  children: React.ReactNode;
  /** A task opened in a window (see @modal). */
  modal: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, actor, workspace, workspaces, projects, unread, can } = await getWorkspaceShell(slug);
  const base = `/w/${workspace.slug}`;
  return (
    <div className="flex min-h-dvh">
      <aside
        className="bg-sidebar sticky top-0 flex h-dvh w-64 shrink-0 flex-col border-r"
        aria-label="Workspace navigation"
      >
        <div className="p-2">
          <WorkspaceSwitcher
            current={{ slug: workspace.slug, name: workspace.name, role: actor.workspaceRole }}
            workspaces={workspaces}
          />
        </div>
        <nav className="grid gap-0.5 px-2 pt-1">
          <NavLink href={base} exact>
            <Home /> Home
          </NavLink>
          <NavLink href={`${base}/tasks?assignee=me&state=open`}>
            <CircleUserRound /> My Work
          </NavLink>
          <NavLink href={`${base}/tasks`} exact unless={{ assignee: "me" }}>
            <ListTodo /> All tasks
          </NavLink>
          <NavLink href={`${base}/inbox`}>
            <Inbox /> <span className="flex-1">Inbox</span>
            {unread > 0 ? (
              <span
                className="bg-accent min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold text-[#17171a] tabular-nums"
                aria-label={`${unread} unread`}
              >
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </NavLink>
          {can.viewMembers ? (
            <NavLink href={`${base}/members`}>
              <Users /> Members
            </NavLink>
          ) : null}
        </nav>
        <div className="mt-5 flex items-center justify-between px-4 pb-1">
          <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
            Projects
          </span>
          {can.createProject ? (
            <Link
              href={`${base}/projects/new`}
              aria-label="New project"
              className="text-muted-foreground hover:text-foreground grid size-6 place-items-center rounded-sm hover:bg-black/5 dark:hover:bg-white/5"
            >
              <Plus className="size-3.5" />
            </Link>
          ) : null}
        </div>
        <nav className="grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto px-2" aria-label="Projects">
          {projects.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1 text-[13px]">No projects yet.</p>
          ) : (
            <ProjectTree base={base} projects={projects} />
          )}
        </nav>
        <div className="flex items-center gap-1 border-t p-2">
          <UserMenu name={user.name} email={user.email} />
          <ThemeToggle className="shrink-0 [&>button]:size-6" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1">{children}</main>
        {modal}
        <TimeZoneCookie />
        <footer className="text-muted-foreground flex items-center gap-1.5 px-8 py-4 text-[11px]">
          <LogoMark className="size-3.5" /> Eightcore
        </footer>
      </div>
    </div>
  );
}
