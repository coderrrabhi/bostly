import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
const deployed = new URL('../frontend-src/src/lib/engagement-order-management.ts', import.meta.url);
const source = new URL('../../frontend/src/lib/engagement-order-management.ts', import.meta.url);
const { loadAllEngagementOrders, isOrderVisible, canPauseOrder, enforceRunMinimums, resolveEffectiveMin, dashboardOrderCounts, isRefillOrder } = await import(existsSync(deployed) ? deployed.href : source.href);

test('completed Reel links remain visible after 48 hours and indefinitely', () => {
  assert.equal(isOrderVisible({ status: 'completed', completed_at: '2020-01-01' } as any), true);
  assert.equal(isOrderVisible({ status: 'processing' }), true);
  assert.equal(isOrderVisible({ status: 'deleted' }), false);
});
test('history loads older orders beyond the first 1000 without an age cutoff', async () => {
  const ranges: number[] = [];
  const client = { from: () => {
    const query = { select: () => query, eq: () => query, neq: () => query, order: () => query,
      range: async (start: number) => {
        ranges.push(start);
        return { data: Array.from({ length: start < 1100 ? 100 : 1 }, (_, i) => ({ id: start + i, status: 'completed' })), error: null };
      } };
    return query;
  } };
  const result = await loadAllEngagementOrders(client, 'owner', 'id,status');
  assert.equal(result.length, 1101);
  assert.equal(ranges.at(-1), 1100);
});
test('Pause is available only for unsent active work, not completed deliveries', () => {
  assert.equal(canPauseOrder('processing'), true);
  assert.equal(canPauseOrder('completed'), false);
  assert.equal(canPauseOrder('deleted'), false);
});

const run = (quantity_to_send: number, at = '2026-01-01T00:00:00Z') => ({ quantity_to_send, scheduled_at: at });

test('a curve run below the provider minimum is merged up so the server never rejects the order', () => {
  // Real failure shape from the curve generator: likes min 2, one run of 1.
  const fixed = enforceRunMinimums([run(20), run(1), run(29)], 2);
  assert.equal(fixed.reduce((a, r) => a + r.quantity_to_send, 0), 50);
  assert.ok(fixed.every((r) => r.quantity_to_send >= 2));
});
test('when every run is below the minimum they merge into a single valid run', () => {
  const fixed = enforceRunMinimums([run(1), run(1), run(1)], 2);
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].quantity_to_send, 3);
});
// Customer's My Bundles minimums: likes 1, saves 1, comments 1, reposts 1, shares 10, views 101.
test('My Bundles minimum 1 lets likes and saves start with small runs like comments/reposts', () => {
  assert.equal(resolveEffectiveMin(1, 1, 2), 1);   // likes: bundle 1 beats built-in default 2
  assert.equal(resolveEffectiveMin(1, 1, 10), 1);  // saves: bundle 1 beats built-in default 10
  assert.equal(resolveEffectiveMin(1, 1, 1), 1);   // comments/reposts unchanged
});
test('My Bundles minimum above the default still applies exactly', () => {
  assert.equal(resolveEffectiveMin(10, 1, 2), 10); // shares: bundle 10 kept
  assert.equal(resolveEffectiveMin(101, 100, 101), 101); // views
});
test('without a bundle minimum, provider service minimum and defaults still apply', () => {
  assert.equal(resolveEffectiveMin(0, 5, 2), 5);
  assert.equal(resolveEffectiveMin(null, 0, 10), 10);
  assert.equal(resolveEffectiveMin(undefined, 0, 0), 1);
});
test('valid runs pass through untouched', () => {
  const input = [run(101), run(250), run(149)];
  const fixed = enforceRunMinimums(input, 101);
  assert.deepEqual(fixed.map((r) => r.quantity_to_send), [101, 250, 149]);
});

test('dashboard counts use only retained Reels and identify refill orders from their saved name', () => {
  const orders = [
    { status: 'processing', order_name: 'Main Reel' },
    { status: 'partial', order_name: 'Partial Reel' },
    { status: 'completed', order_name: 'Finished - Refill' },
    { status: 'paused', order_name: 'Paused Reel' },
    { status: 'deleted', order_name: 'Deleted - Refill' },
  ];
  assert.deepEqual(dashboardOrderCounts(orders), { total: 4, processing: 2, completed: 1, paused: 1, refill: 1 });
  assert.equal(isRefillOrder({ order_name: 'My Reel - Refill' }), true);
  assert.equal(isRefillOrder({ order_name: 'My Reel' }), false);
});

test('a partial Reel with unsent runs can be paused; one with nothing left cannot', () => {
  assert.equal(canPauseOrder('partial', true), true);
  assert.equal(canPauseOrder('partial', false), false);
});
