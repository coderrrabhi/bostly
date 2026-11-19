import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliveryProgress, confirmedDelivery, type ProgressRun } from '../frontend-src/src/lib/delivery-progress.ts';

const run = (overrides: Partial<ProgressRun> = {}): ProgressRun => ({
  id: 'r', run_number: 1, scheduled_at: '2026-11-17T00:00:00Z',
  completed_at: '2026-11-17T00:00:00Z', quantity_to_send: 100,
  status: 'completed', engagement_type: 'views', provider_order_id: '123', ...overrides,
});
const now = Date.parse('2026-11-17T01:00:00Z');
test('exact selected-schedule delivery scores 100/100', () => {
  assert.equal(buildDeliveryProgress([run()], now).score, 100);
});
test('half-delivered curve scores 50/100 after an hour', () => {
  assert.equal(buildDeliveryProgress([run({ provider_remains: 50 })], now).score, 50);
});
test('future scheduled runs do not reduce the current matching score', () => {
  const data = buildDeliveryProgress([run(), run({ id: 'future', scheduled_at: '2026-11-17T02:00:00Z', status: 'pending', provider_order_id: null })], now);
  assert.equal(data.score, 100);
  assert.equal(data.chartData.at(-1)?.pct_views, null);
});
test('cancelled target-met and unsent runs are not fabricated delivery', () => {
  assert.equal(confirmedDelivery(run({ status: 'cancelled' })), 0);
  assert.equal(confirmedDelivery(run({ provider_order_id: null })), 0);
  assert.equal(buildDeliveryProgress([run({ status: 'pending', provider_order_id: null })], now).score, null);
});
test('partial and failed provider readings count only confirmed delivery', () => {
  assert.equal(confirmedDelivery(run({ status: 'partial', provider_remains: 30 })), 70);
  assert.equal(confirmedDelivery(run({ status: 'failed', provider_remains: 90 })), 10);
});
test('curve order is Views Likes Comments Saves Shares Reposts', () => {
  const types = ['reposts', 'shares', 'comments', 'views', 'saves', 'likes'];
  assert.deepEqual(buildDeliveryProgress(types.map(engagement_type => run({ engagement_type })), now).types,
    ['views', 'likes', 'comments', 'saves', 'shares', 'reposts']);
});
test('partial readings are not backdated to run start', () => {
  const data = buildDeliveryProgress([run({ status: 'started', completed_at: null,
    updated_at: '2026-11-17T00:30:00Z', provider_remains: 50 })], now);
  assert.equal(data.chartData.find(p => p.timestamp === Date.parse('2026-11-17T00:00:00Z'))?.views, 0);
  assert.equal(data.score, 25);
});

test('due engagement with no delivery is not hidden from the overall match score', () => {
  const data = buildDeliveryProgress([run(), run({ id: 'likes', engagement_type: 'likes',
    status: 'pending', provider_order_id: null })], now);
  assert.equal(data.scores.likes, 0);
  assert.equal(data.score, 50);
});