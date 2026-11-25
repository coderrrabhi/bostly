import test from 'node:test';
import assert from 'node:assert/strict';
import { providerRejection } from '../src/lib/dispatchEligibility.ts';

test('status fail reply is an explicit rejection (busy link retries the same run)', () => {
  assert.equal(providerRejection({ status: 'fail', message: 'You have active order with this link. Please wait until order being completed.' }),
    'You have active order with this link. Please wait until order being completed.');
});
test('error reply is an explicit rejection', () => {
  assert.equal(providerRejection({ error: 'Quantity less than minimal 10' }), 'Quantity less than minimal 10');
});
test('accepted order is not a rejection', () => {
  assert.equal(providerRejection({ order: 144609497 }), undefined);
});
test('empty reply stays unconfirmed, not a rejection', () => {
  assert.equal(providerRejection({}), undefined);
});
