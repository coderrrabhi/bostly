
ALTER TABLE public.user_bundle_items ALTER COLUMN user_service_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.user_bundle_item_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_bundle_item_id uuid NOT NULL REFERENCES public.user_bundle_items(id) ON DELETE CASCADE,
  user_provider_account_id uuid NOT NULL REFERENCES public.user_provider_accounts(id) ON DELETE CASCADE,
  provider_service_id text,
  priority integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_bundle_item_id, user_provider_account_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bundle_item_providers TO authenticated;
GRANT ALL ON public.user_bundle_item_providers TO service_role;

ALTER TABLE public.user_bundle_item_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own bundle item providers - select" ON public.user_bundle_item_providers FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own bundle item providers - insert" ON public.user_bundle_item_providers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own bundle item providers - update" ON public.user_bundle_item_providers FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own bundle item providers - delete" ON public.user_bundle_item_providers FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ubip_item ON public.user_bundle_item_providers(user_bundle_item_id);
CREATE INDEX IF NOT EXISTS idx_ubip_user ON public.user_bundle_item_providers(user_id);

CREATE TRIGGER trg_ubip_updated_at BEFORE UPDATE ON public.user_bundle_item_providers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
