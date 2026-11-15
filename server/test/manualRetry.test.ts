import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const deployed = new URL("../frontend-src/src/lib/manual-retry.ts", import.meta.url);
const source = new URL("../../frontend/src/lib/manual-retry.ts", import.meta.url);
const { safeManualRetryRuns } = await import(existsSync(deployed) ? deployed.href : source.href);
const now = new Date("2026-11-14T10:00:00Z");

const order = (run: any, viewsStatus = "processing") => ({
  items: [
    { engagement_type: "views", quantity: 100, status: viewsStatus, runs: [
      { id: "v1", status: viewsStatus === "completed" ? "completed" : "started", quantity_to_send: 100, provider_remains: viewsStatus === "completed" ? 0 : 50 },
    ] },
    { engagement_type: "likes", runs: [run, { id: "next", run_number: 2, status: "pending", scheduled_at: "2026-11-14T11:00:00Z" }] },
  ],
});

test("an explicit failure with no accepted provider order can be manually retried", () => {
  assert.deepEqual(safeManualRetryRuns(order({ id: "r1", run_number: 1, status: "failed", provider_order_id: null }), now).map((run: any) => run.id), ["r1"]);
});

test("manual retry cannot duplicate an accepted or uncertain order", () => {
  assert.equal(safeManualRetryRuns(order({ id: "r1", run_number: 1, status: "failed", provider_order_id: "paid-1" }), now).length, 0);
  assert.equal(safeManualRetryRuns(order({ id: "r1", run_number: 1, status: "failed", provider_order_id: null, dispatch_uncertain: true }), now).length, 0);
});

test("manual retry stops after views completion", () => {
  assert.equal(safeManualRetryRuns(order({ id: "r1", run_number: 1, status: "failed", provider_order_id: null }, "completed"), now).length, 0);
});

test("manual retry stops when the following run is due", () => {
  const late = order({ id: "r1", run_number: 1, status: "failed", provider_order_id: null });
  late.items[1].runs[1].scheduled_at = "2026-11-14T10:00:00Z";
  assert.equal(safeManualRetryRuns(late, now).length, 0);
});
