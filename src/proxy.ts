import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PROTECTED_PREFIXES = ["/w", "/account"];
const FILE_ROUTE = /^\/w\/[^/]+\/files\/[^/]+$/;

function storageOrigin(): string {
  try {
    return process.env.S3_ENDPOINT ? ` ${new URL(process.env.S3_ENDPOINT).origin}` : "";
  } catch {
    return "";
  }
}

/**
 * Per-request CSP nonce, and a fast redirect for signed-out visitors on app pages.
 * The cookie check is only an optimisation: every page and action still verifies the
 * session against the database.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isProtected && !getSessionCookie(request, { cookiePrefix: "eightcore" })) {
    // Behind a proxy (Codespaces, a reverse proxy) request.url carries the internal host,
    // so redirect relative to the configured public URL.
    const url = new URL("/sign-in", process.env.BETTER_AUTH_URL ?? request.url);
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  // File downloads set their own, stricter headers (a sandboxed CSP).
  if (FILE_ROUTE.test(pathname)) return NextResponse.next();

  // Web-standard APIs only (no Buffer), so this runs on Node.js and edge runtimes alike.
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used by Radix positioning; scripts stay nonce-only.
    "style-src 'self' 'unsafe-inline'",
    // Image previews redirect to short-lived links on the file storage host.
    `img-src 'self' blob: data:${storageOrigin()}`,
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
