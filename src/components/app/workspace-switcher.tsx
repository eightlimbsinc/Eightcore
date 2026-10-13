"use client";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WorkspaceOption {
  slug: string;
  name: string;
  role: string;
}

export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: WorkspaceOption;
  workspaces: WorkspaceOption[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-black/5 data-[state=open]:bg-black/5 dark:hover:bg-white/5 dark:data-[state=open]:bg-white/5"
        aria-label="Switch workspace"
      >
        <span className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-md text-[12px] font-semibold">
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{current.name}</span>
          <span className="text-muted-foreground block text-[11px] capitalize">{current.role}</span>
        </span>
        <ChevronsUpDown className="text-muted-foreground size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.slug} asChild>
            <Link href={`/w/${w.slug}`}>
              <span className="bg-surface-muted grid size-5 place-items-center rounded-sm text-[10px] font-semibold">
                {w.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex-1 truncate">{w.name}</span>
              {w.slug === current.slug ? <Check className="!text-accent" aria-label="Current" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/w/new">
            <Plus />
            Create workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
