"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5"
        aria-label="Account menu"
      >
        <span className="bg-accent-soft text-accent-foreground grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold">
          {initials(name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{name}</span>
          <span className="text-muted-foreground block truncate text-[11px]">{email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="normal-case">{email}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRound />
            Account & security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
