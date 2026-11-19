import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

import { DB_LIMITS, poolSessionOptions, type DbLimits } from "../lib/dbLimits";

const { Pool } = pg;

function positivePoolSize(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(50, Math.floor(parsed));
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function createPool(max: number, limits: DbLimits): pg.Pool {
  const created = new Pool({
    connectionString: process.env.DATABASE_URL,
    // ORM tables are the public compatibility views, never the RLS-filtered
    // legacy base tables. Legacy operations already qualify their schema.
    options: poolSessionOptions(limits),
    // Client-side backstop for dead sockets the server can no longer cancel.
    query_timeout: limits.statement + 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    maxUses: 7_500,
  });
  // An idle client erroring (e.g. terminated by idle-tx timeout) must not crash the process.
  created.on("error", () => {});
  return created;
}

/** Pool for interactive web requests. */
export const pool = createPool(positivePoolSize(process.env.DB_POOL_MAX, 15), DB_LIMITS.web);

/**
 * Separate, smaller pool for background workers so a busy dispatch/status
 * tick can never starve user-facing requests of database connections.
 */
export const workerPool = createPool(positivePoolSize(process.env.WORKER_POOL_MAX, 6), DB_LIMITS.worker);

export const db = drizzle(pool, { schema });

export * from "./schema";
