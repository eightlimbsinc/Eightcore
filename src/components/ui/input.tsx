import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "border-input bg-surface placeholder:text-muted-foreground/70 aria-invalid:border-destructive flex h-9 w-full rounded-md border px-3 text-sm disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "border-input bg-surface placeholder:text-muted-foreground/70 flex min-h-20 w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "border-input bg-surface h-9 rounded-md border px-2.5 text-sm disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
