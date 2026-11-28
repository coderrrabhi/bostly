/**
 * Every connection carries server-side time limits so one blocked or hung
 * query can never hold a pool slot forever. Before these limits, a query
 * waiting on a row lock (or a dead socket) kept a worker connection busy with
 * no error, the 6-slot worker pool drained, and every delivery stopped
 * site-wide with nothing in the logs (Nov 17, 23:30 IST).
 */
export const DB_LIMITS = {
  web: { statement: 60_000, lock: 15_000, idleTx: 60_000 },
  worker: { statement: 30_000, lock: 10_000, idleTx: 60_000 },
} as const;

export type DbLimits = { statement: number; lock: number; idleTx: number };

export function poolSessionOptions(limits: DbLimits): string {
  return [
    "-c search_path=public,extensions",
    `-c statement_timeout=${limits.statement}`,
    `-c lock_timeout=${limits.lock}`,
    `-c idle_in_transaction_session_timeout=${limits.idleTx}`,
  ].join(" ");
}

