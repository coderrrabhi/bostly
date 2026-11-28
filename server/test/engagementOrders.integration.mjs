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
  if (sql.includes('RETURNING o.id')) return { rows: [{ id: account }], rowCount: 1 };
  if (sql.includes('SELECT id FROM lovable_legacy.user_bundles')) return { rows: [{ id: 'bundle' }] };
  if (sql.includes('r.run_number=1')) return { rows: globalThis.__recentStarts ?? [] };
  if (sql.includes('FROM lovable_legacy.user_bundle_items')) return { rows: [{ id: 'item', min_quantity: 1, max_quantity: 10000 }] };
  if (sql.includes('SELECT m.user_provider_account_id')) return { rows: [{ user_provider_account_id: account, provider_service_id: '1', rate: 1, min_quantity: globalThis.__providerMin ?? 1, max_quantity: globalThis.__providerMax ?? 100, user_service_id: account }] };
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
  assert.equal(insert.params[7], false, 'omitted Peak Hours must save OFF');
});
test('Peak Hours saves ON only when the customer explicitly enables it', async () => {
  const result = await call('/functions/process-engagement-order', { user_bundle_id: account, link: 'https://instagram.com/reel/peak-opt-in/', base_quantity: 1,
    peak_hours_enabled: true, engagements: [{ type: 'likes', quantity: 1, provider_mappings: [{ user_provider_account_id: account, provider_service_id: '1' }] }] });
  assert.equal(result.statusCode, 201);
  const insert = dbQueries.find(q => q.sql.includes('INSERT INTO lovable_legacy.engagement_orders'));
  assert.equal(insert.params[7], true);
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
test('placed orders keep the exact displayed views and likes despite recent starts', async () => {
  globalThis.__recentStarts = [{ engagement_type: 'views', quantity_to_send: 90 }];
  const at = (m) => new Date(Date.now() + m * 60_000).toISOString();
  const runs = (qs) => qs.map((q, i) => ({ scheduled_at: at(i * 20), quantity_to_send: q }));
  const mapping = [{ user_provider_account_id: account, provider_service_id: '1' }];
  const result = await call('/functions/process-engagement-order', { user_bundle_id: account, link: 'https://instagram.com/reel/x/', base_quantity: 240,
    engagements: [{ type: 'views', quantity: 240, provider_mappings: mapping, scheduled_runs: runs([90, 80, 70]) },
      { type: 'likes', quantity: 62, provider_mappings: mapping, scheduled_runs: runs([24, 16, 22]) }] });
  assert.equal(result.statusCode, 201);
  const inserted = dbQueries.filter(q => q.sql.includes('INSERT INTO lovable_legacy.organic_run_schedule'));
  const firstOf = (n) => inserted.slice(n === 'views' ? 0 : 3).find(q => q.params[2] === 1).params[4];
  assert.equal(firstOf('views'), 90);
  assert.equal(firstOf('likes'), 24, 'valid preview quantities stay unchanged after placement');
  globalThis.__recentStarts = [];
});
test('Views minimum 100 rejects an 88-view preview instead of silently changing it', async () => {
  globalThis.__providerMin = 100;
  globalThis.__providerMax = 10000000;
  const quantities = [88,115,105,109,113,121,126,124,127,128,120,119,117,115,114,113,110,107,106];
  const total = quantities.reduce((a,b) => a+b,0);
  const result = await call('/functions/process-engagement-order', {
    user_bundle_id: account, link:'https://instagram.com/reel/minimum-test/',base_quantity:total,
    engagements:[{type:'views',quantity:total,provider_mappings:[{user_provider_account_id:account,provider_service_id:'1'}],
      scheduled_runs:quantities.map((q,i)=>({quantity_to_send:q,scheduled_at:new Date(Date.now()+i*20*60000).toISOString()}))}],
  });
  globalThis.__providerMin = undefined; globalThis.__providerMax = undefined;
  assert.equal(result.statusCode,400);
  const saved = dbQueries.filter(q=>q.sql.includes('INSERT INTO lovable_legacy.organic_run_schedule'));
  assert.equal(saved.length,0);
  assert.ok(dbQueries.some(q => q.sql === 'ROLLBACK'));
});

test('proof comments 1,2,6,4 save as the same four runs and a single-run preview stays single', async () => {
  for (const quantities of [[1,2,6,4], [13]]) {
    const result = await call('/functions/process-engagement-order', {
      user_bundle_id: account, link:'https://instagram.com/reel/proof/',base_quantity:13,preview_required:true,
      engagements:[{type:'comments',quantity:13,custom_comments:Array.from({length:13},(_,i)=>`Comment ${i+1}`).join('\n'),provider_mappings:[{user_provider_account_id:account,provider_service_id:'1'}],
        scheduled_runs:quantities.map((q,i)=>({quantity_to_send:q,scheduled_at:new Date(Date.now()+i*20*60000).toISOString()}))}],
    });
    assert.equal(result.statusCode,201);
    const saved = dbQueries.filter(q=>q.sql.includes('INSERT INTO lovable_legacy.organic_run_schedule'));
    assert.deepEqual(saved.map(q=>q.params[4]),quantities);
    assert.deepEqual(saved.map(q=>q.params[2]),quantities.map((_,i)=>i+1));
  }
});

test('missing required preview fails before any order is inserted', async () => {
  const result = await call('/functions/process-engagement-order', {
    user_bundle_id:account,link:'https://instagram.com/reel/missing/',base_quantity:13,preview_required:true,
    engagements:[{type:'likes',quantity:13,provider_mappings:[{user_provider_account_id:account,provider_service_id:'1'}]}],
  });
  assert.equal(result.statusCode,400);
  assert.equal(dbQueries.filter(q=>q.sql.includes('INSERT INTO lovable_legacy.engagement_orders')).length,0);
});
