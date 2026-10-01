// Builds the lookup indexes for the restored legacy tables with
// CREATE INDEX CONCURRENTLY, which cannot run inside the transactional Drizzle
// migration. Running this first keeps writers unblocked during a deploy;
// migration 0005 then finds the indexes already present (IF NOT EXISTS).
import pg from "pg";

const SCHEMA = "lovable_legacy";
const indexes = [
  { name: "organic_run_schedule_id_idx", table: "organic_run_schedule", columns: ["id"] },
  { name: "organic_run_schedule_item_run_idx", table: "organic_run_schedule", columns: ["engagement_order_item_id", "run_number"] },
  { name: "engagement_order_items_id_idx", table: "engagement_order_items", columns: ["id"] },
  { name: "engagement_orders_id_idx", table: "engagement_orders", columns: ["id"] },
  { name: "engagement_orders_order_number_idx", table: "engagement_orders", columns: ["order_number"] },
];

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const index of indexes) {
    const table = await client.query("SELECT to_regclass($1) AS oid", [`${SCHEMA}.${index.table}`]);
    if (!table.rows[0].oid) {
      console.log(`[legacy-indexes] ${SCHEMA}.${index.table} does not exist here; skipping ${index.name}`);
      continue;
    }
    const existing = await client.query(
      `SELECT i.indisvalid FROM pg_class c
         JOIN pg_index i ON i.indexrelid = c.oid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2`,
      [SCHEMA, index.name],
    );
    if (existing.rows[0]?.indisvalid) continue;
    if (existing.rows.length) {
      // A previous interrupted build left an invalid index behind; rebuild it.
      console.log(`[legacy-indexes] dropping invalid index ${index.name}`);
      await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${SCHEMA}"."${index.name}"`);
    }
    const started = Date.now();
    await client.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${index.name}" ON "${SCHEMA}"."${index.table}" (${index.columns.map((c) => `"${c}"`).join(", ")})`,
    );
    console.log(`[legacy-indexes] built ${index.name} in ${Date.now() - started} ms`);
  }
} finally {
  await client.end();
}
