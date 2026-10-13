import { cn } from "@/lib/utils";

/** The Eightcore mark: an octagon (eight sides, for 8limbs) around a core. Original artwork. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6", className)}>
      <path
        d="M11.3 3h9.4L29 11.3v9.4L20.7 29h-9.4L3 20.7v-9.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="4" fill="var(--accent)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span>Eightcore</span>
    </span>
  );
}
