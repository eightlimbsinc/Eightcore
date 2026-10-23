"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Folder, ListTodo, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

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
  // Explicit open/closed choices; anything not chosen yet follows the defaults below.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const containsPath = (p: SidebarProject) =>
    pathname.startsWith(`${base}/p/${p.key}`) ||
    pathname.startsWith(`${base}/t/${p.key}-`) ||
    [...p.rootLists, ...p.folders.flatMap((f) => f.lists)].some((l) =>
      pathname.startsWith(`${base}/l/${l.id}`),
    );
  const isOpen = (id: string, fallback: boolean) => toggled[id] ?? fallback;
  const toggle = (id: string, current: boolean) => setToggled((t) => ({ ...t, [id]: !current }));

  return (
    <ul className="grid gap-0.5">
      {projects.map((p) => {
        const projectOpen = isOpen(p.id, containsPath(p));
        const empty = p.folders.length === 0 && p.rootLists.length === 0;
        return (
          <li key={p.id}>
            <div className="flex items-center gap-0.5">
              <ToggleButton open={projectOpen} label={p.name} onClick={() => toggle(p.id, projectOpen)} />
              <div className="min-w-0 flex-1">
                <ProjectNavLink
                  href={`${base}/p/${p.key}`}
                  name={p.name}
                  projectKey={p.key}
                  isPrivate={p.visibility === "private"}
                />
              </div>
            </div>
            {projectOpen ? (
              <ul className="mt-0.5 grid gap-0.5 pl-3">
                {empty ? <li className="text-muted-foreground py-1 pl-7 text-[12px]">No lists yet</li> : null}
                {p.folders.map((f) => {
                  const folderOpen = isOpen(f.id, true);
                  return (
                    <li key={f.id}>
                      <div className="text-muted-foreground flex h-7 items-center gap-0.5 text-[13px]">
                        <ToggleButton
                          open={folderOpen}
                          label={f.name}
                          onClick={() => toggle(f.id, folderOpen)}
                        />
                        <Folder className="text-accent size-3.5 shrink-0" aria-hidden />
                        <span className="truncate pl-1.5">{f.name}</span>
                      </div>
                      {folderOpen ? (
                        <ul className="grid gap-0.5">
                          {f.lists.length === 0 ? (
                            <li className="text-muted-foreground py-1 pl-12 text-[12px]">Empty</li>
                          ) : (
                            f.lists.map((l) => (
                              <li key={l.id}>
                                <ListNavLink href={`${base}/l/${l.id}`} name={l.name} depth={3} />
                              </li>
                            ))
                          )}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
                {p.rootLists.map((l) => (
                  <li key={l.id}>
                    <ListNavLink href={`${base}/l/${l.id}`} name={l.name} depth={2} />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
