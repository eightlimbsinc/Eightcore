import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium", {
  variants: {
    variant: {
      default: "bg-surface-muted text-muted-foreground",
      accent: "bg-accent-soft text-accent-foreground",
      outline: "border text-muted-foreground",
      destructive: "bg-destructive-soft text-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
