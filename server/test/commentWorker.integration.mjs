import { build } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { test, after } from 'node:test';
import { randomUUID } from 'node:crypto';

const worker = await readFile(new URL('../src/workers/multiProviderRotationWorker.ts', import.meta.url), 'utf8');
const output = new URL(`../.comment-worker-test-${randomUUID()}.mjs`, import.meta.url);
await build({ stdin: { contents: worker + '\nexport { processNextRun };', loader: 'ts',
  resolveDir: new URL('../src/workers/', import.meta.url).pathname }, outfile: output.pathname,
  bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'isolated-worker-dependencies', setup(b) {
    b.onResolve({ filter: /^\.\.\/(db|lib\/providerCredentials|lib\/logger)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
      args.path === '../db' ? 'export const workerPool={query:(...a)=>globalThis.__query(...a),connect:async()=>({query:(...a)=>globalThis.__query(...a),release(){}})};' :
      args.path.includes('providerCredentials') ? 'export const decryptProviderCredential=()=>"mock-key";' :
      'export const logger={info(){},warn(){},error(){}};' }));
  } }] });
const { processNextRun } = await import(output.href);
after(async () => { await rm(output, { force: true }); });

let queries, requests, run;
function setup(fetchHandler, overrides = {}) {
  queries = []; requests = [];
  run = { id: 'run', claim_token: 'claim', user_id: 'user', engagement_order_id: 'order',
    engagement_type: 'comments', quantity_to_send: 2, custom_comments: 'second\nthird',
    item_comments: 'first\nsecond\nthird\nfourth', comments_text: 'first\nsecond\nthird\nfourth',
    comment_offset: 1, link: 'https://instagram.com/reel/test/',
    provider_mappings: [{ user_provider_account_id: 'a', provider_service_id: '1' },
      { user_provider_account_id: 'b', provider_service_id: '2' }], ...overrides };
  globalThis.__query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('WITH candidate AS')) return { rows: [run] };
    if (sql.includes('SELECT id,name,api_url')) return { rows: ['a','b'].map(id => ({ id, name: id,
      api_url: 'https://provider.example/api', api_key_ciphertext: 'mock', priority: 1 })) };
    return { rows: [{ id: run.id, status: 'pending' }] };
  };
  globalThis.fetch = async (url, options) => { requests.push(new URLSearchParams(options.body)); return fetchHandler(); };
}
test('run is accepted with exactly two comments and stored provider ID', async () => {
  setup(() => new Response(JSON.stringify({ order: 123 })));
  await processNextRun();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].get('quantity'), '2');
  assert.equal(requests[0].get('comments'), 'second\nthird');
  assert.ok(queries.some(q => q.sql.includes("status='started'") && q.params[0] === '123'));
});
test('explicit rejections fail over then keep the comment run queued', async () => {
  setup(() => new Response(JSON.stringify({ error: 'Provider temporarily unavailable' })));
  await processNextRun();
  assert.equal(requests.length, 2);
  assert.ok(queries.some(q => q.sql.includes("ELSE 'pending'") && q.params[2] === 2));
  assert.equal(queries.some(q => q.sql.includes("SET status='failed'")), false);
});
test('missing comment text never creates a provider request', async () => {
  setup(() => { throw new Error('must not send'); }, { custom_comments: null, item_comments: null, comments_text: null });
  await processNextRun();
  assert.equal(requests.length, 0);
  assert.ok(queries.some(q => q.sql.includes("ELSE 'pending'")));
});
test('timeout cannot create duplicate requests on a second provider', async () => {
  setup(() => { throw new Error('timeout'); });
  await processNextRun();
  assert.equal(requests.length, 1);
  assert.ok(queries.some(q => q.sql.includes('SET dispatch_uncertain=true')));
  assert.ok(queries.some(q => q.sql.includes("status='dispatch_uncertain'")));
});
test('unreadable provider confirmation is held without automatic failover', async () => {
  setup(() => new Response('gateway unavailable', { status: 502 }));
  await processNextRun();
  assert.equal(requests.length, 1);
  assert.ok(queries.some(q => q.sql.includes("status='dispatch_uncertain'")));
});
test('likes run below every provider minimum merges into the next run instead of failing', async () => {
  setup(() => new Response(JSON.stringify({ error: 'Quantity less than minimal 10' })),
    { engagement_type: 'likes', quantity_to_send: 3, custom_comments: null, item_comments: null, comments_text: null });
  const baseQuery = globalThis.__query;
  globalThis.__query = async (sql, params) => {
    if (sql.includes('SELECT id, quantity_to_send')) return { rows: [{ id: 'next-run', quantity_to_send: 5 }] };
    if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) return { rows: [] };
    return baseQuery(sql, params);
  };
  await processNextRun();
  assert.equal(requests.length, 2);
  assert.ok(queries.some(q => q.sql.includes('SET quantity_to_send=$1') && q.params[0] === 8 && q.params[1] === 'next-run'));
  assert.ok(queries.some(q => q.sql.includes("SET status='merged'")));
  assert.equal(queries.some(q => q.sql.includes("SET status='failed'")), false);
});
test('other provider rejections still fail non-comment runs without merging', async () => {
  setup(() => new Response(JSON.stringify({ error: 'Incorrect service' })),
    { engagement_type: 'likes', quantity_to_send: 3, custom_comments: null, item_comments: null, comments_text: null });
  await processNextRun();
  assert.equal(requests.length, 2);
  assert.ok(queries.some(q => q.sql.includes("SET status='failed'")));
  assert.equal(queries.some(q => q.sql.includes("SET status='merged'")), false);
});