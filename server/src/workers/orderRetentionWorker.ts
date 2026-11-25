import { workerPool as pool } from "../db";

// Orders older than 5 days are removed from history whatever their status,
// using the same steps as the user's Delete button: unsent runs are cancelled,
// items cancelled, then the order hidden. Separate statements are required:
// item/run triggers recompute order status, so the 'deleted' write must come last.
// Runs already accepted by a provider are left untouched.
export async function purgeOldOrders(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const old = await client.query(
      `SELECT id FROM lovable_legacy.engagement_orders
        WHERE created_at < now() - interval '5 days' AND status <> 'deleted'
        ORDER BY created_at LIMIT 500 FOR UPDATE SKIP LOCKED`,
    );
    const ids = old.rows.map((r) => r.id as string);
    if (ids.length === 0) { await client.query("COMMIT"); return 0; }
    await client.query(
      `UPDATE lovable_legacy.organic_run_schedule run
          SET status='cancelled', error_message='Auto-deleted after 5 days', completed_at=now(), updated_at=now()
         FROM lovable_legacy.engagement_order_items item
        WHERE run.engagement_order_item_id=item.id AND item.engagement_order_id=ANY($1::uuid[])
          AND run.status IN ('pending','failed','dispatching') AND run.provider_order_id IS NULL`,
      [ids],
    );
    await client.query(
      `UPDATE lovable_legacy.engagement_order_items SET status='cancelled', updated_at=now()
        WHERE engagement_order_id=ANY($1::uuid[]) AND status NOT IN ('completed','cancelled','failed')`,
      [ids],
    );
    const r = await client.query(
      `UPDATE lovable_legacy.engagement_orders SET status='deleted', updated_at=now()
        WHERE id=ANY($1::uuid[]) AND status<>'deleted'`,
      [ids],
    );
    await client.query("COMMIT");
    console.log(`[order-retention] deleted ${r.rowCount} orders older than 5 days`);
    return r.rowCount ?? 0;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export function startOrderRetentionWorker(): void {
  const run = async () => {
    try { while ((await purgeOldOrders()) === 500) { /* drain backlog */ } }
    catch (e) { console.error("[order-retention]", e); }
  };
  void run();
  setInterval(() => void run(), 60 * 60 * 1000);
}
