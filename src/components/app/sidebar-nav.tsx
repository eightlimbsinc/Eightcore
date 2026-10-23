"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Folder, ListTodo, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { FolderMenu, InlineNameForm, ListMenu, ProjectAddMenu, type TreeEdit } from "./sidebar-tree-menus";

export function NavLink({
  href,
  exact,
  children,
}: {
  href: string;
  exact?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-muted-foreground hover:text-foreground flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/5 [&_svg]:size-4",
        active &&
          "bg-surface text-foreground shadow-[0_0_0_1px_var(--border)] dark:bg-white/5 dark:shadow-none",
      )}
    >
      {children}
    </Link>
  );
}

export function ProjectNavLink({
  href,
  name,
  projectKey,
  isPrivate,
}: {
  href: string;
  name: string;
  projectKey: string;
  isPrivate: boolean;
}) {
  return (
    <NavLink href={href}>
      <span className="text-accent-foreground w-9 shrink-0 font-mono text-[10px] tracking-wide">
        {projectKey}
      </span>
      <span className="flex-1 truncate">{name}</span>
      {isPrivate ? <Lock className="!size-3" aria-label="Private" /> : null}
    </NavLink>
  );
}

interface SidebarList {
  id: string;
  name: string;
}

interface SidebarProject {
  id: string;
  key: string;
  name: string;
  visibility: "workspace" | "private";
  folders: { id: string; name: string; lists: SidebarList[] }[];
  rootLists: SidebarList[];
  canManageLists: boolean;
}

function ToggleButton({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground grid size-5 shrink-0 place-items-center rounded-sm hover:bg-black/5 dark:hover:bg-white/10"
    >
      <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
    </button>
  );
}

function ListNavLink({ href, name, depth }: { href: string; name: string; depth: number }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      className={cn(
        "text-muted-foreground hover:text-foreground flex h-7 items-center gap-2 rounded-md pr-2 text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/5",
        active &&
          "bg-surface text-foreground shadow-[0_0_0_1px_var(--border)] dark:bg-white/5 dark:shadow-none",
      )}
    >
      <ListTodo className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{name}</span>
    </Link>
  );
}

/** Projects with their folders and lists, expandable like a file tree. */
export function ProjectTree({ base, projects }: { base: string; projects: SidebarProject[] }) {
  const pathname = usePathname();
  const slug = base.replace(/^\/w\//, "");
  // Explicit open/closed choices; anything not chosen yet follows the defaults below.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [edit, setEdit] = useState<TreeEdit | null>(null);
  // A new list opens its page; close the inline form when the page changes.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setEdit(null);
  }

  const containsPath = (p: SidebarProject) =>
    pathname.startsWith(`${base}/p/${p.key}`) ||
    pathname.startsWith(`${base}/t/${p.key}-`) ||
    [...p.rootLists, ...p.folders.flatMap((f) => f.lists)].some((l) =>
      pathname.startsWith(`${base}/l/${l.id}`),
    );
  const isOpen = (id: string, fallback: boolean) => toggled[id] ?? fallback;
  const toggle = (id: string, current: boolean) => setToggled((t) => ({ ...t, [id]: !current }));
  const open = (id: string) => setToggled((t) => ({ ...t, [id]: true }));
  const done = () => setEdit(null);

  const listRow = (p: SidebarProject, l: SidebarList, depth: number) =>
    edit?.kind === "rename-list" && edit.listId === l.id ? (
      <li key={l.id}>
        <InlineNameForm workspaceSlug={slug} edit={edit} depth={depth} onDone={done} />
      </li>
    ) : (
      <li key={l.id} className="group flex items-center">
        <div className="min-w-0 flex-1">
          <ListNavLink href={`${base}/l/${l.id}`} name={l.name} depth={depth} />
        </div>
        {p.canManageLists ? (
          <ListMenu
            workspaceSlug={slug}
            projectHref={`${base}/p/${p.key}`}
            list={l}
            onPick={() => setEdit({ kind: "rename-list", listId: l.id, name: l.name })}
          />
        ) : null}
      </li>
    );

  return (
    <ul className="grid gap-0.5">
      {projects.map((p) => {
        const projectOpen = isOpen(p.id, containsPath(p));
        const newHere = (folderId: string | null) =>
          edit?.kind === "new-list" && edit.projectId === p.id && edit.folderId === folderId;
        return (
          <li key={p.id}>
            <div className="group flex items-center gap-0.5">
              <ToggleButton open={projectOpen} label={p.name} onClick={() => toggle(p.id, projectOpen)} />
              <div className="min-w-0 flex-1">
                <ProjectNavLink
                  href={`${base}/p/${p.key}`}
                  name={p.name}
                  projectKey={p.key}
                  isPrivate={p.visibility === "private"}
                />
              </div>
              {p.canManageLists ? (
                <ProjectAddMenu
                  projectName={p.name}
                  onPick={(kind) => {
                    open(p.id);
                    setEdit(
                      kind === "new-list"
                        ? { kind, projectId: p.id, folderId: null }
                        : { kind, projectId: p.id },
                    );
                  }}
                />
              ) : null}
            </div>
            {projectOpen ? (
              <ul className="mt-0.5 grid gap-0.5 pl-3">
                {edit?.kind === "new-folder" && edit.projectId === p.id ? (
                  <li>
                    <InlineNameForm workspaceSlug={slug} edit={edit} depth={1} onDone={done} />
                  </li>
                ) : null}
                {p.folders.map((f) => {
                  const folderOpen = isOpen(f.id, true);
                  return (
                    <li key={f.id}>
                      {edit?.kind === "rename-folder" && edit.folderId === f.id ? (
                        <InlineNameForm workspaceSlug={slug} edit={edit} depth={1} onDone={done} />
                      ) : (
                        <div className="text-muted-foreground group flex h-7 items-center gap-0.5 text-[13px]">
                          <ToggleButton
                            open={folderOpen}
                            label={f.name}
                            onClick={() => toggle(f.id, folderOpen)}
                          />
                          <Folder className="text-accent size-3.5 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 truncate pl-1.5">{f.name}</span>
                          {p.canManageLists ? (
                            <FolderMenu
                              workspaceSlug={slug}
                              folder={{ id: f.id, name: f.name, listCount: f.lists.length }}
                              onPick={(kind) => {
                                if (kind === "new-list") {
                                  open(f.id);
                                  setEdit({ kind, projectId: p.id, folderId: f.id });
                                } else {
                                  setEdit({ kind, folderId: f.id, name: f.name });
                                }
                              }}
                            />
                          ) : null}
                        </div>
                      )}
                      {folderOpen && (f.lists.length > 0 || newHere(f.id)) ? (
                        <ul className="grid gap-0.5">
                          {f.lists.map((l) => listRow(p, l, 3))}
                          {newHere(f.id) && edit ? (
                            <li>
                              <InlineNameForm workspaceSlug={slug} edit={edit} depth={3} onDone={done} />
                            </li>
                          ) : null}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
                {p.rootLists.map((l) => listRow(p, l, 2))}
                {newHere(null) && edit ? (
                  <li>
                    <InlineNameForm workspaceSlug={slug} edit={edit} depth={2} onDone={done} />
                  </li>
                ) : null}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
