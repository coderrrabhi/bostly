import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const deployed = new URL("../frontend-src/src/lib/", import.meta.url);
const libFile = (f: string) => (existsSync(new URL(f, deployed)) ? new URL(f, deployed) : new URL(`../../frontend/src/lib/${f}`, import.meta.url)).href;
const { curvePlan, runsForWindow, smoothSchedule, varyRunGaps } = await import(libFile("curve-plan.ts"));
const { averageLastCompletedRuns } = await import(libFile("refill-plan.ts"));

function seeded(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; }; }
// Viral Surge control points
const pts = [[0, 0], [25, 5], [55, 25], [75, 80], [100, 100]];
const viral = (x: number) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); } return 100; };

test("more views get more runs and a longer auto time", () => {
  const a = curvePlan(5700), b = curvePlan(10000), c = curvePlan(20500);
  assert.ok(a.runs < b.runs && b.runs < c.runs);
  assert.ok(a.autoHours <= b.autoHours && b.autoHours < c.autoHours);
  for (const p of [a, b, c]) assert.ok(p.minHours <= p.autoHours && p.autoHours <= p.maxHours);
});

test("all runs finish inside the selected window and totals are exact", () => {
  for (const [views, hours] of [[5700, 10], [10000, 6], [20500, 18]]) {
    const runs = smoothSchedule(viral, views, runsForWindow("views", views, hours, 101), 101, seeded(views));
    assert.equal(runs.reduce((s, r) => s + r.quantity, 0), views);
    assert.ok(runs.every((r) => r.timePercent < 100 && r.quantity >= 101));
  }
});

test("no unusual spike: each run stays close to the curve's share for its slot", () => {
  const n = runsForWindow("views", 20500, 18, 101);
  const runs = smoothSchedule(viral, 20500, n, 101, seeded(3));
  const steepest = (55 / 20) * (20500 / n); // steepest curve segment per run
  assert.ok(runs.every((r) => r.quantity <= steepest * 1.35 + 101));
});

test("refill starts from the average of the last 20 completed views runs", () => {
  const runs = Array.from({ length: 25 }, (_, i) => ({ scheduled_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), quantity_to_send: i < 5 ? 1000 : 100 + i, status: "completed" }));
  runs.push({ scheduled_at: new Date(Date.UTC(2026, 10, 2)).toISOString(), quantity_to_send: 9999, status: "failed" });
  assert.equal(averageLastCompletedRuns(runs, 20), Math.round(Array.from({ length: 20 }, (_, i) => 105 + i).reduce((a, b) => a + b) / 20));
});

test("planned views runs equal the runs in the schedule preview (flat-start curve)", () => {
  const quake = (x: number) => (x < 30 ? x * 0.1 : x < 40 ? 3 + (x - 30) * 6 : Math.min(100, 63 + (x - 40) * 0.62));
  const n = runsForWindow("views", 17325, 18, 101);
  const runs = smoothSchedule(quake, 17325, n, 101, seeded(9));
  assert.equal(runs.length, n);
  assert.equal(runs.reduce((s, r) => s + r.quantity, 0), 17325);
});

test("every run in a schedule has a different quantity", () => {
  for (const [total, min] of [[49, 1], [17325, 101], [320, 1], [118, 10]]) {
    const runs = smoothSchedule(viral, total, runsForWindow("likes", total, 18, min), min, seeded(total));
    assert.equal(new Set(runs.map((r) => r.quantity)).size, runs.length);
    assert.equal(runs.reduce((s, r) => s + r.quantity, 0), total);
    assert.ok(runs.every((r) => r.quantity >= min));
  }
});

test("every gap between runs is different and stays inside the window", () => {
  for (const [views, hours] of [[5700, 10], [250000, 32]]) {
    const runs = smoothSchedule(viral, views, runsForWindow("views", views, hours, 101), 101, seeded(views + 1));
    const gaps = runs.slice(1).map((r, i) => +(r.timePercent - runs[i].timePercent).toFixed(6));
    assert.equal(new Set(gaps).size, gaps.length);
    assert.ok(gaps.every((g) => g > 0));
    assert.equal(runs[0].timePercent, 0);
    assert.ok(runs.at(-1).timePercent < 100);
  }
});

test("mass/refill re-timing: all gaps different, order kept, inside the window", () => {
  const start = Date.UTC(2026, 10, 15, 0, 0);
  const runs = Array.from({ length: 30 }, (_, i) => ({ scheduled_at: new Date(start + i * 20 * 60_000).toISOString(), quantity_to_send: 100 + i }));
  const out = varyRunGaps(runs, start, 10, seeded(5));
  const ts = out.map((r) => Date.parse(r.scheduled_at));
  const gaps = ts.slice(1).map((t, i) => t - ts[i]);
  assert.equal(new Set(gaps).size, gaps.length);
  assert.ok(gaps.every((g) => g >= 60_000));
  assert.equal(ts[0], start);
  assert.ok(ts.at(-1) <= start + 10 * 3600_000);
  assert.deepEqual(out.map((r) => r.quantity_to_send), runs.map((r) => r.quantity_to_send));
});
