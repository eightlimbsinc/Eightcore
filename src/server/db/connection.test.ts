import { describe, expect, it } from "vitest";
import { connectionOptionsFromEnv, poolConfig } from "./connection";

const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

describe("poolConfig", () => {
  it("uses the URL unchanged without a CA (local development)", () => {
    const url = "postgres://u:p@localhost:5432/db";
    expect(poolConfig(url, { max: 5 })).toEqual({ connectionString: url, max: 5 });
  });

  it("verifies TLS against the CA and strips ssl URL params that would override it", () => {
    const config = poolConfig(
      "postgres://u:p@db.example.com:6543/postgres?sslmode=require&application_name=x",
      {
        caPem: CA,
      },
    );
    expect(config.ssl).toEqual({ ca: CA, rejectUnauthorized: true });
    expect(config.connectionString).toBe("postgres://u:p@db.example.com:6543/postgres?application_name=x");
  });
});

describe("connectionOptionsFromEnv", () => {
  it("reads CA and pool size, ignoring invalid sizes", () => {
    expect(connectionOptionsFromEnv({ DATABASE_SSL_CA: CA, DATABASE_POOL_MAX: "3" })).toMatchObject({
      caPem: CA,
      max: 3,
    });
    expect(connectionOptionsFromEnv({ DATABASE_POOL_MAX: "zero" }).max).toBeUndefined();
  });
});

describe("escaped newlines", () => {
  it("restores newlines in PEM text stored as one line", () => {
    const config = poolConfig("postgres://u:p@h/db", { caPem: CA.replace(/\n/g, "\\n") });
    expect(config.ssl).toEqual({ ca: CA, rejectUnauthorized: true });
  });
});
