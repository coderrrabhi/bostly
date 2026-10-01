DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='subscription_plans' AND cmd='SELECT' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.subscription_plans', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "Authenticated users can view subscription plans"
ON public.subscription_plans FOR SELECT
TO authenticated
USING (true);

REVOKE SELECT ON public.subscription_plans FROM anon;