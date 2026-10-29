// Small, dependency-free charts for the dashboard. One series hue (--viz-1), recessive
// grid, values in text colours, every mark a link with a hover value, and a table view.
import Link from "next/link";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  href,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: number;
  href: string;
  hint?: string;
  /** "critical" for counts that need attention (shown with an icon, never colour alone). */
  tone?: "critical";
  icon?: React.ReactNode;
}) {
  const alert = tone === "critical" && value > 0;
  return (
    <Link
      href={href}
      className={cn(
        "bg-surface hover:bg-surface-muted/60 grid gap-1 rounded-lg border p-4 transition-colors",
        alert && "border-destructive/40",
      )}
    >
      <span
        className={cn(
          "text-muted-foreground flex items-center gap-1.5 text-[12px] font-medium",
          alert && "text-destructive",
        )}
      >
        {icon}
        {label}
      </span>
      <span className={cn("text-3xl font-semibold tracking-tight tabular-nums", alert && "text-destructive")}>
        {value}
      </span>
      {hint ? <span className="text-muted-foreground text-[11px]">{hint}</span> : null}
    </Link>
  );
}

export function ChartCard({
  title,
  description,
  children,
  table,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** The same numbers as a table (for screen readers, print, exact values). */
  table: { headers: [string, string]; rows: [string, number][] };
}) {
  return (
    <section className="bg-surface grid content-start gap-3 rounded-lg border p-4" aria-label={title}>
      <div>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {description ? <p className="text-muted-foreground text-[12px]">{description}</p> : null}
      </div>
      {children}
      <details className="text-[12px]">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none">
          Show as table
        </summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 font-medium">{table.headers[0]}</th>
              <th className="py-1 text-right font-medium">{table.headers[1]}</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map(([label, value]) => (
              <tr key={label} className="border-t">
                <td className="py-1">{label}</td>
                <td className="py-1 text-right tabular-nums">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export interface BarRow {
  label: string;
  value: number;
  href: string;
  /** Extra text after the value, e.g. "2 high". */
  note?: string;
}

/** Horizontal bars, one hue; the value sits at the end of each bar. */
export function BarList({ rows, empty }: { rows: BarRow[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  // Reserve the note column on every row when any row has one, so the bars line up.
  const withNotes = rows.some((r) => r.note);
  if (!rows.length || rows.every((r) => r.value === 0)) {
    return <p className="text-muted-foreground py-4 text-[13px]">{empty}</p>;
  }
  return (
    <ul className="grid gap-1.5">
      {rows.map((r) => (
        <li key={r.label}>
          <Link
            href={r.href}
            title={`${r.label}: ${r.value}${r.note ? ` (${r.note})` : ""}`}
            className="hover:bg-surface-muted/60 grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-3 rounded-md px-1 py-1"
          >
            <span className="truncate text-[13px]">{r.label}</span>
            <span className="flex items-center gap-2">
              <span className="bg-viz-grid relative h-2.5 flex-1 overflow-hidden rounded-r-[4px]">
                <span
                  className="bg-viz-1 absolute inset-y-0 left-0 rounded-r-[4px]"
                  style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? "4px" : 0 }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-[13px] font-medium tabular-nums">{r.value}</span>
              {withNotes ? (
                <span className="text-muted-foreground w-16 shrink-0 text-[11px]">{r.note ?? ""}</span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars over time (weeks), one hue; hover or focus a bar for its value. */
export function ColumnChart({
  columns,
  label,
}: {
  columns: { label: string; value: number; href: string }[];
  label: string;
}) {
  const max = Math.max(1, ...columns.map((c) => c.value));
  const peak = Math.max(...columns.map((c) => c.value));
  return (
    <div className="grid gap-1" role="group" aria-label={label}>
      <div className="border-viz-grid flex h-40 items-end gap-2 border-b pt-5">
        {columns.map((c, i) => (
          <Link
            key={c.label}
            href={c.href}
            aria-label={`${c.label}: ${c.value}`}
            className="group relative flex h-full flex-1 items-end justify-center"
          >
            {/* Value: always for the latest week and the peak, otherwise on hover. */}
            <span
              className={cn(
                "text-muted-foreground absolute -top-0.5 text-[11px] tabular-nums transition-opacity",
                i === columns.length - 1 || (c.value === peak && peak > 0)
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              )}
              style={{ bottom: `calc(${(c.value / max) * 100}% + 2px)`, top: "auto" }}
            >
              {c.value}
            </span>
            <span
              className="bg-viz-1 group-hover:bg-viz-1/80 w-full max-w-10 rounded-t-[4px]"
              style={{ height: `${(c.value / max) * 100}%`, minHeight: c.value ? "4px" : 0 }}
            />
          </Link>
        ))}
      </div>
      <div className="flex gap-2">
        {columns.map((c) => (
          <span key={c.label} className="text-muted-foreground flex-1 truncate text-center text-[10px]">
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
