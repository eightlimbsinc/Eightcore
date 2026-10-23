// Builds node-postgres settings from a connection URL plus optional TLS settings.
// No `server-only` import: CLI scripts (migrate, setup) use it too. No filesystem access here:
// it would make Next.js trace the whole project into the server bundle. Scripts that take a
// certificate *file* read it themselves (scripts/db/connection-env.ts).
import type { PoolConfig } from "pg";

export interface ConnectionOptions {
  /** PEM text of the CA that signs the server's certificate (e.g. Supabase's root CA). */
  caPem?: string;
  max?: number;
}

const SSL_URL_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "sslnegotiation"];

/**
 * With a CA, TLS is verified against it (full hostname verification) and any ssl* URL
 * parameters are dropped. node-postgres lets URL parameters override an explicit `ssl`
 * option, which would otherwise silently replace our verified settings.
 * Without a CA, the URL is used as-is (local development uses no TLS).
 */
export function poolConfig(connectionString: string, options: ConnectionOptions = {}): PoolConfig {
  // Env files and hosting dashboards often store PEM text with escaped newlines.
  const ca = options.caPem?.trim().replace(/\\n/g, "\n") || undefined;
  if (!ca) return { connectionString, max: options.max };

  const url = new URL(connectionString);
  for (const param of SSL_URL_PARAMS) url.searchParams.delete(param);
  return {
    connectionString: url.toString(),
    max: options.max,
    ssl: { ca, rejectUnauthorized: true },
  };
}

/** Options from the conventional environment variables. */
export function connectionOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): ConnectionOptions {
  const max = Number(env.DATABASE_POOL_MAX);
  return {
    caPem: env.DATABASE_SSL_CA || undefined,
    max: Number.isInteger(max) && max > 0 ? max : undefined,
  };
}
