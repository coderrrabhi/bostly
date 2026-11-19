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

const more = await import(existsSync(deployed) ? deployed.href : source.href);

test("tracking times are shown in India time", () => {
  assert.equal(more.formatIST("2026-11-17T13:51:00Z"), "07:21 PM IST");
});

test("order #746 views: extra views after run 13 are 4353 - (3563 + 281) = 509", () => {
  const extra = more.extraViewsAfterRun([
    { run_number: 13, startCount: 3563, delivered: 281 },
    { run_number: 14, startCount: 4353, delivered: 251 },
    { run_number: 15, startCount: 4993, delivered: 306 },
    { run_number: 16, startCount: null, delivered: 0 },
  ]);
  assert.equal(extra[13], 509);
  assert.equal(extra[14], 389);
  assert.equal(extra[15], null);
});

test("gap before a run shows planned and actual minutes", () => {
  const g = more.runGaps([
    { run_number: 14, scheduled_at: "2026-11-17T13:10:00Z", completed_at: "2026-11-17T13:15:00Z" },
    { run_number: 15, scheduled_at: "2026-11-17T13:28:00Z", started_at: "2026-11-17T13:28:30Z" },
  ]);
  assert.equal(more.formatGap(g[15].planned), "18m");
  assert.equal(more.formatGap(g[15].actual), "14m");
});

test("chart labels use India time", () => {
  assert.equal(more.istClock("2026-11-17T16:54:00Z"), "22:24");
});
