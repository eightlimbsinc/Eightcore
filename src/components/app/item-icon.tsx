import type { CSSProperties } from "react";
import {
  Folder,
  FolderOpen,
  ListTodo,
  ListChecks,
  LayoutGrid,
  Layers,
  Briefcase,
  Building2,
  Handshake,
  Users,
  UserRound,
  Rocket,
  Target,
  Trophy,
  Flag,
  Star,
  Sparkles,
  Zap,
  Flame,
  Lightbulb,
  Megaphone,
  Newspaper,
  Mail,
  MessageSquare,
  Bell,
  Palette,
  Brush,
  PenTool,
  Image,
  Camera,
  Video,
  Film,
  Clapperboard,
  Mic,
  Headphones,
  Music,
  Code,
  Bug,
  Server,
  Database,
  Cloud,
  Globe,
  Monitor,
  Smartphone,
  ShoppingCart,
  DollarSign,
  Receipt,
  ChartColumn,
  ChartPie,
  Calendar,
  Clock,
  BookOpen,
  FileText,
  GraduationCap,
  Shield,
  Settings,
  Wrench,
  Package,
  Truck,
  House,
  Leaf,
  Coffee,
  Gift,
  Heart,
  type LucideIcon,
} from "lucide-react";
import {
  ITEM_COLORS,
  resolveAppearance,
  type ItemAppearance,
  type ItemColorName,
  type ItemIconName,
  type ItemKind,
} from "@/lib/appearance";
import { cn } from "@/lib/utils";

export const ICON_COMPONENTS: Record<ItemIconName, LucideIcon> = {
  Folder,
  FolderOpen,
  ListTodo,
  ListChecks,
  LayoutGrid,
  Layers,
  Briefcase,
  Building2,
  Handshake,
  Users,
  UserRound,
  Rocket,
  Target,
  Trophy,
  Flag,
  Star,
  Sparkles,
  Zap,
  Flame,
  Lightbulb,
  Megaphone,
  Newspaper,
  Mail,
  MessageSquare,
  Bell,
  Palette,
  Brush,
  PenTool,
  Image,
  Camera,
  Video,
  Film,
  Clapperboard,
  Mic,
  Headphones,
  Music,
  Code,
  Bug,
  Server,
  Database,
  Cloud,
  Globe,
  Monitor,
  Smartphone,
  ShoppingCart,
  DollarSign,
  Receipt,
  ChartColumn,
  ChartPie,
  Calendar,
  Clock,
  BookOpen,
  FileText,
  GraduationCap,
  Shield,
  Settings,
  Wrench,
  Package,
  Truck,
  House,
  Leaf,
  Coffee,
  Gift,
  Heart,
};

/** Inline variables the .neu-tile style reads (both themes' tints). */
export function tileStyle(color: ItemColorName): CSSProperties {
  const c = ITEM_COLORS[color];
  return { "--tile-light": c.light, "--tile-dark": c.dark } as CSSProperties;
}

const SIZES = {
  sm: { tile: "size-5", icon: "!size-3", letter: "text-[10px]" },
  md: { tile: "size-6", icon: "!size-3.5", letter: "text-[11px]" },
  lg: { tile: "size-9", icon: "!size-5", letter: "text-[15px]" },
};

/** A project, folder or list icon: a soft raised tile in the item's colour. */
export function ItemIcon({
  kind,
  appearance,
  name,
  size = "sm",
  className,
}: {
  kind: ItemKind;
  appearance: ItemAppearance;
  /** For a project's default letter tile. */
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { icon, color } = resolveAppearance(kind, appearance);
  const s = SIZES[size];
  const Icon = icon === "letter" ? null : ICON_COMPONENTS[icon];
  return (
    <span aria-hidden className={cn("neu-tile", s.tile, className)} style={tileStyle(color)}>
      {Icon ? (
        // Inline colour: menus restyle the svgs inside them (e.g. muted icons).
        <Icon className={s.icon} strokeWidth={2.25} style={{ color: "var(--tint)" }} />
      ) : (
        <span className={cn("leading-none font-semibold", s.letter)}>
          {(name.trim()[0] ?? "?").toUpperCase()}
        </span>
      )}
    </span>
  );
}
