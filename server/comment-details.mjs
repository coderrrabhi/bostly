import pg from 'pg'; const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
for(const q of [
`SELECT o.order_number,o.status order_status,e.status item_status,e.quantity,length(e.custom_comments) text_length,r.run_number,r.quantity_to_send,r.status,r.provider_order_id,r.error_message FROM lovable_legacy.organic_run_schedule r JOIN lovable_legacy.engagement_order_items e ON e.id=r.engagement_order_item_id JOIN lovable_legacy.engagement_orders o ON o.id=e.engagement_order_id WHERE e.engagement_type='comments' AND r.status IN ('failed','dispatch_uncertain') ORDER BY o.order_number,r.run_number`,
`SELECT column_name FROM information_schema.columns WHERE table_schema='lovable_legacy' AND table_name='user_services'`,
`SELECT event,count(*)::int n FROM lovable_legacy.provider_dispatch_logs d JOIN lovable_legacy.organic_run_schedule r ON r.id=d.run_id JOIN lovable_legacy.engagement_order_items e ON e.id=r.engagement_order_item_id WHERE e.engagement_type='comments' GROUP BY event`
]) console.log(JSON.stringify((await p.query(q)).rows)); await p.end();
