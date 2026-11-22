import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const source = await readFile(new URL('../src/workers/multiProviderRotationWorker.ts', import.meta.url), 'utf8');
const query = source.match(/`(WITH candidate AS \([\s\S]*?)`,\s*\[claimToken\]/)?.[1];
assert.ok(query, 'use the production claim query, not a second queue algorithm');
const connectionString = process.env.BOOST_TEST_DATABASE_URL;

async function fixture(check) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TEMP TABLE engagement_orders (id uuid, user_id uuid, link text, status text, created_at timestamptz);
      CREATE TEMP TABLE engagement_order_items (id uuid, engagement_order_id uuid, status text, provider_mappings jsonb,
        user_provider_account_id uuid, user_bundle_item_id uuid, engagement_type text, custom_comments text);
      CREATE TEMP TABLE organic_run_schedule (id uuid, engagement_order_item_id uuid, run_number int, quantity_to_send int,
        status text, scheduled_at timestamptz, created_at timestamptz, updated_at timestamptz, provider_order_id text,
        dispatch_uncertain boolean, error_message text, claim_token uuid, claimed_at timestamptz);`);
    const add = async (ageHours, dueMinutes, overrides = {}) => {
      const order = randomUUID(), item = randomUUID(), run = randomUUID();
      await client.query("INSERT INTO engagement_orders VALUES ($1,$2,'https://instagram.com/reel/fixture/','processing',now()-($3*interval '1 hour'))", [order, randomUUID(), ageHours]);
      await client.query("INSERT INTO engagement_order_items (id,engagement_order_id,status,engagement_type) VALUES ($1,$2,$3,'views')", [item, order, overrides.itemStatus ?? 'pending']);
      await client.query(`INSERT INTO organic_run_schedule (id,engagement_order_item_id,run_number,quantity_to_send,status,scheduled_at,created_at,provider_order_id,dispatch_uncertain)
        VALUES ($1,$2,1,585,'pending',now()-($3*interval '1 minute'),now(),$4,$5)`, [run, item, dueMinutes, overrides.providerId ?? null, overrides.uncertain ?? false]);
      return run;
    };
    const claim = async () => (await client.query(query.replaceAll('lovable_legacy.', 'pg_temp.'), [randomUUID()])).rows[0];
    await check({ add, claim });
  } finally { await client.end(); }
}

test('a 30-hour live order due 50 minutes ago goes before a newer order due 5 minutes ago', { skip: !connectionString }, async () => {
  await fixture(async ({ add, claim }) => {
    const older = await add(30, 50);
    const newer = await add(1, 5);
    assert.equal((await claim()).id, older);
    assert.equal((await claim()).id, newer);
  });
});

test('fair queue never claims paid, uncertain, paused or future runs', { skip: !connectionString }, async () => {
  await fixture(async ({ add, claim }) => {
    await add(30, 90, { providerId: 'already-paid' });
    await add(30, 85, { uncertain: true });
    await add(30, 80, { itemStatus: 'paused' });
    await add(30, -5);
    const eligible = await add(30, 10);
    assert.equal((await claim()).id, eligible);
    assert.equal(await claim(), undefined);
  });
});