import { test } from "node:test";
import assert from "node:assert/strict";
import { DB_LIMITS, poolSessionOptions } from "../src/lib/dbLimits.ts";

test("worker connections cancel any query after 30s and lock waits after 10s", () => {
  const o = poolSessionOptions(DB_LIMITS.worker);
  assert.match(o, /statement_timeout=30000/);
  assert.match(o, /lock_timeout=10000/);
  assert.match(o, /idle_in_transaction_session_timeout=60000/);
});

test("web transactions left open are closed after 60s so they cannot block delivery", () => {
  assert.match(poolSessionOptions(DB_LIMITS.web), /idle_in_transaction_session_timeout=60000/);
});
