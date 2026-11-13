import { test } from "node:test";
import assert from "node:assert/strict";
import { differentStart, mixSmallRuns, runMinimum, shapeEngagementRuns, smallStartCap } from "../src/lib/runShaping.ts";

const t = (m: number) => new Date(Date.UTC(2026, 10, 11, 6, 0) + m * 60_000).toISOString();
const runsOf = (qs: number[]) => qs.map((q, i) => ({ scheduled_at: t(i * 20), quantity_to_send: q }));
const sum = (rs: { quantity_to_send: number }[]) => rs.reduce((a, r) => a + r.quantity_to_send, 0);
function seeded(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; }; }

test("My Bundles minimum 1 wins over a provider minimum of 10", () => {
  assert.equal(runMinimum(1, 10), 1);
  assert.equal(runMinimum(10, 1), 10);
  assert.equal(runMinimum(null, 5), 5);
});

test("96 saves over 51 slots of 1-2 become a mix of small and larger runs, total exact", () => {
  const flat = runsOf(Array.from({ length: 51 }, (_, i) => (i % 2 ? 2 : 1)).map((q, i) => (i < 45 ? q : 3)));
  const total = sum(flat);
  for (let s = 1; s <= 30; s++) {
    const out = mixSmallRuns(flat, 1, 10000, seeded(s));
    assert.equal(sum(out), total);
    assert.ok(out.every((r) => r.quantity_to_send >= 1));
    assert.ok(new Set(out.map((r) => r.quantity_to_send)).size >= 3, "sizes are mixed");
    assert.ok(out[0].quantity_to_send <= 3, "starts small");
  }
});

test("mixed runs never deliver ahead of the selected curve", () => {
  const flat = runsOf(Array.from({ length: 30 }, () => 1));
  const out = mixSmallRuns(flat, 1, 10000, seeded(7));
  for (const r of out.slice(0, -1)) {
    const curveSoFar = flat.filter((f) => f.scheduled_at <= r.scheduled_at).length;
    const sentSoFar = sum(out.filter((o) => o.scheduled_at <= r.scheduled_at));
    assert.ok(sentSoFar <= curveSoFar);
  }
});

test("likes with min 1 start small even when the curve's first run is 24", () => {
  const likes = runsOf([24, 16, 22, 27, 20, 32, 27, 17, 14, 13]);
  for (let s = 1; s <= 20; s++) {
    const out = shapeEngagementRuns({ type: "likes", runs: likes, min: 1, max: 10000, rng: seeded(s) });
    assert.equal(sum(out), sum(likes));
    assert.ok(out[0].quantity_to_send <= smallStartCap(sum(likes), likes.length, 1, 10000));
    assert.ok(out[0].quantity_to_send < 24);
  }
});

test("shares with My Bundles min 10 never go below 10", () => {
  const shares = runsOf([13, 12, 13, 21, 13, 18, 16, 12]);
  for (let s = 1; s <= 20; s++) {
    const out = shapeEngagementRuns({ type: "shares", runs: shares, min: 10, max: 10000, rng: seeded(s) });
    assert.equal(sum(out), 118);
    assert.ok(out.every((r) => r.quantity_to_send >= 10));
  }
});

test("views starting quantity differs from recent Reels and the curve total is kept", () => {
  const views = runsOf([132, 123, 125, 117, 127]);
  const out = shapeEngagementRuns({ type: "views", runs: views, min: 101, max: 0, recentStarts: [132, 131, 133] });
  assert.ok(![132, 131, 133].includes(out[0].quantity_to_send));
  assert.equal(sum(out), sum(views));
  assert.deepEqual(out.slice(2).map((r) => r.quantity_to_send), [125, 117, 127]);
});

test("ten Reels in a row each get a different first views run", () => {
  const recent: number[] = [];
  for (let i = 0; i < 10; i++) {
    const out = shapeEngagementRuns({ type: "views", runs: runsOf([150, 160, 170]), min: 101, max: 0, recentStarts: recent });
    assert.ok(!recent.includes(out[0].quantity_to_send));
    recent.unshift(out[0].quantity_to_send);
  }
});

test("tiny engagements avoid the previous Reel's start when another small value exists", () => {
  const out = differentStart(runsOf([2, 3, 2]), 1, 10000, [2, 1], 3);
  assert.equal(out[0].quantity_to_send, 3);
  assert.equal(sum(out), 7);
  // all small values used: pick the one used longest ago, not the latest
  const out2 = differentStart(runsOf([2, 3, 2]), 1, 10000, [2, 1, 3], 3);
  assert.equal(out2[0].quantity_to_send, 3);
});

test("a run below the bundle minimum is merged, never sent", () => {
  const out = shapeEngagementRuns({ type: "likes", runs: runsOf([5, 20, 30]), min: 10, max: 0, rng: seeded(3) });
  assert.ok(out.every((r) => r.quantity_to_send >= 10));
  assert.equal(sum(out), 55);
});

test("no two runs of one engagement on a Reel share a quantity", () => {
  for (const [type, qs, min] of [["saves", Array.from({ length: 25 }, () => 2), 1], ["likes", [24, 16, 22, 27, 20, 32, 27, 17, 14, 13], 1], ["shares", [13, 12, 13, 21, 13, 18, 16, 12], 10], ["views", [300, 300, 300, 300], 101]] as const) {
    for (let s = 1; s <= 15; s++) {
      const runs = runsOf([...qs]);
      const out = shapeEngagementRuns({ type, runs, min, max: 10000, rng: seeded(s) });
      assert.equal(new Set(out.map((r) => r.quantity_to_send)).size, out.length);
      assert.equal(sum(out), sum(runs));
      assert.ok(out.every((r) => r.quantity_to_send >= min));
    }
  }
});
