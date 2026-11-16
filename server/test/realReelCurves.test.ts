import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const deployed = new URL("../frontend-src/src/lib/", import.meta.url);
const libFile = (f: string) => (existsSync(new URL(f, deployed)) ? new URL(f, deployed) : new URL(`../../frontend/src/lib/${f}`, import.meta.url)).href;
// Read presets from source (the module imports app-only aliases).
const src = readFileSync(new URL(libFile("curve-to-schedule.ts")), "utf8");
const CURVE_PRESETS = [...src.matchAll(/id: '([\w-]+)',[\s\S]*?timeFactor: ([\d.]+),[\s\S]*?getPoints: \(type\) => \[([\s\S]*?)\n    \]/g)].map((m) => ({
  id: m[1], timeFactor: Number(m[2]),
  getPoints: () => [...m[3].matchAll(/x: (\d+), y: (\d+)/g)].map((q) => ({ x: Number(q[1]), y: Number(q[2]) })),
}));
const { curvePlan, runsForWindow, smoothSchedule } = await import(libFile("curve-plan.ts"));
const IDS = ["smooth-s-curve", "early-peak", "logarithmic-fade", "sunrise-curve", "snowball", "zen-flow", "slow-steady"];
function seeded(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; }; }

test("all 7 real-Reel curves are selectable presets with rising 0→100 shapes", () => {
  for (const id of IDS) {
    const p = CURVE_PRESETS.find((c: any) => c.id === id);
    assert.ok(p, id);
    const pts = p.getPoints("views");
    assert.equal(pts[0].y, 0); assert.equal(pts.at(-1).x, 100); assert.equal(pts.at(-1).y, 100);
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i].x > pts[i - 1].x && pts[i].y >= pts[i - 1].y, id);
  }
});

test("each real-Reel curve gives exact totals, runs ≥ minimum, inside window", () => {
  for (const id of IDS) {
    const p = CURVE_PRESETS.find((c: any) => c.id === id);
    const pts = p.getPoints("views").map((q: any) => [q.x, q.y]);
    const cum = (x: number) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); } return 100; };
    for (const views of [5700, 10000, 20500]) {
      const plan = curvePlan(views, p.timeFactor ?? 1);
      assert.ok(plan.minHours <= plan.autoHours && plan.autoHours <= plan.maxHours);
      const runs = smoothSchedule(cum, views, runsForWindow("views", views, plan.autoHours, 101), 101, seeded(views));
      assert.equal(runs.reduce((s: number, r: any) => s + r.quantity, 0), views, id);
      assert.ok(runs.every((r: any) => r.quantity >= 101 && r.timePercent < 100), id);
    }
  }
});
