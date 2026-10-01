
CREATE TRIGGER tr_enforce_sub_engagement_orders
BEFORE INSERT ON public.engagement_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();

CREATE TRIGGER tr_enforce_sub_engagement_order_items
BEFORE INSERT ON public.engagement_order_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();

CREATE TRIGGER tr_enforce_sub_orders
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_subscription();
