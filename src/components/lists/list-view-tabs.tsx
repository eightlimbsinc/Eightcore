"use client";
import Link from "next/link";
import { useTransition } from "react";
import { CalendarDays, ClipboardList, Columns3, List, Plus } from "lucide-react";
import { createFormAction } from "@/modules/forms/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ICONS = { list: List, board: Columns3, calendar: CalendarDays } as const;

/** The list's views: List, Board, Calendar, its forms, and "+ View" to add a form. */
export function ListViewTabs({
  workspaceSlug,
  listId,
  layouts,
  forms,
  active,
  canManageForms,
}: {
  workspaceSlug: string;
  listId: string;
  layouts: { key: "list" | "board" | "calendar"; label: string; href: string }[];
  forms: { id: string; name: string }[];
  /** "list" | "board" | "calendar" | a form id. */
  active: string;
  canManageForms: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const tab = (isActive: boolean) =>
    cn(
      "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px]",
      isActive
        ? "border-accent text-foreground font-medium"
        : "text-muted-foreground hover:text-foreground border-transparent",
    );
  return (
    <nav aria-label="Layout" className="flex items-center gap-1 overflow-x-auto border-b">
      {layouts.map(({ key, label, href }) => {
        const Icon = ICONS[key];
        return (
          <Link
            key={key}
            href={href}
            aria-current={active === key ? "page" : undefined}
            className={tab(active === key)}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </Link>
        );
      })}
      {forms.map((f) => (
        <Link
          key={f.id}
          href={`/w/${workspaceSlug}/l/${listId}/forms/${f.id}`}
          aria-current={active === f.id ? "page" : undefined}
          className={tab(active === f.id)}
        >
          <ClipboardList className="size-4" aria-hidden /> <span className="max-w-48 truncate">{f.name}</span>
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
