"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TIME_ZONE_COOKIE } from "@/lib/time-zone";

/** Tells the server the browser's time zone, so "today" and "overdue" match the viewer's calendar. */
export function TimeZoneCookie() {
  const router = useRouter();
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;
    const current = document.cookie.split("; ").find((c) => c.startsWith(`${TIME_ZONE_COOKIE}=`));
    if (current === `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}`) return;
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
    // First visit (or a new zone): render again with the right "today".
    router.refresh();
  }, [router]);
  return null;
}
