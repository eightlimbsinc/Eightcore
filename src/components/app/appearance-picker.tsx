"use client";
import { useOptimistic, useState, useTransition } from "react";
import { Popover } from "radix-ui";
import { RotateCcw } from "lucide-react";
import { setItemAppearanceAction } from "@/modules/lists/actions";
import {
  ITEM_COLORS,
  ITEM_COLOR_NAMES,
  ITEM_ICONS,
  resolveAppearance,
  type ItemAppearance,
  type ItemKind,
} from "@/lib/appearance";
import { cn } from "@/lib/utils";
import { ICON_COMPONENTS, ItemIcon, tileStyle } from "./item-icon";

const KIND_LABEL: Record<ItemKind, string> = { project: "project", folder: "folder", list: "list" };

/**
 * An item's icon tile. For people who may change it, the tile is a button that opens a
 * colour and icon picker; every pick saves straight away.
 */
export function AppearancePicker({
  workspaceSlug,
  kind,
  id,
  name,
  appearance,
  canEdit,
  size = "sm",
}: {
  workspaceSlug: string;
  kind: ItemKind;
  id: string;
  name: string;
  appearance: ItemAppearance;
  canEdit: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const [shown, setShown] = useOptimistic(appearance);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  if (!canEdit) return <ItemIcon kind={kind} appearance={appearance} name={name} size={size} />;

  const current = resolveAppearance(kind, shown);
  const save = (next: ItemAppearance) =>
    startTransition(async () => {
      setShown(next);
      const result = await setItemAppearanceAction(workspaceSlug, kind, id, next);
      setError(result && !result.ok ? result.message : null);
    });

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Change icon and colour of ${KIND_LABEL[kind]} ${name}`}
        className="rounded-md"
      >
        <ItemIcon kind={kind} appearance={shown} name={name} size={size} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label={`Icon and colour for ${name}`}
          className="bg-surface-muted text-foreground z-50 grid w-[20rem] gap-3 rounded-xl border p-3 shadow-xl"
        >
          <div className="grid gap-1.5">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">Colour</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
              {ITEM_COLOR_NAMES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={current.color === c}
                  aria-label={ITEM_COLORS[c].label}
                  title={ITEM_COLORS[c].label}
                  onClick={() => save({ icon: shown.icon, color: c })}
                  className={cn("neu-tile size-6 rounded-full", current.color === c && "neu-inset")}
                  style={tileStyle(c)}
                >
                  <span className="size-2.5 rounded-full bg-[var(--tint)]" />
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">Icon</p>
            <div
              className="grid max-h-56 grid-cols-8 gap-1.5 overflow-y-auto p-1"
              role="radiogroup"
              aria-label="Icon"
            >
              {kind === "project" ? (
                <button
                  type="button"
                  role="radio"
                  aria-checked={current.icon === "letter"}
                  aria-label="First letter"
                  title="First letter"
                  onClick={() => save({ icon: null, color: shown.color })}
                  className={cn("neu-tile size-7", current.icon === "letter" && "neu-inset")}
                  style={tileStyle(current.color)}
                >
                  <span className="text-[12px] leading-none font-semibold">
                    {(name.trim()[0] ?? "?").toUpperCase()}
                  </span>
                </button>
              ) : null}
              {ITEM_ICONS.map((icon) => {
                const Icon = ICON_COMPONENTS[icon];
                return (
                  <button
                    key={icon}
                    type="button"
                    role="radio"
                    aria-checked={current.icon === icon}
                    aria-label={icon.replace(/([a-z])([A-Z0-9])/g, "$1 $2")}
                    title={icon.replace(/([a-z])([A-Z0-9])/g, "$1 $2")}
                    onClick={() => save({ icon, color: shown.color })}
                    className={cn("neu-tile size-7", current.icon === icon && "neu-inset")}
                    style={tileStyle(current.color)}
                  >
                    <Icon className="size-3.5" strokeWidth={2.25} />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-t pt-2">
            {error ? (
              <span role="alert" className="text-destructive text-[12px]">
                {error}
              </span>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => save({ icon: null, color: null })}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px]"
            >
              <RotateCcw className="size-3.5" aria-hidden /> Reset to default
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
