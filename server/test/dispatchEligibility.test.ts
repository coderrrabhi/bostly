import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engagementViewsAllowed, eligibleProviders } from '../src/lib/dispatchEligibility.ts';
const gate = { viewsTotal: 1000, itemTotal: 100, alreadySentBase: 0, runBase: 5 };
for (const type of ['likes', 'comments', 'saves', 'shares', 'reposts']) {
  test(`${type} sends nothing before confirmed Views delivery`, () => {
    assert.equal(engagementViewsAllowed({ ...gate, type, viewsDelivered: 0 }), false);
    assert.equal(engagementViewsAllowed({ ...gate, type, viewsDelivered: 49 }), false);
    assert.equal(engagementViewsAllowed({ ...gate, type, viewsDelivered: 50 }), true);
  });
}
test('Views dispatch does not wait on itself', () => {
  assert.equal(engagementViewsAllowed({ ...gate, type: 'views', viewsDelivered: 0 }), true);
});
test('engagement-only orders are blocked without delivered Views', () => {
  assert.equal(engagementViewsAllowed({ ...gate, type: 'likes', viewsTotal: 0, viewsDelivered: 0 }), false);
});
test('5 goes to min-5 provider; 10 follows priority among eligible providers', () => {
  const providers = [{ id: 'first', priority: 1, min_quantity: 10, max_quantity: 100 },
    { id: 'second', priority: 2, min_quantity: 5, max_quantity: 50 }];
  assert.deepEqual(eligibleProviders(providers, 5).map(p => p.id), ['second']);
  assert.deepEqual(eligibleProviders(providers, 10).map(p => p.id), ['first', 'second']);
});
test('priority changes apply on the next selection', () => {
  assert.deepEqual(eligibleProviders([{ id: 'a', priority: 2, min_quantity: 5 }, { id: 'b', priority: 1, min_quantity: 5 }], 10).map(p => p.id), ['b', 'a']);
});
test('above provider maximum does not send an invalid paid request', () => {
  assert.deepEqual(eligibleProviders([{ priority: 1, min_quantity: 5, max_quantity: 10 }], 11), []);
});