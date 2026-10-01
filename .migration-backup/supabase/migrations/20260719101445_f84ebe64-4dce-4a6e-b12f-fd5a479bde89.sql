-- Add missing activated_by column
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS activated_by UUID;

-- Create admin users summary RPC used by Admin > Users page
CREATE OR REPLACE FUNCTION public.get_admin_users_summary()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  full_name text,
  currency text,
  created_at timestamptz,
  is_banned boolean,
  banned_at timestamptz,
  banned_reason text,
  balance numeric,
  total_deposited numeric,
  total_spent numeric,
  role text,
  plan_type text,
  subscription_status text,
  subscription_expires timestamptz,
  active_single_orders bigint,
  paused_single_orders bigint,
  active_engagement_orders bigint,
  paused_engagement_orders bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.user_id,
    p.email,
    p.full_name,
    p.currency,
    p.created_at,
    p.is_banned,
    p.banned_at,
    p.banned_reason,
    COALESCE(w.balance, 0)::numeric,
    COALESCE(w.total_deposited, 0)::numeric,
    COALESCE(w.total_spent, 0)::numeric,
    (SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id = p.user_id ORDER BY (ur.role = 'admin') DESC LIMIT 1) AS role,
    COALESCE(s.plan_type, 'none')::text,
    COALESCE(s.status, 'inactive')::text,
    s.expires_at,
    COALESCE((SELECT count(*) FROM public.orders o WHERE o.user_id = p.user_id AND o.status IN ('pending','processing','in_progress','partial')), 0)::bigint,
    COALESCE((SELECT count(*) FROM public.orders o WHERE o.user_id = p.user_id AND o.status = 'paused'), 0)::bigint,
    COALESCE((SELECT count(*) FROM public.engagement_orders eo WHERE eo.user_id = p.user_id AND eo.status IN ('pending','processing','in_progress','partial')), 0)::bigint,
    COALESCE((SELECT count(*) FROM public.engagement_orders eo WHERE eo.user_id = p.user_id AND eo.status = 'paused'), 0)::bigint
  FROM public.profiles p
  LEFT JOIN public.wallets w ON w.user_id = p.user_id
  LEFT JOIN public.subscriptions s ON s.user_id = p.user_id
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_users_summary() TO authenticated;