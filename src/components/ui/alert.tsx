import { cn } from "@/lib/utils";

export function Alert({
  variant = "default",
  className,
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "destructive" | "success" }) {
  return (
    <div
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-[13px]",
        variant === "destructive" && "border-destructive/30 bg-destructive-soft text-destructive",
        variant === "success" && "border-success/30 text-success",
        variant === "default" && "bg-surface-muted text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
