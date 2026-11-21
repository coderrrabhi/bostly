import { test } from "node:test";
import assert from "node:assert/strict";
import { paceRunsToViews } from "../src/lib/ratioPacing.ts";

const t = (m: number) => new Date(Date.UTC(2026, 10, 10, 17, 0) + m * 60_000).toISOString();
const views = { type: "views", quantity: 8476, runs: [183, 256, 403, 647, 425, 568, 498, 998, 4498].map((q, i) => ({ scheduled_at: t(i * 40), quantity_to_send: q })) };

test("shares 20+17 of 37 cannot go out before views reach the same share", () => {
  const shares = { type: "shares", quantity: 37, runs: [{ scheduled_at: t(0), quantity_to_send: 20 }, { scheduled_at: t(20), quantity_to_send: 17 }] };
  const [, paced] = paceRunsToViews([views, shares]);
  // 20/37 of 8476 = 4582 views -> only reached at the last views run (minute 320)
  assert.equal(paced[0].scheduled_at, new Date(Date.parse(t(320)) + 60_000).toISOString());
  assert.deepEqual(paced.map((r) => r.quantity_to_send), [20, 17]);
});

test("cumulative engagement never exceeds its % of scheduled views", () => {
  const likes = { type: "likes", quantity: 318, runs: Array.from({ length: 10 }, (_, i) => ({ scheduled_at: t(i), quantity_to_send: i < 9 ? 32 : 30 })) };
  const [, paced] = paceRunsToViews([views, likes]);
  let cum = 0;
  for (const r of paced) {
    cum += r.quantity_to_send;
    const viewsBefore = views.runs.filter((v) => Date.parse(v.scheduled_at) < Date.parse(r.scheduled_at)).reduce((a, v) => a + v.quantity_to_send, 0);
    assert.ok(cum / 318 <= viewsBefore / 8476 + 1e-9);
  }
});

test("orders without views are unchanged", () => {
  const likes = { type: "likes", quantity: 10, runs: [{ scheduled_at: t(0), quantity_to_send: 10 }] };
  assert.equal(paceRunsToViews([likes])[0][0].scheduled_at, t(0));
});

test("every engagement finishes within 10 minutes after the last Views run", async () => {
  const { paceRunsToViews } = await import("../src/lib/ratioPacing.ts");
  const at = (m: number) => new Date(Date.UTC(2026, 10, 19, 18, 0) + m * 60_000).toISOString();
  const views = Array.from({ length: 24 }, (_, i) => ({ scheduled_at: at(i * 20), quantity_to_send: 144 }));
  const likes = Array.from({ length: 8 }, (_, i) => ({ scheduled_at: at(60 + i * 60), quantity_to_send: 30 + i }));
  const [, out] = paceRunsToViews([{ type: "views", quantity: 3456, runs: views }, { type: "likes", quantity: 252, runs: likes }]);
  const viewsEnd = Date.parse(views.at(-1)!.scheduled_at);
  const ts = out.map((r) => Date.parse(r.scheduled_at));
  assert.ok(ts.at(-1)! <= viewsEnd + 10 * 60_000);
  assert.ok(ts.every((t, i) => i === 0 || t > ts[i - 1]));
  assert.deepEqual(out.map((r) => r.quantity_to_send), likes.map((r) => r.quantity_to_send));
});
