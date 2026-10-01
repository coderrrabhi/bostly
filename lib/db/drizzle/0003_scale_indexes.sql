CREATE INDEX IF NOT EXISTS engagement_order_items_order_idx
  ON lovable_legacy.engagement_order_items (engagement_order_id, id);

CREATE INDEX IF NOT EXISTS user_bundle_items_bundle_idx
  ON lovable_legacy.user_bundle_items (user_bundle_id, user_id, engagement_type, id);

CREATE INDEX IF NOT EXISTS user_bundle_item_providers_active_idx
  ON lovable_legacy.user_bundle_item_providers
  (user_bundle_item_id, user_id, priority)
  INCLUDE (user_provider_account_id, provider_service_id)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS user_services_active_mapping_idx
  ON lovable_legacy.user_services (user_id, user_provider_account_id, provider_service_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS engagement_orders_user_created_idx
  ON lovable_legacy.engagement_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS provider_dispatch_logs_created_at_idx
  ON lovable_legacy.provider_dispatch_logs (created_at);