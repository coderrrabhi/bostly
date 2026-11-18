import { test } from "node:test";
import assert from "node:assert/strict";
import { driftAdjustment, viewsDrift } from "../src/lib/viewsDrift.ts";

const v = (rows: [number, number | null][]) => rows.map(([q, sc], i) => ({ runNumber: i + 1, quantity: q, startCount: sc, completed: true }));

test("order #530: 240-ish runs but the Reel jumped 730->1600 shows ~650 extra views", () => {
  const d = viewsDrift(v([[105, 0], [106, 230], [129, 385], [222, 730], [485, 1600]]));
  assert.ok(d);
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
  const d = viewsDrift(v([[248, 5592], [249, 6607], [226, 6094]]));
  assert.ok(d);
  assert.equal(d.ordered, 723);
  assert.equal(d.extra, 6094 + 226 - 5592 - 723);
});

test("an in-progress provider reading exposes extra views before the views run completes", () => {
  const views = [
    { runNumber: 1, quantity: 113, startCount: 10, completed: true, delivered: 113 },
    { runNumber: 2, quantity: 131, startCount: 281, completed: false, observed: true, delivered: 131 },
  ];
  assert.deepEqual(viewsDrift(views), { ordered: 244, extra: 158 });
  assert.equal(driftAdjustment({ views, viewsTotal: 1000, itemQuantity: 100, appliedSoFar: 0, runQuantity: 20, min: 1, max: 0, lastRun: false }), 10);
});

test("zero is a valid first provider reading and does not invent extra views", () => {
  const views = [{ runNumber: 1, quantity: 200, startCount: 0, completed: false, observed: true, delivered: 40 }];
  assert.deepEqual(viewsDrift(views), { ordered: 40, extra: 0 });
});

test("the final run never doubles its curve quantity to clear extra-view debt", () => {
  const views = v([[200, 100], [200, 10000]]);
  assert.equal(driftAdjustment({ views, viewsTotal: 400, itemQuantity: 400, appliedSoFar: 0, runQuantity: 20, min: 1, max: 0, lastRun: true }), 10);
});

test('extra-view ratio debt follows small and large remaining curve quantities', () => {
  const views = v([[200, 100], [200, 600]]); // 300 extra views, 30 extra likes at 10%
  const common = { views, viewsTotal: 1000, itemQuantity: 100, appliedSoFar: 0,
    min: 1, max: 0, lastRun: false, remainingBase: 100 };
  assert.equal(driftAdjustment({ ...common, runQuantity: 10 }), 3);
  assert.equal(driftAdjustment({ ...common, runQuantity: 40 }), 12);
});

test('quantity one cannot jump by 100 percent from an add-on', () => {
  assert.equal(driftAdjustment({ views: v([[200, 100], [200, 10000]]), viewsTotal: 400,
    itemQuantity: 400, appliedSoFar: 0, runQuantity: 1, min: 1, max: 0, lastRun: false,
    remainingBase: 10 }), 0);
});
