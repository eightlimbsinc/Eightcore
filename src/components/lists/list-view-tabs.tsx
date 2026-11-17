"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { CalendarDays, ClipboardList, Columns3, List, Plus } from "lucide-react";
import { createFormAction } from "@/modules/forms/actions";
import { setListTabOrderAction } from "@/modules/lists/actions";
import { orderTabs } from "@/modules/lists/view-settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { notify } from "@/components/app/toast";
import { cn } from "@/lib/utils";

const ICONS = { list: List, board: Columns3, calendar: CalendarDays } as const;
const TAB_TYPE = "application/x-eightcore-tab";

type Tab = { key: string; label: string; href: string; icon: React.ComponentType<{ className?: string }> };

/**
 * The list's views: List, Board, Calendar, its forms, and "+ View" to add a form. Tabs can be
 * dragged into a new order (saved for everyone, like the list's saved view).
 */
export function ListViewTabs({
  workspaceSlug,
  listId,
  layouts,
  forms,
  active,
  canManageForms,
  tabOrder = [],
  canReorder = false,
}: {
  workspaceSlug: string;
  listId: string;
  layouts: { key: "list" | "board" | "calendar"; label: string; href: string }[];
  forms: { id: string; name: string }[];
  /** "list" | "board" | "calendar" | a form id. */
  active: string;
  canManageForms: boolean;
  /** Saved order of tab keys. */
  tabOrder?: string[];
  canReorder?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const all: Tab[] = [
    ...layouts.map((l) => ({ ...l, icon: ICONS[l.key] })),
    ...forms.map((f) => ({
      key: f.id,
      label: f.name,
      href: `/w/${workspaceSlug}/l/${listId}/forms/${f.id}`,
      icon: ClipboardList,
    })),
  ];
  const savedKey = tabOrder.join(",");
  const [order, setOrder] = useState(tabOrder);
  // A new saved order (from the server) replaces the local one.
  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setOrder(tabOrder);
  }
  const byKey = new Map(all.map((t) => [t.key, t]));
  const tabs = orderTabs(
    all.map((t) => t.key),
    order,
  ).map((k) => byKey.get(k)!);

  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ key: string; after: boolean } | null>(null);

  const drop = (target: string, after: boolean) => {
    const from = dragging;
    setDragging(null);
    setOver(null);
    if (!from || from === target) return;
    const keys = tabs.map((t) => t.key).filter((k) => k !== from);
    keys.splice(keys.indexOf(target) + (after ? 1 : 0), 0, from);
    const previous = order;
    setOrder(keys);
    startTransition(async () => {
      const result = await setListTabOrderAction(workspaceSlug, listId, keys);
      if (result && !result.ok) {
        setOrder(previous);
        notify(result.message);
      }
    });
  };

  const tabClass = (isActive: boolean) =>
    cn(
      "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px]",
      isActive
        ? "border-accent text-foreground font-medium"
        : "text-muted-foreground hover:text-foreground border-transparent",
    );
  return (
    <nav aria-label="Layout" className="flex items-center gap-1 overflow-x-auto border-b">
      {tabs.map(({ key, label, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          draggable={canReorder}
          title={canReorder ? "Drag to reorder" : undefined}
          onDragStart={(e) => {
            if (!canReorder) return;
            e.dataTransfer.setData(TAB_TYPE, key);
            e.dataTransfer.effectAllowed = "move";
            setDragging(key);
          }}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
          onDragOver={(e) => {
            if (!dragging || !e.dataTransfer.types.includes(TAB_TYPE)) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const after = e.clientX > r.left + r.width / 2;
            if (over?.key !== key || over.after !== after) setOver({ key, after });
          }}
          onDrop={(e) => {
            if (!dragging) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            drop(key, e.clientX > r.left + r.width / 2);
          }}
          className={cn(
            tabClass(active === key),
            dragging === key && "opacity-40",
            over?.key === key &&
              dragging !== key &&
              (over.after ? "shadow-[inset_-2px_0_0_var(--accent)]" : "shadow-[inset_2px_0_0_var(--accent)]"),
          )}
        >
          <Icon className="size-4" aria-hidden /> <span className="max-w-48 truncate">{label}</span>
        </Link>
      ))}
      {canManageForms ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={pending}
            className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 px-3 py-2 text-[13px]"
          >
            <Plus className="size-4" aria-hidden /> View
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            <DropdownMenuItem
              onSelect={() =>
                startTransition(() => createFormAction(workspaceSlug, listId).then(() => undefined))
              }
            >
              <ClipboardList /> Form
              <span className="text-muted-foreground ml-auto text-[11px]">tickets from a link</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  );
}
