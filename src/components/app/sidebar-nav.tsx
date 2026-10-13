"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
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
