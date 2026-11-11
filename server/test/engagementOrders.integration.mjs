import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { test, after } from 'node:test';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const output = new URL(`../.order-test-${randomUUID()}.mjs`, import.meta.url);
const dbQueries = [];
const handlers = {};
globalThis.__dbQuery = async (sql, params) => {
  dbQueries.push({ sql, params });
  if (sql.includes('SELECT id, status')) return { rows: globalThis.__owned };
  if (sql.includes('SELECT id FROM lovable_legacy.user_bundles')) return { rows: [{ id: 'bundle' }] };
  if (sql.includes('SELECT id FROM lovable_legacy.user_bundle_items')) return { rows: [{ id: 'item' }] };
  if (sql.includes('SELECT m.user_provider_account_id')) return { rows: [{ user_provider_account_id: account, provider_service_id: '1', rate: 1, min_quantity: 1, max_quantity: 100, user_service_id: account }] };
  if (sql.includes('INSERT INTO lovable_legacy.engagement_orders')) return { rows: [{ id: account, order_number: 439 }] };
  if (sql.includes('INSERT INTO lovable_legacy.engagement_order_items')) return { rows: [{ id: account }] };
  return { rows: [], rowCount: 1 };
};
globalThis.__route = (path, handler) => { handlers[path] = handler; };
await build({ entryPoints: [new URL('../src/routes/legacyEngagementOrders.ts', import.meta.url).pathname], outfile: output.pathname,
  bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'mock-deps', setup(b) {
    b.onResolve({ filter: /^(express|\.\.\/db|\.\.\/middlewares\/auth|\.\.\/lib\/identity|\.\.\/workers\/multiProviderRotationWorker)$/ }, a => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents:
      a.path === 'express' ? 'export const Router=()=>({use(){},post:(...a)=>globalThis.__route(...a)});' :
      a.path === '../db' ? 'const client={query:(...a)=>globalThis.__dbQuery(...a),release(){}};export const pool={connect:async()=>client};' :
      a.path.includes('auth') ? 'export const requireAuth=()=>{};' :
      a.path.includes('identity') ? 'export const resolveLegacyId=async()=>"owner";' : 'export const kickRotationExecutor=()=>{};' }));
  } }] });
await import(output.href);
after(() => rm(output, { force: true }));
const account = '11111111-1111-4111-8111-111111111111';
async function call(path, body) {
  dbQueries.length = 0;
  const res = { statusCode: 200, status(n) { this.statusCode=n; return this; }, json(data) { this.data=data; } };
  await handlers[path]({ body, userId: 'owner', log: { warn(){} } }, res);
  return res;
}
test('custom Reel name and curve are stored on order placement', async () => {
  const result = await call('/functions/process-engagement-order', { user_bundle_id: account, link: 'https://instagram.com/reel/example/', base_quantity: 1,
    order_name: '  My Reel  ', curve_name: 'Viral Surge', engagements: [{ type: 'likes', quantity: 1, provider_mappings: [{ user_provider_account_id: account, provider_service_id: '1' }] }] });
  assert.equal(result.statusCode, 201);
  const insert = dbQueries.find(q => q.sql.includes('INSERT INTO lovable_legacy.engagement_orders'));
  assert.equal(insert.params[5], 'My Reel'); assert.equal(insert.params[6], 'Viral Surge');
});
test('Pause does not change completed or deleted order items', async () => {
  globalThis.__owned = [{ id: account, status: 'processing' }, { id: 'done', status: 'completed' }, { id: 'deleted', status: 'deleted' }];
  const result = await call('/functions/engagement-order-action', { order_ids: [account], action: 'pause' });
  assert.equal(result.statusCode, 200);
  const update = dbQueries.find(q => q.sql.includes('UPDATE lovable_legacy.engagement_order_items'));
  assert.deepEqual(update.params[0], [account]);
});
test('Delete cancels only unsent runs and marks the owned order deleted', async () => {
  globalThis.__owned = [{ id: account, status: 'completed' }];
  await call('/functions/engagement-order-action', { order_ids: [account], action: 'delete' });
  assert.ok(dbQueries.some(q => q.sql.includes('run.provider_order_id IS NULL')));
  assert.ok(dbQueries.some(q => q.sql.includes("SET status='deleted'")));
});
