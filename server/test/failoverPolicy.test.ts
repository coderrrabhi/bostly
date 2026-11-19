import { test } from "node:test";
import assert from "node:assert/strict";
import { failedRunFailoverBlock, failoverWindowBlock } from "../src/lib/failoverPolicy.ts";

const safeCancelled = {
  status: "failed",
  providerStatus: "Canceled",
  providerOrderId: "provider-1",
  quantityToSend: 12,
  providerRemains: 12,
  viewsComplete: false,
  nextRunScheduledAt: "2026-11-14T11:00:00Z",
  now: "2026-11-14T10:00:00Z",
};

test("a confirmed zero-delivery cancellation can fail over before the next run", () => {
  assert.equal(failedRunFailoverBlock(safeCancelled), null);
});

test("no failed engagement is requeued after all views runs and views quantity are complete", () => {
  assert.equal(failedRunFailoverBlock({ ...safeCancelled, viewsComplete: true }), "views-complete");
});

test("a failed run is never replaced once the following run is due", () => {
  assert.equal(failedRunFailoverBlock({ ...safeCancelled, now: "2026-11-14T11:00:00Z" }), "next-run-due");
  assert.equal(failoverWindowBlock({ viewsComplete: false, nextRunScheduledAt: "2026-11-14T11:00:00Z", now: "2026-11-14T11:00:01Z" }), "next-run-due");
});

test("a provider order still processing is never duplicated", () => {
  assert.equal(failedRunFailoverBlock({ ...safeCancelled, status: "started", providerStatus: "Processing", providerRemains: 12 }), "unresolved-provider-order");
});

test("an accepted order with an unreadable status is ambiguous and cannot be duplicated", () => {
  assert.equal(failedRunFailoverBlock({ ...safeCancelled, providerStatus: null, providerRemains: null }), "unresolved-provider-order");
});

test("a partially delivered cancellation is never replaced", () => {
  assert.equal(failedRunFailoverBlock({ ...safeCancelled, providerRemains: 5 }), "partial-delivery");
});

test("an explicit rejection before provider acceptance can use the next priority", () => {
  assert.equal(failedRunFailoverBlock({ ...safeCancelled, providerOrderId: null, providerStatus: null, providerRemains: null }), null);
});

test("a normal scheduled run is not misclassified as a failover", () => {
  assert.equal(failedRunFailoverBlock({ ...safeCancelled, status: "pending", providerOrderId: null, providerStatus: null, providerRemains: null }), "not-a-safe-failure");
});
