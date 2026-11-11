// The "Minimum Order per Run" (Default/Custom) panel was removed: per-run
// minimums come from "My Bundles" only. These tests lock that rule in.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync } from 'node:fs';

const deployed = new URL('../frontend-src/src/lib/', import.meta.url);
const source = new URL('../../frontend/src/lib/', import.meta.url);
const lib = (file: string) => {
  const onServer = new URL(file, deployed);
  return existsSync(onServer) ? onServer.href : new URL(file, source).href;
};

const { deliveryPayload, loadDeliverySettings, DEFAULT_DELIVERY_SETTINGS } = await import(lib('order-delivery-settings.ts'));
const { resolveEffectiveMin } = await import(lib('engagement-order-management.ts'));

// Built-in floors the removed panel used to fall back to.
const BUILT_IN = { likes: 2, saves: 10, shares: 2, comments: 1, reposts: 1, views: 101 };

test('order payload carries the delivery start time and nothing else', () => {
  assert.deepEqual(
    deliveryPayload({ startMode: 'custom', startDelayMinutes: 10 }),
    { start_delay_minutes: 10 },
  );
  assert.deepEqual(
    deliveryPayload({ startMode: 'instant', startDelayMinutes: 10 }),
    { start_delay_minutes: 0 },
  );
});

test('order payload no longer sends per-run minimum quantities', () => {
  const payload = deliveryPayload({ startMode: 'custom', startDelayMinutes: 5 });
  assert.equal('min_quantities' in payload, false);
});

test('saved settings from the old minimum panel are ignored on load', () => {
  const store = new Map<string, string>([[
    'boostly.delivery-settings.v1',
    JSON.stringify({ startMode: 'custom', startDelayMinutes: 10, minMode: 'custom', customMins: { saves: 500, likes: 99 } }),
  ]]);
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const loaded = loadDeliverySettings();
  assert.deepEqual(loaded, { startMode: 'custom', startDelayMinutes: 10 });
  assert.equal('minMode' in loaded, false);
  assert.equal('customMins' in loaded, false);
});

test('My Bundles minimum beats the built-in floors the removed panel applied', () => {
  // Customer's My Bundles: likes 1, saves 1, comments 1, reposts 1, shares 10, views 101.
  assert.equal(resolveEffectiveMin(1, 1, BUILT_IN.likes), 1);
  assert.equal(resolveEffectiveMin(1, 1, BUILT_IN.saves), 1);
  assert.equal(resolveEffectiveMin(10, 1, BUILT_IN.shares), 10);
  assert.equal(resolveEffectiveMin(101, 100, BUILT_IN.views), 101);
});

test('with no My Bundles minimum the provider minimum and built-in floor still apply', () => {
  // No bundle minimum: the higher of provider service minimum and built-in floor wins.
  assert.equal(resolveEffectiveMin(null, 20, BUILT_IN.saves), 20);
  assert.equal(resolveEffectiveMin(null, 5, BUILT_IN.saves), 10);
  assert.equal(resolveEffectiveMin(0, 0, BUILT_IN.saves), 10);
  assert.equal(DEFAULT_DELIVERY_SETTINGS.startMode, 'instant');
});
