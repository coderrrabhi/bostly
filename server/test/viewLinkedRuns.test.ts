import { test } from "node:test";
import assert from "node:assert/strict";
import { linkRunsToViews, smoothViewsSpikes, isLinkedEngagement } from "../src/lib/viewLinkedRuns.ts";

let seed = 7;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const start = Date.parse("2026-11-25T00:00:00Z");
// Natural S-curve views: small start, peak in the middle, small end.
const viewQty = [110, 118, 135, 160, 210, 290, 380, 470, 540, 560, 520, 430, 330, 240, 170, 130, 115, 104];
let tm = start;
const views = viewQty.map((q, i) => { tm += (14 + ((i * 7) % 31)) * 60_000; return { scheduled_at: new Date(tm).toISOString(), quantity_to_send: q }; });
const viewsTotal = viewQty.reduce((a, b) => a + b, 0);
const tpl = { scheduled_at: "", quantity_to_send: 0 };

test("likes total exact and every run follows its views run at the bundle %", () => {
  const likes = Math.round(viewsTotal * 0.04);
  const runs = linkRunsToViews({ views, template: tpl, total: likes, min: 1, max: 0, rng })!;
  assert.equal(runs.reduce((a, r) => a + r.quantity_to_send, 0), likes);
  for (const r of runs) {
    const v = [...views].reverse().find((x) => Date.parse(x.scheduled_at) < Date.parse(r.scheduled_at))!;
    assert.ok(r.quantity_to_send <= Math.ceil(v.quantity_to_send * 0.04 * 1.4) + 1, `run ${r.quantity_to_send} too big for views ${v.quantity_to_send}`);
  }
});

test("biggest likes runs sit at the views peak, small at start and end", () => {
  const runs = linkRunsToViews({ views, template: tpl, total: Math.round(viewsTotal * 0.04), min: 1, max: 0, rng })!;
  const q = runs.map((r) => r.quantity_to_send);
  const peakIdx = q.indexOf(Math.max(...q));
  assert.ok(peakIdx > 3 && peakIdx < q.length - 3);
  assert.ok(q[0] < Math.max(...q) / 2 && q[q.length - 1] < Math.max(...q) / 2);
});

test("small engagement (shares min 10) carries until 10 is reached, total exact", () => {
  const runs = linkRunsToViews({ views, template: tpl, total: 40, min: 10, max: 0, rng })!;
  assert.equal(runs.reduce((a, r) => a + r.quantity_to_send, 0), 40);
  assert.ok(runs.every((r) => r.quantity_to_send >= 10));
});

test("engagement run lands 1-6 min after its views run", () => {
  const runs = linkRunsToViews({ views, template: tpl, total: 200, min: 1, max: 0, rng })!;
  for (const r of runs) {
    const at = Date.parse(r.scheduled_at);
    const v = [...views].reverse().find((x) => Date.parse(x.scheduled_at) < at)!;
    const gap = at - Date.parse(v.scheduled_at);
    assert.ok(gap >= 60_000 && gap <= 7 * 60_000, `gap ${gap}`);
  }
});

test("views spike is smoothed with total unchanged", () => {
  const spiky = views.map((v, i) => ({ ...v, quantity_to_send: i === 9 ? 1200 : v.quantity_to_send }));
  const out = smoothViewsSpikes(spiky, 100, 0);
  const tot = (r: { quantity_to_send: number }[]) => r.reduce((a, x) => a + x.quantity_to_send, 0);
  assert.equal(tot(out), tot(spiky));
  const q = out.map((r) => r.quantity_to_send);
  for (let i = 2; i < q.length - 1; i += 1) assert.ok(q[i] <= ((q[i - 1] + q[i + 1]) / 2) * 1.3, `spike at ${i}`);
});

test("comments and views are not linked", () => {
  assert.equal(isLinkedEngagement("comments"), false);
  assert.equal(isLinkedEngagement("views"), false);
  assert.equal(isLinkedEngagement("likes"), true);
});

test("no sudden dip or spike between neighbouring likes runs", () => {
  for (let s = 1; s < 30; s += 1) {
    seed = s * 977;
    const runs = linkRunsToViews({ views, template: tpl, total: Math.round(viewsTotal * 0.045), min: 1, max: 0, rng })!;
    const q = runs.map((r) => r.quantity_to_send);
    for (let i = 1; i < q.length - 1; i += 1) {
      const avg = (q[i - 1] + q[i + 1]) / 2;
      assert.ok(q[i] >= avg * 0.5 - 1 && q[i] <= avg * 1.6 + 2, `seed ${s} run ${i}: ${q.join(",")}`);
    }
  }
});

test("every linked run has a different quantity, total exact", () => {
  for (let s = 1; s < 20; s += 1) {
    seed = s * 131;
    const total = Math.round(viewsTotal * 0.045);
    const runs = linkRunsToViews({ views, template: tpl, total, min: 1, max: 0, rng })!;
    const q = runs.map((r) => r.quantity_to_send);
    assert.equal(new Set(q).size, q.length);
    assert.equal(q.reduce((a, b) => a + b, 0), total);
  }
});

test("makeDistinct keeps rank and total", async () => {
  const { makeDistinct } = await import("../src/lib/viewLinkedRuns.ts");
  const out = makeDistinct([5, 5, 5, 9, 9], 1, 0)!;
  assert.equal(new Set(out).size, 5);
  assert.equal(out.reduce((a, b) => a + b, 0), 33);
  assert.ok(out[3] > out[0] && out[4] > out[0]);
  assert.equal(makeDistinct([1, 1, 1], 1, 0), null);
});

test("gaps between runs are never the same", async () => {
  const { distinctGaps } = await import("../src/lib/viewLinkedRuns.ts");
  const base = Date.parse("2026-11-25T00:00:00Z");
  const runs = Array.from({ length: 40 }, (_, i) => ({ ...tpl, scheduled_at: new Date(base + i * 15 * 60_000).toISOString(), quantity_to_send: 5 }));
  const ts = distinctGaps(runs).map((r) => Date.parse(r.scheduled_at) / 1000);
  const gaps = ts.slice(1).map((x, i) => Math.round(x - ts[i]));
  assert.equal(new Set(gaps).size, gaps.length);
  assert.ok(gaps.every((g) => g >= 60));
});
