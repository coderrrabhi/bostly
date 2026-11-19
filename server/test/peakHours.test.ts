import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const deployed = new URL('../frontend-src/src/lib/peak-hours.ts', import.meta.url);
const source = new URL('../../frontend/src/lib/peak-hours.ts', import.meta.url);
const { applyPeakHours, newYorkHour, peakHoursFactor } = await import(existsSync(deployed) ? deployed.href : source.href);

const peak = '2026-11-15T01:00:00.000Z'; // Nov 14, 8 PM in New York (EST)
const night = '2026-11-15T08:00:00.000Z'; // Nov 15, 3 AM in New York (EST)
const normal = '2026-11-15T17:00:00.000Z'; // Nov 15, noon in New York (EST)
const input = [peak, night, normal].map((scheduled_at) => ({
  scheduled_at,
  quantity_to_send: 100,
  base_quantity: 100,
}));

test('Peak Hours is OFF by default behavior and leaves every selected-curve quantity untouched', () => {
  const output = applyPeakHours(input, false, 50, 150);
  assert.deepEqual(output.map((run) => run.quantity_to_send), [100, 100, 100]);
  assert.deepEqual(output.map((run) => run.peak_multiplier), [1, 1, 1]);
});

test('USA peak weighting boosts 8 PM, slows 3 AM, and keeps exact total and run times', () => {
  assert.equal(newYorkHour(peak), 20);
  assert.equal(newYorkHour(night), 3);
  assert.equal(peakHoursFactor(peak), 1.35);
  assert.equal(peakHoursFactor(night), 0.75);
  const output = applyPeakHours(input, true, 50, 150);
  assert.ok(output[0].quantity_to_send > output[2].quantity_to_send);
  assert.ok(output[2].quantity_to_send > output[1].quantity_to_send);
  assert.equal(output.reduce((sum, run) => sum + run.quantity_to_send, 0), 300);
  assert.deepEqual(output.map((run) => run.scheduled_at), [peak, night, normal]);
  output.forEach((run) => {
    assert.ok(run.quantity_to_send >= 75 && run.quantity_to_send <= 125);
    assert.ok(run.quantity_to_send >= 50 && run.quantity_to_send <= 150);
  });
});

test('tiny My Bundles minimum and provider maximum still bound every peak-weighted run', () => {
  const tiny = [peak, night, normal].map((scheduled_at, index) => ({ scheduled_at, quantity_to_send: index + 2 }));
  const output = applyPeakHours(tiny, true, 1, 5);
  assert.equal(output.reduce((sum, run) => sum + run.quantity_to_send, 0), 9);
  assert.ok(output.every((run) => run.quantity_to_send >= 1 && run.quantity_to_send <= 5));
});
