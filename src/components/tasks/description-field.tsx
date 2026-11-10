"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const COLLAPSED_PX = 200;

/**
 * A task description that shows its first lines with "Expand" (like ClickUp), grows to fit its
 * whole text when expanded or while editing, and never needs dragging a corner.
 */
export function DescriptionField({
  id,
  name,
  defaultValue,
  disabled,
  placeholder,
  form,
}: {
  id: string;
  name: string;
  defaultValue: string;
  disabled?: boolean;
  placeholder?: string;
  form?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [tall, setTall] = useState(false);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const full = el.scrollHeight + 2;
    setTall(full > COLLAPSED_PX + 24);
    el.style.height = `${expanded ? Math.max(full, 96) : Math.min(Math.max(full, 96), COLLAPSED_PX)}px`;
  }, [expanded]);

  useLayoutEffect(() => {
    fit();
  }, [fit]);

  return (
    <div className="grid gap-1">
      <div className="relative">
        <textarea
          ref={ref}
          id={id}
          name={name}
          form={form}
          defaultValue={defaultValue}
          disabled={disabled}
          placeholder={placeholder}
          suppressHydrationWarning
          onInput={fit}
          // Editing shows everything.
          onFocus={() => setExpanded(true)}
          className={cn(
            "border-input bg-surface placeholder:text-muted-foreground/70 block w-full resize-none rounded-md border px-3 py-2 text-sm leading-relaxed disabled:opacity-50",
            !expanded && "overflow-hidden",
          )}
        />
        {!expanded && tall ? (
          <div
            aria-hidden
            className="from-surface pointer-events-none absolute inset-x-px bottom-px h-12 rounded-b-md bg-gradient-to-t to-transparent"
          />
        ) : null}
      </div>
      {tall ? (
        <div className="flex justify-center">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground hover:text-foreground hover:bg-surface-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-[12px]"
          >
            {expanded ? (
              <ChevronUp className="size-3.5" aria-hidden />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden />
            )}
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
