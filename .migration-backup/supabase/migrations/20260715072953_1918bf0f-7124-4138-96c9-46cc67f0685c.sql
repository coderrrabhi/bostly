INSERT INTO public.subscriptions (user_id, plan_type, status, activated_at, expires_at)
SELECT p.user_id, 'monthly', 'active', now(), now() + interval '30 days'
FROM public.profiles p
WHERE lower(p.email) = 'boostlypro@gmail.com'
ON CONFLICT (user_id) DO UPDATE
  SET plan_type = 'monthly',
      status = 'active',
      activated_at = now(),
      expires_at = now() + interval '30 days',
      updated_at = now();