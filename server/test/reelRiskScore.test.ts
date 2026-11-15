import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const deployed = new URL("../frontend-src/src/lib/reel-risk-score.ts", import.meta.url);
const source = new URL("../../frontend/src/lib/reel-risk-score.ts", import.meta.url);
const { reelRiskScore, reelRiskFromItems } = await import(existsSync(deployed) ? deployed.href : source.href);

const run = (type: string, quantity: number, startedAt: string | null = null, id: string | null = null) => ({
  engagement_type: type,
  quantity_to_send: quantity,
  started_at: startedAt,
  provider_order_id: id,
});

test("a varied schedule with proportional delivery has a zero heuristic risk score", () => {
  const result = reelRiskScore(
    [run("views", 101), run("views", 113), run("likes", 5), run("likes", 7)],
    [{ type: "views", target: 214, delivered: 214 }, { type: "likes", target: 12, delivered: 12 }],
  );
  assert.equal(result.score, 0);
  assert.equal(result.level, "Low");
});

test("likes arriving with no views increase the ratio risk by the full 30 points", () => {
  const result = reelRiskScore(
    [run("views", 100), run("likes", 10)],
    [{ type: "views", target: 100, delivered: 0 }, { type: "likes", target: 10, delivered: 10 }],
  );
  assert.equal(result.factors.find((factor) => factor.key === "ratio")?.points, 30);
  assert.equal(result.score, 30);
});

test("same-minute provider dispatches add five points per extra burst run", () => {
  const result = reelRiskScore([
    run("likes", 5, "2026-11-14T10:00:00Z", "a"),
    run("likes", 7, "2026-11-14T10:00:30Z", "b"),
    run("likes", 9, "2026-11-14T10:00:50Z", "c"),
  ], []);
  assert.equal(result.factors.find((factor) => factor.key === "bursts")?.points, 10);
});

test("repeated quantities, large spikes and substantial overdelivery are separately visible", () => {
  const result = reelRiskScore(
    [run("likes", 10), run("likes", 10), run("likes", 100)],
    [{ type: "likes", target: 100, delivered: 200 }],
  );
  assert.ok(result.factors.some((factor) => factor.key === "repeats"));
  assert.ok(result.factors.some((factor) => factor.key === "spikes"));
  assert.ok(result.factors.some((factor) => factor.key === "overdelivery"));
});

test("every dashboard Reel can derive its score from its own items and runs", () => {
  const low = reelRiskFromItems([
    { engagement_type: "views", quantity: 100, runs: [{ status: "completed", quantity_to_send: 100, provider_remains: 0 }] },
    { engagement_type: "likes", quantity: 10, runs: [{ status: "completed", quantity_to_send: 10, provider_remains: 0 }] },
  ]);
  const high = reelRiskFromItems([
    { engagement_type: "views", quantity: 100, runs: [{ status: "started", quantity_to_send: 100, provider_remains: 100 }] },
    { engagement_type: "likes", quantity: 10, runs: [{ status: "completed", quantity_to_send: 10, provider_remains: 0 }] },
  ]);
  assert.equal(low.score, 0);
  assert.equal(high.score, 30);
});
