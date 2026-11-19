import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const deployed = new URL("../frontend-src/src/lib/run-live-count.ts", import.meta.url);
const source = new URL("../../frontend/src/lib/run-live-count.ts", import.meta.url);
const { runLiveCount } = await import(existsSync(deployed) ? deployed.href : source.href);

test("a scheduled run never repeats the previous run's count", () => {
  assert.deepEqual(
    runLiveCount({ status: "pending", providerStartCount: 111, actualDelivered: 0 }),
    { kind: "scheduled" },
  );
});

test("a processing run accepts zero as a real provider start count", () => {
  assert.deepEqual(
    runLiveCount({ status: "started", providerStartCount: 0, actualDelivered: 6 }),
    { kind: "counts", startCount: 0, endCount: 6, delivered: 6 },
  );
});

test("a processing views run shows its provider-derived current count", () => {
  assert.deepEqual(
    runLiveCount({ status: "started", providerStartCount: 665, actualDelivered: 442 }),
    { kind: "counts", startCount: 665, endCount: 1107, delivered: 442 },
  );
});

test("missing provider start count never becomes a fabricated zero-to-total range", () => {
  assert.deepEqual(
    runLiveCount({ status: "started", providerStartCount: null, actualDelivered: 34 }),
    { kind: "delivery-only", delivered: 34 },
  );
});
