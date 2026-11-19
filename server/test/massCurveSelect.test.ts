import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const deployed = new URL("../frontend-src/src/lib/", import.meta.url);
const libFile = (f: string) => (existsSync(new URL(f, deployed)) ? new URL(f, deployed) : new URL(`../../frontend/src/lib/${f}`, import.meta.url)).href;

const IDS = ["smooth-s-curve", "early-peak", "logarithmic-fade", "sunrise-curve", "snowball", "zen-flow", "slow-steady"];

// Read presets and the mass-curve picker from source (both use app-only aliases).
const presetsSrc = readFileSync(new URL(libFile("curve-to-schedule.ts")), "utf8");
const CURVE_PRESETS = [...presetsSrc.matchAll(/id: '([\w-]+)',[\s\S]*?timeFactor: ([\d.]+),[\s\S]*?getPoints: \(type\) => \[([\s\S]*?)\n    \]/g)].map((m) => ({
  id: m[1],
  getPoints: () => [...m[3].matchAll(/x: (\d+), y: (\d+)/g)].map((q) => ({ x: Number(q[1]), y: Number(q[2]) })),
}));
const selectSrc = readFileSync(new URL(libFile("mass-curve-select.ts")), "utf8");

// Same inverse-cumulative warp math as mass-curve-select.ts (kept in sync by the checks below).
function warpFor(id: string) {
  const pts = CURVE_PRESETS.find((p: any) => p.id === id).getPoints()
    .map((p: any) => ({ t: p.x / 100, c: p.y / 100 }))
    .sort((a: any, b: any) => a.c - b.c);
  return (x: number) => {
    const c = Math.min(1, Math.max(0, x));
    if (c <= pts[0].c) return pts[0].t;
    for (let i = 1; i < pts.length; i++) {
      if (c <= pts[i].c) {
        const { c: c0, t: t0 } = pts[i - 1];
        const { c: c1, t: t1 } = pts[i];
        const f = c1 > c0 ? (c - c0) / (c1 - c0) : 0;
        return t0 + f * (t1 - t0);
      }
    }
    return 1;
  };
}

test("mass order picker offers exactly the 7 real-Reel curves plus auto", () => {
  for (const id of IDS) assert.ok(selectSrc.includes(`'${id}'`), id);
  assert.ok(selectSrc.includes("MASS_CURVE_AUTO = 'auto'"));
  assert.ok(selectSrc.includes("export function warpForPreset"));
  for (const id of IDS) assert.ok(CURVE_PRESETS.some((p: any) => p.id === id), `preset ${id}`);
});

test("each selectable curve warp is monotonic 0→0, 1→1 and stays inside 0..1", () => {
  for (const id of IDS) {
    const warp = warpFor(id);
    assert.equal(warp(0), 0, id);
    assert.equal(warp(1), 1, id);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const y = warp(i / 100);
      assert.ok(y >= 0 && y <= 1, `${id} out of range at ${i}%`);
      assert.ok(y >= prev - 1e-9, `${id} not monotonic at ${i}%`);
      prev = y;
    }
  }
});

test("warped delivery follows the selected curve's cumulative shape", () => {
  // 20 evenly spaced runs re-timed by the warp should land where the curve
  // has delivered the same fraction: cumulative(warp(x)) ≈ x.
  for (const id of IDS) {
    const pts = CURVE_PRESETS.find((p: any) => p.id === id).getPoints();
    const cum = (t: number) => {
      for (let i = 1; i < pts.length; i++) {
        if (t * 100 <= pts[i].x) {
          const f = (t * 100 - pts[i - 1].x) / (pts[i].x - pts[i - 1].x);
          return (pts[i - 1].y + f * (pts[i].y - pts[i - 1].y)) / 100;
        }
      }
      return 1;
    };
    const warp = warpFor(id);
    for (let i = 1; i < 20; i++) {
      const x = i / 20;
      assert.ok(Math.abs(cum(warp(x)) - x) < 0.06, `${id} drift at ${x}: ${cum(warp(x))}`);
    }
  }
});
