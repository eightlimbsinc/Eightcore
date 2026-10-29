import { ITEM_COLOR_NAMES } from "@/lib/appearance";
import { cn, initials } from "@/lib/utils";
import { tileStyle } from "./item-icon";

/** A stable colour per person (same person, same colour everywhere). */
export function personColor(key: string) {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ITEM_COLOR_NAMES[hash % ITEM_COLOR_NAMES.length]!;
}

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-7 text-[11px]",
  lg: "size-8 text-[11px]",
};

/** Someone's initials on a soft raised disc in their own colour. */
export function PersonAvatar({
  id,
  name,
  size = "sm",
  className,
  title,
}: {
  /** The user id (falls back to the name) picks the colour. */
  id?: string;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
  title?: string;
}) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      title={title}
      className={cn("neu-tile rounded-full font-semibold", SIZES[size], className)}
      style={tileStyle(personColor(id ?? name))}
    >
      {initials(name)}
    </span>
  );
}
