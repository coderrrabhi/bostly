// "Copy all" on a dashboard run list must put the provider order numbers on the
// clipboard as one comma-separated line: 81701884,81704009,23173940
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync } from 'node:fs';

const deployed = new URL('../frontend-src/src/components/engagement/', import.meta.url);
const source = new URL('../../frontend/src/components/engagement/', import.meta.url);
const componentFile = (file: string) => {
  const onServer = new URL(file, deployed);
  return existsSync(onServer) ? onServer.href : new URL(file, source).href;
};

const { providerOrderIds } = await import(componentFile('providerOrderIds.ts'));

test('copy all yields provider order numbers separated by commas only', () => {
  const runs = [
    { provider_order_id: '81701884' },
    { provider_order_id: '81704009' },
    { provider_order_id: '23173940' },
  ];
  assert.equal(providerOrderIds(runs), '81701884,81704009,23173940');
});

test('runs without a provider order number are skipped, repeats dropped', () => {
  const runs = [
    { provider_order_id: null },
    { provider_order_id: '  ' },
    { provider_order_id: '81701884' },
    { provider_order_id: 81701884 },
    { provider_order_id: '81704009' },
    {},
  ];
  assert.equal(providerOrderIds(runs), '81701884,81704009');
});

test('an empty section copies nothing instead of a blank or header line', () => {
  assert.equal(providerOrderIds([]), '');
  assert.equal(providerOrderIds(undefined as any), '');
});
