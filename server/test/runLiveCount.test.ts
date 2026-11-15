import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const deployed = new URL("../frontend-src/src/lib/run-live-count.ts", import.meta.url);
const source = new URL("../../frontend/src/lib/run-live-count.ts", import.meta.url);
const { runLiveCount, viewsLiveSummary, driftAdjustmentSummary } = await import(existsSync(deployed) ? deployed.href : source.href);

test("extra engagement add-ons and reductions are totalled exactly", () => {
  assert.deepEqual(driftAdjustmentSummary([7, 3, -2, 0, null]), { added: 10, removed: 2 });
});

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

test("order #694 separates 927 provider views, 170 extra views and 1,097 total growth", () => {
  const summary = viewsLiveSummary([
    { runNumber: 1, quantity: 113, startCount: 10, completed: true, delivered: 113 },
    { runNumber: 2, quantity: 131, startCount: 281, completed: true, delivered: 131 },
    { runNumber: 3, quantity: 241, startCount: 417, completed: true, delivered: 241 },
    { runNumber: 4, quantity: 442, startCount: 665, completed: false, observed: true, delivered: 442 },
  ]);
  assert.deepEqual(summary, { providerDelivered: 927, extraViews: 170, totalGrowth: 1097, latestCount: 1107 });
});

test("extra views stay unknown until a provider start count makes them measurable", () => {
  assert.deepEqual(
    viewsLiveSummary([{ runNumber: 1, quantity: 100, startCount: null, completed: false, observed: true, delivered: 20 }]),
    { providerDelivered: 20, extraViews: null, totalGrowth: null, latestCount: null },
  );
});

test("a zero start count is valid and does not fabricate organic growth", () => {
  assert.deepEqual(
    viewsLiveSummary([{ runNumber: 1, quantity: 200, startCount: 0, completed: false, observed: true, delivered: 40 }]),
    { providerDelivered: 40, extraViews: 0, totalGrowth: 40, latestCount: 40 },
  );
});
