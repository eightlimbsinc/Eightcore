import type { NextConfig } from "next";

// The public address the app is served from (BETTER_AUTH_URL). Behind a proxy (GitHub Codespaces,
// a reverse proxy in production) the browser's origin differs from the Host the server sees, so
// Server Action CSRF checks and dev-resource checks must trust this one configured address.
// Next.js loads .env files before evaluating this config.
const publicUrl = (() => {
  try {
    return process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL) : undefined;
  } catch {
    return undefined;
  }
})();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Don't write an AGENTS.md into the repo on `next dev`.
  agentRules: false,
  allowedDevOrigins: publicUrl ? [publicUrl.hostname] : [],
  experimental: {
    serverActions: {
      allowedOrigins: publicUrl ? [publicUrl.host] : [],
      // Attachments are uploaded through Server Actions (MAX_UPLOAD_BYTES, default 4 MB, plus form overhead).
      bodySizeLimit: "5mb",
    },
  },
  reactStrictMode: true,
  // `pg` is a native-ish Node package; keep it out of the server bundle.
  serverExternalPackages: ["pg"],
  async headers() {
    // CSP is set per request in src/proxy.ts (it needs a nonce).
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
