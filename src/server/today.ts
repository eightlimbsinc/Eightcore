import "server-only";
import { cookies } from "next/headers";
import { TIME_ZONE_COOKIE } from "@/lib/time-zone";

/** The viewer's calendar date ("YYYY-MM-DD") in their own time zone (from the browser), else UTC. */
export async function viewerToday(now = new Date()): Promise<string> {
  const zone = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  return dateIn(zone, now);
}

/** The viewer's IANA time zone if it is a real one, else "UTC". */
export async function viewerTimeZone(): Promise<string> {
  const zone = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  try {
    if (zone) {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return zone;
    }
  } catch {
    // Not a time zone name.
  }
  return "UTC";
}

export function dateIn(zone: string | undefined, now = new Date()): string {
  try {
    if (zone) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
    }
  } catch {
    // Unknown zone name: fall through to UTC.
  }
  return now.toISOString().slice(0, 10);
}
