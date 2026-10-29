/**
 * Durations as people type and read them: "1h 30m", "1.5h", "90m", "1:30", "45" (minutes).
 * Returns minutes, or null when the text isn't a duration.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  // 1:30 → hours:minutes
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  // Plain number → minutes
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  // 1h 30m, 1.5h, 2 hours, 45 min, 1d (= 8h working day)
  const unit = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)/g;
  let total = 0;
  let matched = "";
  for (const m of t.matchAll(unit)) {
    const value = Number(m[1]);
    const u = m[2]![0];
    total += u === "d" ? value * 8 * 60 : u === "h" ? value * 60 : value;
    matched += m[0];
  }
  // Everything typed must have been understood.
  if (!matched || t.replace(/\s/g, "") !== matched.replace(/\s/g, "")) return null;
  return Math.round(total);
}

/** 95 → "1h 35m"; 0 → "0m". Fractions are rounded down to whole minutes. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** A running timer's face: 3725 s → "1:02:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
