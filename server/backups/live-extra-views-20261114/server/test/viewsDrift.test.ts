import { test } from "node:test";
import assert from "node:assert/strict";
import { driftAdjustment, viewsDrift } from "../src/lib/viewsDrift.ts";

const v = (rows: [number, number | null][]) => rows.map(([q, sc], i) => ({ runNumber: i + 1, quantity: q, startCount: sc, completed: true }));

test("order #530: 240-ish runs but the Reel jumped 730->1600 shows ~650 extra views", () => {
  const d = viewsDrift(v([[105, 0], [106, 230], [129, 385], [222, 730], [485, 1600]]))!;
  assert.ok(d.extra > 500, String(d.extra));
});

test("shares 37 per 8476 views: extra 1000 views add ~4 shares, capped to half a run", () => {
  const views = v([[200, 100], [200, 1300]]); // 1000 extra views
  const big = driftAdjustment({ views, viewsTotal: 8476, itemQuantity: 37, appliedSoFar: 0, runQuantity: 10, min: 1, max: 0, lastRun: false });
  assert.equal(big, 4);
  const capped = driftAdjustment({ views, viewsTotal: 8476, itemQuantity: 370, appliedSoFar: 0, runQuantity: 10, min: 1, max: 0, lastRun: false });
  assert.equal(capped, 5);
});

test("already-applied extra is not added twice", () => {
  const views = v([[200, 100], [200, 1300]]);
  assert.equal(driftAdjustment({ views, viewsTotal: 8476, itemQuantity: 37, appliedSoFar: 4, runQuantity: 10, min: 1, max: 0, lastRun: false }), 0);
});

test("fewer views than ordered lowers the run, never below the bundle minimum", () => {
  const views = v([[500, 1000], [500, 1100], [500, 1200]]); // gained 700 for 1500 ordered
  assert.equal(driftAdjustment({ views, viewsTotal: 1500, itemQuantity: 150, appliedSoFar: 0, runQuantity: 12, min: 10, max: 0, lastRun: false }), -2);
});

test("no provider start count yet means no change", () => {
  assert.equal(driftAdjustment({ views: v([[200, 0], [200, null]]), viewsTotal: 1000, itemQuantity: 50, appliedSoFar: 0, runQuantity: 5, min: 1, max: 0, lastRun: false }), 0);
});

test("order #531 run 18's odd start count (6607 then 6094) is ignored", () => {
  const d = viewsDrift(v([[248, 5592], [249, 6607], [226, 6094]]))!;
  assert.equal(d.ordered, 723);
  assert.equal(d.extra, 6094 + 226 - 5592 - 723);
});
