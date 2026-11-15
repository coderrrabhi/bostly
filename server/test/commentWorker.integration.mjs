import { build } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { test, after } from 'node:test';
import { randomUUID } from 'node:crypto';

const worker = await readFile(new URL('../src/workers/multiProviderRotationWorker.ts', import.meta.url), 'utf8');
const output = new URL(`../.comment-worker-test-${randomUUID()}.mjs`, import.meta.url);
await build({ stdin: { contents: worker + '\nexport { processNextRun, checkRunStatus, processDelayedDeliveryTickets };', loader: 'ts',
  resolveDir: new URL('../src/workers/', import.meta.url).pathname }, outfile: output.pathname,
  bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'isolated-worker-dependencies', setup(b) {
    b.onResolve({ filter: /^\.\.\/(db|lib\/providerCredentials|lib\/logger)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
      args.path === '../db' ? 'export const workerPool={query:(...a)=>globalThis.__query(...a),connect:async()=>({query:(...a)=>globalThis.__query(...a),release(){}})};' :
      args.path.includes('providerCredentials') ? 'export const decryptProviderCredential=()=>"mock-key";' :
      'export const logger={info(){},warn(){},error:(...args)=>console.error(...args)};' }));
  } }] });
const { processNextRun, checkRunStatus, processDelayedDeliveryTickets } = await import(output.href);
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
  assert.ok(queries.some(q => q.sql.includes("ELSE 'pending'") && q.sql.includes("'[failover] '") && q.params[2] === 2));
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

const likesRun = {
  engagement_type: 'likes', quantity_to_send: 12, run_number: 1,
  custom_comments: null, item_comments: null, comments_text: null,
};

test('a non-comment timeout is quarantined without trying another provider', async () => {
  setup(() => { throw new Error('timeout'); }, likesRun);
  await processNextRun();
  assert.equal(requests.length, 1);
  assert.ok(queries.some(q => q.sql.includes("status='dispatch_uncertain'")));
  assert.equal(queries.some(q => q.sql.includes("SET status='failed'")), false);
});

test('a non-comment unreadable confirmation cannot fail over automatically', async () => {
  setup(() => new Response('gateway unavailable', { status: 502 }), likesRun);
  await processNextRun();
  assert.equal(requests.length, 1);
  assert.ok(queries.some(q => q.sql.includes("status='dispatch_uncertain'")));
});

test('a non-comment missing order ID is ambiguous and cannot fail over', async () => {
  setup(() => new Response(JSON.stringify({ status: 'ok' })), likesRun);
  await processNextRun();
  assert.equal(requests.length, 1);
  assert.ok(queries.some(q => q.sql.includes('Provider confirmation missing')));
});

test('a queued failover sends nothing once views are complete', async () => {
  setup(() => { throw new Error('must not send'); }, { ...likesRun, prev_error: '[failover] cancelled [skip:a]' });
  const baseQuery = globalThis.__query;
  globalThis.__query = async (sql, params) => {
    if (sql.includes('SELECT vi.quantity,vi.status')) return { rows: [{ quantity: 100, status: 'completed', runs_finished: true, delivered: 100 }] };
    return baseQuery(sql, params);
  };
  await processNextRun();
  assert.equal(requests.length, 0);
  assert.ok(queries.some(q => q.params?.[0] === 'Failover skipped: all views runs and the ordered views total are already complete.'));
});

test('delayed provider IDs create one grouped Support ticket and never a duplicate', async () => {
  setup(() => { throw new Error('No provider request expected'); });
  let ticketed = false;
  let ticketCount = 0;
  const delayedRows = ['5797899', '5797364'].map((provider_order_id, index) => ({
    id: `run-${index + 1}`, engagement_order_id: 'order', order_number: 697, user_id: 'user',
    user_provider_account_id: 'a', provider_order_id, quantity_to_send: 12, provider_remains: 12,
    started_at: '2020-01-01T00:00:00Z', status: 'started', speedup_ticketed_at: null,
  }));
  globalThis.__query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('LIMIT 100')) return { rows: ticketed ? [] : delayedRows };
    if (sql.includes('FOR UPDATE OF rs')) return { rows: ticketed ? [] : delayedRows };
    if (sql.includes('INSERT INTO lovable_legacy.support_tickets')) {
      ticketCount += 1;
      assert.equal(params[2], '5797899,5797364 -- speed up this order and complete quickly. These orders are very urgent; please complete all orders asap.');
      assert.ok(sql.includes("'delivery','high','open'"));
      return { rows: [{ id: 'ticket-1' }] };
    }
    if (sql.includes('SET speedup_ticketed_at=now()')) {
      ticketed = true;
      assert.equal(params[0], 'ticket-1');
      assert.deepEqual(params[1], ['run-1', 'run-2']);
    }
    return { rows: [] };
  };
  await processDelayedDeliveryTickets();
  assert.equal(ticketCount, 1, 'first delayed-ticket pass creates one grouped ticket');
  assert.equal(ticketed, true, 'first pass marks both runs as ticketed');
  await processDelayedDeliveryTickets();
  assert.equal(ticketCount, 1);
  assert.equal(requests.length, 0);
});

test('a queued failover sends nothing once the next run is due', async () => {
  setup(() => { throw new Error('must not send'); }, { ...likesRun, prev_error: '[failover] cancelled [skip:a]' });
  const baseQuery = globalThis.__query;
  globalThis.__query = async (sql, params) => {
    if (sql.includes('SELECT scheduled_at FROM lovable_legacy.organic_run_schedule')) return { rows: [{ scheduled_at: '2020-01-01T00:00:00Z' }] };
    if (sql.includes('SELECT vi.quantity,vi.status')) return { rows: [{ quantity: 100, status: 'processing', runs_finished: false, delivered: 50 }] };
    return baseQuery(sql, params);
  };
  await processNextRun();
  assert.equal(requests.length, 0);
  assert.ok(queries.some(q => q.params?.[0] === 'Failover skipped: the following run is already due; the old order was not duplicated.'));
});

test('provider Failed is terminal and a timely zero-delivery run is requeued', async () => {
  setup(() => new Response(JSON.stringify({ status: 'Failed', remains: 12, charge: 0 })), {
    ...likesRun,
    user_provider_account_id: 'a', user_provider_account_name: 'a',
    api_url: 'https://provider.example/api', api_key_ciphertext: 'mock',
    provider_order_id: 'old-order', retry_count: 0,
  });
  const result = await checkRunStatus(run);
  assert.equal(result, true);
  assert.ok(queries.some(q => q.sql.includes("SET status='pending',provider_order_id=NULL") && q.params[1].includes('[failover]')));
});

test('provider Failed never requeues after views completion', async () => {
  setup(() => new Response(JSON.stringify({ status: 'Failed', remains: 12, charge: 0 })), {
    ...likesRun,
    user_provider_account_id: 'a', user_provider_account_name: 'a',
    api_url: 'https://provider.example/api', api_key_ciphertext: 'mock',
    provider_order_id: 'old-order', retry_count: 0,
  });
  const baseQuery = globalThis.__query;
  globalThis.__query = async (sql, params) => {
    if (sql.includes('SELECT vi.quantity,vi.status')) return { rows: [{ quantity: 100, status: 'completed', runs_finished: true, delivered: 100 }] };
    return baseQuery(sql, params);
  };
  const result = await checkRunStatus(run);
  assert.equal(result, true);
  assert.equal(queries.some(q => q.sql.includes("SET status='pending',provider_order_id=NULL")), false);
  assert.ok(queries.some(q => q.params?.[0] === 'Failover skipped: all views runs and the ordered views total are already complete.'));
});