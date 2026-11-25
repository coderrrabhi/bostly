import { test } from "node:test";
import assert from "node:assert/strict";
import { alignPreviewToViews } from "../src/lib/viewLinkedRuns.ts";

const start = Date.parse("2026-11-25T07:00:00Z");
const viewQty = [227, 220, 257, 248, 288, 306, 355, 397, 430, 488, 557, 618, 757, 823, 915, 900, 812, 738, 643, 594, 505, 433, 365, 317];
const views = viewQty.map((q, i) => ({ scheduled_at: new Date(start + i * 25 * 60_000).toISOString(), quantity_to_send: q }));
const vt = viewQty.reduce((a, b) => a + b, 0);
const preview = [10, 11, 35, 36, 37, 40, 44, 47].map((q, i) => ({ scheduled_at: new Date(start + i * 31 * 60_000).toISOString(), quantity_to_send: q }));
const total = preview.reduce((a, r) => a + r.quantity_to_send, 0);

test("placed likes keep exactly the preview's run count and quantities (small first)", () => {
  const out = alignPreviewToViews({ views, runs: preview, total, min: 10, max: 0, rng: () => 0.5 })!;
  assert.deepEqual(out.map((r) => r.quantity_to_send), [10, 11, 35, 36, 37, 40, 44, 47]);
});

test("each likes run goes after Views and never ahead of the views ratio", () => {
  const out = alignPreviewToViews({ views, runs: preview, total, min: 10, max: 0, rng: () => 0.5 })!;
  let sent = 0;
  for (const r of out) {
    sent += r.quantity_to_send;
    const before = views.filter((v) => Date.parse(v.scheduled_at) < Date.parse(r.scheduled_at)).reduce((a, v) => a + v.quantity_to_send, 0);
    assert.ok(before > 0);
    assert.ok(sent <= (total / vt) * before / 0.98 + 1e-9, `likes ${sent} ahead of views ${before}`);
  }
});

test("a preview with the wrong total is rejected (falls back to the views planner)", () => {
  assert.equal(alignPreviewToViews({ views, runs: preview, total: total + 5, min: 10, max: 0 }), null);
});
