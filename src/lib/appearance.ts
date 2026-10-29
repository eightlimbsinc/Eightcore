/**
 * Icons and colours people can give projects, folders and lists. Stored by name, so the
 * palette can be retuned later without touching data; unknown names fall back to defaults.
 */

export const ITEM_ICONS = [
  "Folder",
  "FolderOpen",
  "ListTodo",
  "ListChecks",
  "LayoutGrid",
  "Layers",
  "Briefcase",
  "Building2",
  "Handshake",
  "Users",
  "UserRound",
  "Rocket",
  "Target",
  "Trophy",
  "Flag",
  "Star",
  "Sparkles",
  "Zap",
  "Flame",
  "Lightbulb",
  "Megaphone",
  "Newspaper",
  "Mail",
  "MessageSquare",
  "Bell",
  "Palette",
  "Brush",
  "PenTool",
  "Image",
  "Camera",
  "Video",
  "Film",
  "Clapperboard",
  "Mic",
  "Headphones",
  "Music",
  "Code",
  "Bug",
  "Server",
  "Database",
  "Cloud",
  "Globe",
  "Monitor",
  "Smartphone",
  "ShoppingCart",
  "DollarSign",
  "Receipt",
  "ChartColumn",
  "ChartPie",
  "Calendar",
  "Clock",
  "BookOpen",
  "FileText",
  "GraduationCap",
  "Shield",
  "Settings",
  "Wrench",
  "Package",
  "Truck",
  "House",
  "Leaf",
  "Coffee",
  "Gift",
  "Heart",
] as const;
export type ItemIconName = (typeof ITEM_ICONS)[number];

/** Each colour has a light-mode and a dark-mode tint (the icon is drawn in it). */
export const ITEM_COLORS = {
  gold: { label: "Gold", light: "#9a7638", dark: "#d4b37a" },
  slate: { label: "Slate", light: "#5b6474", dark: "#a3acbb" },
  blue: { label: "Blue", light: "#2a6fd0", dark: "#6aa5f0" },
  indigo: { label: "Indigo", light: "#5048c8", dark: "#9a93f2" },
  purple: { label: "Purple", light: "#8240c0", dark: "#c08cf0" },
  pink: { label: "Pink", light: "#c23a7e", dark: "#f08cbc" },
  red: { label: "Red", light: "#c53b30", dark: "#f0877e" },
  orange: { label: "Orange", light: "#c25e14", dark: "#f3a463" },
  green: { label: "Green", light: "#2e8540", dark: "#7acb8a" },
  teal: { label: "Teal", light: "#16807a", dark: "#5fcbc3" },
} as const;
export type ItemColorName = keyof typeof ITEM_COLORS;
export const ITEM_COLOR_NAMES = Object.keys(ITEM_COLORS) as ItemColorName[];

export type ItemKind = "project" | "folder" | "list";

export interface ItemAppearance {
  icon: string | null;
  color: string | null;
}

export const isItemIcon = (v: unknown): v is ItemIconName =>
  typeof v === "string" && (ITEM_ICONS as readonly string[]).includes(v);
export const isItemColor = (v: unknown): v is ItemColorName =>
  typeof v === "string" && Object.hasOwn(ITEM_COLORS, v);

/** What to draw: the chosen icon and colour, or the kind's defaults. Projects default to a letter. */
export function resolveAppearance(kind: ItemKind, a: ItemAppearance) {
  const icon: ItemIconName | "letter" = isItemIcon(a.icon)
    ? a.icon
    : kind === "project"
      ? "letter"
      : kind === "folder"
        ? "Folder"
        : "ListTodo";
  const color: ItemColorName = isItemColor(a.color) ? a.color : kind === "list" ? "slate" : "gold";
  return { icon, color };
}
