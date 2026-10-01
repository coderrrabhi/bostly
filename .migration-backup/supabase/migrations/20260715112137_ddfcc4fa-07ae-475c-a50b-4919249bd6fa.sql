
REVOKE EXECUTE ON FUNCTION public.enforce_active_subscription() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_subscription_write() FROM PUBLIC, anon, authenticated;
