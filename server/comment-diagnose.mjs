import pg from 'pg';
const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
const queries=[
`SELECT e.engagement_type,r.status,count(*)::int n FROM lovable_legacy.organic_run_schedule r JOIN lovable_legacy.engagement_order_items e ON e.id=r.engagement_order_item_id WHERE e.engagement_type ILIKE '%comment%' GROUP BY 1,2`,
`SELECT r.status,r.error_message,count(*)::int n FROM lovable_legacy.organic_run_schedule r JOIN lovable_legacy.engagement_order_items e ON e.id=r.engagement_order_item_id WHERE e.engagement_type ILIKE '%comment%' AND r.status IN ('failed','dispatch_uncertain') GROUP BY 1,2 ORDER BY n DESC LIMIT 15`,
`SELECT column_name FROM information_schema.columns WHERE table_schema='lovable_legacy' AND table_name='organic_run_schedule' ORDER BY ordinal_position`,
`SELECT o.order_number,e.engagement_type,e.quantity,r.run_number,r.quantity_to_send,r.status,r.provider_order_id,r.error_message,length(r.custom_comments) run_text_len,length(e.custom_comments) item_text_len FROM lovable_legacy.organic_run_schedule r JOIN lovable_legacy.engagement_order_items e ON e.id=r.engagement_order_item_id JOIN lovable_legacy.engagement_orders o ON o.id=e.engagement_order_id WHERE e.engagement_type ILIKE '%comment%' ORDER BY o.created_at DESC,r.run_number LIMIT 25`
];
for(const q of queries) console.log(JSON.stringify((await p.query(q)).rows));
await p.end();
