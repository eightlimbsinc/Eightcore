"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import {
  CircleUserRound,
  FolderPlus,
  Home,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Moon,
  Search,
  Sun,
  Users,
} from "lucide-react";
import { quickFindTasksAction } from "@/modules/tasks/actions";
import type { ItemAppearance } from "@/lib/appearance";
import { cn } from "@/lib/utils";
import { ItemIcon } from "./item-icon";

interface PaletteProject extends ItemAppearance {
  key: string;
  name: string;
  folders: { name: string; lists: PaletteList[] }[];
  rootLists: PaletteList[];
}
type PaletteList = ItemAppearance & { id: string; name: string };

type FoundTask = Awaited<ReturnType<typeof quickFindTasksAction>>[number];

/** A task item's value: starts with the typed text so the server's matches rank first. */
const taskValue = (query: string, t: FoundTask) => `${query} ${t.ref} ${t.title}`;

const itemClass =
  "data-[selected=true]:bg-surface-muted flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] outline-none select-none [&_svg]:text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0";
const groupClass =
  "[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:uppercase";

/** Opens the palette from anywhere: Ctrl+K / ⌘K, or the sidebar's search button. */
export function CommandPalette({
  workspaceSlug,
  projects,
  canCreateProject,
  canViewMembers,
}: {
  workspaceSlug: string;
  projects: PaletteProject[];
  canCreateProject: boolean;
  canViewMembers: boolean;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** Server results, with the text they were found for (stale results are never shown). */
  const [found, setFound] = useState<{ query: string; tasks: FoundTask[] }>({ query: "", tasks: [] });
  /** The highlighted item (cmdk's value). */
  const [selected, setSelected] = useState("");
  const [searching, startSearch] = useTransition();
  const latest = useRef(0);
  const base = `/w/${workspaceSlug}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("eightcore:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("eightcore:open-palette", onOpen);
    };
  }, []);

  // Task search on the server, a moment after typing stops; older answers are ignored.
  useEffect(() => {
    const q = query.trim();
    const id = ++latest.current;
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const tasks = await quickFindTasksAction(workspaceSlug, q);
        if (id !== latest.current) return;
        setFound({ query: q, tasks });
        // Results arrive after typing: highlight the best task match, so Enter opens it.
        if (tasks[0]) setSelected(taskValue(q, tasks[0]));
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, workspaceSlug]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const shownTasks = query.trim().length >= 2 && found.query === query.trim() ? found.tasks : [];

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQuery("");
          setFound({ query: "", tasks: [] });
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="bg-surface text-foreground fixed top-[12vh] left-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border shadow-2xl"
        >
          <Dialog.Title className="sr-only">Search or jump to</Dialog.Title>
          <Command label="Search or jump to" loop value={selected} onValueChange={setSelected}>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="text-muted-foreground size-4" aria-hidden />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search tasks, projects and lists, or type a command…"
                className="h-12 w-full bg-transparent text-[14px] outline-none"
              />
              <kbd className="text-muted-foreground rounded border px-1.5 text-[10px]">Esc</kbd>
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
              <Command.Empty className="text-muted-foreground px-3 py-6 text-center text-[13px]">
                {searching ? "Searching…" : "Nothing found."}
              </Command.Empty>

              {shownTasks.length ? (
                <Command.Group heading="Tasks" forceMount className={groupClass}>
                  {shownTasks.map((t) => (
                    <Command.Item
                      key={t.ref}
                      value={taskValue(query.trim(), t)}
                      forceMount
                      onSelect={() => go(`${base}/t/${t.ref}`)}
                      className={itemClass}
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: t.statusColor }}
                      />
                      <span className="text-muted-foreground w-16 shrink-0 font-mono text-[11px]">
                        {t.ref}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          t.closed && "text-muted-foreground line-through",
                        )}
                      >
                        {t.title}
                      </span>
                      <span className="text-muted-foreground hidden max-w-48 truncate text-[11px] sm:block">
                        {t.where}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              <Command.Group heading="Go to" className={groupClass}>
                <Command.Item onSelect={() => go(base)} className={itemClass}>
                  <Home /> Home
                </Command.Item>
                <Command.Item onSelect={() => go(`${base}/dashboard`)} className={itemClass}>
                  <LayoutDashboard /> Dashboard
                </Command.Item>
                <Command.Item
                  keywords={["mine", "assigned"]}
                  onSelect={() => go(`${base}/tasks?assignee=me&state=open`)}
                  className={itemClass}
                >
                  <CircleUserRound /> My Work
                </Command.Item>
                <Command.Item onSelect={() => go(`${base}/tasks`)} className={itemClass}>
                  <ListTodo /> All tasks
                </Command.Item>
                <Command.Item
                  keywords={["notifications"]}
                  onSelect={() => go(`${base}/inbox`)}
                  className={itemClass}
                >
                  <Inbox /> Inbox
                </Command.Item>
                {canViewMembers ? (
                  <Command.Item
                    keywords={["people", "invite"]}
                    onSelect={() => go(`${base}/members`)}
                    className={itemClass}
                  >
                    <Users /> Members
                  </Command.Item>
                ) : null}
              </Command.Group>

              <Command.Group heading="Projects and lists" className={groupClass}>
                {projects.flatMap((p) => [
                  <Command.Item
                    key={p.key}
                    value={`project ${p.name} ${p.key}`}
                    onSelect={() => go(`${base}/p/${p.key}`)}
                    className={itemClass}
                  >
                    <ItemIcon kind="project" appearance={p} name={p.name} />
                    <span className="flex-1">{p.name}</span>
                    <span className="text-muted-foreground font-mono text-[10px]">{p.key}</span>
                  </Command.Item>,
                  ...[...p.rootLists, ...p.folders.flatMap((f) => f.lists)].map((l) => (
                    <Command.Item
                      key={l.id}
                      value={`list ${p.name} ${l.name} ${l.id}`}
                      onSelect={() => go(`${base}/l/${l.id}`)}
                      className={itemClass}
                    >
                      <ItemIcon kind="list" appearance={l} name={l.name} />
                      <span className="text-muted-foreground">{p.name} ›</span> {l.name}
                    </Command.Item>
                  )),
                ])}
              </Command.Group>

              <Command.Group heading="Actions" className={groupClass}>
                {canCreateProject ? (
                  <Command.Item onSelect={() => go(`${base}/projects/new`)} className={itemClass}>
                    <FolderPlus /> New project
                  </Command.Item>
                ) : null}
                <Command.Item
                  keywords={["theme", "dark", "light", "mode"]}
                  onSelect={() => {
                    setTheme(resolvedTheme === "dark" ? "light" : "dark");
                    setOpen(false);
                  }}
                  className={itemClass}
                >
                  {resolvedTheme === "dark" ? <Sun /> : <Moon />} Switch to{" "}
                  {resolvedTheme === "dark" ? "light" : "dark"} theme
                </Command.Item>
              </Command.Group>
              {query.trim().length >= 2 ? (
                <Command.Group heading="Search" forceMount className={groupClass}>
                  <Command.Item
                    // Not built from the typed text, so it never outranks a real match.
                    value="search-all-tasks"
                    forceMount
                    onSelect={() => go(`${base}/tasks?q=${encodeURIComponent(query.trim())}`)}
                    className={itemClass}
                  >
                    <Search /> Search all tasks for “{query.trim()}”
                  </Command.Item>
                </Command.Group>
              ) : null}
            </Command.List>
            <div className="text-muted-foreground flex gap-3 border-t px-3 py-1.5 text-[11px]">
              <span>↑↓ to move</span>
              <span>Enter to open</span>
              <span>Ctrl K / ⌘K to toggle</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The sidebar button that opens the palette (for mouse and touch users). */
export function OpenPaletteButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("eightcore:open-palette"))}
      className="border-input bg-surface text-muted-foreground hover:text-foreground flex h-8 w-full items-center gap-2 rounded-md border px-2 text-[13px]"
    >
      <Search className="size-3.5" aria-hidden />
      <span className="flex-1 text-left">Search or jump to…</span>
      <kbd className="rounded border px-1 text-[10px]">Ctrl K</kbd>
    </button>
  );
}
