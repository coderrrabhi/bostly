import { istClock } from "@/lib/run-live-count";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { format, formatDistanceToNow } from "date-fns";
import { 
  ExternalLink, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Play,
  RefreshCw,
  Eye,
  Heart,
  MessageCircle,
  Bookmark,
  Share2,
  ChevronRight,
  Zap,
  Timer,
  Search,
  X,
  BarChart3
} from "lucide-react";
import { PageMeta } from "@/components/seo/PageMeta";
import { Skeleton } from "@/components/ui/skeleton";
import { RefillOrderDialog } from "@/components/engagement/RefillOrderDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Pause, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { loadAllEngagementOrders, runOrderAction } from '@/lib/engagement-order-management';

const ENGAGEMENT_ICONS = {
  views: Eye,
  likes: Heart,
  comments: MessageCircle,
  saves: Bookmark,
  shares: Share2,
};

const STATUS_CONFIG = {
  pending: { color: "bg-secondary text-foreground border border-border", icon: Clock },
  processing: { color: "bg-foreground text-background", icon: Play },
  completed: { color: "bg-secondary text-foreground border border-border", icon: CheckCircle2 },
  partial: { color: "bg-secondary text-foreground border border-border", icon: RefreshCw },
  failed: { color: "bg-secondary text-foreground border border-border", icon: XCircle },
  started: { color: "bg-foreground text-background", icon: Play },
  paused: { color: "bg-secondary text-foreground border border-border", icon: Pause },
  cancelled: { color: "bg-secondary text-foreground border border-border", icon: XCircle },
};

export default function EngagementOrders() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { formatPrice } = useCurrency();
  const [searchQuery, setSearchQuery] = useState("");
  const [refillOrderId, setRefillOrderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);

  const doAction = async (ids: string[], action: "pause" | "resume" | "delete") => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await runOrderAction(supabase, ids, action);
      const word = action === "pause" ? "paused" : action === "resume" ? "resumed" : "deleted";
      toast.success(`${res?.updated ?? ids.length} order(s) ${word}`);
      setSelected(new Set());
      await refetch();
    } catch (e: any) {
      toast.error(e?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };
  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Instant load with cache + moderate refresh
  const { data: orders, isLoading: ordersLoading, isFetching, refetch } = useQuery({
    queryKey: ['engagement-orders', user?.id],
    queryFn: async () => {
      if (!user) return [];
      return loadAllEngagementOrders(supabase, user.id, `
        id, order_number, order_name, curve_name, status, total_price, link, base_quantity,
        created_at, updated_at, completed_at, is_organic_mode,
        items:engagement_order_items(id, engagement_type, quantity, delivered_count, status,
          runs:organic_run_schedule(status, quantity_to_send, scheduled_at, provider_status, provider_remains, error_message))
      `);
    },
    enabled: !!user,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => query.state.data?.some((order: any) =>
      order.status === "pending" || order.status === "processing"
    ) ? 30000 : false,
    placeholderData: (previousOrders) => previousOrders,

  });

  // Filter orders based on search query
  const filteredOrders = useMemo(() => {
    if (!orders || !searchQuery.trim()) return orders;
    
    const query = searchQuery.toLowerCase().trim();
    return orders.filter(order => 
      order.order_name?.toLowerCase().includes(query) ||
      order.curve_name?.toLowerCase().includes(query) ||
      order.order_number?.toString().includes(query) ||
      order.link?.toLowerCase().includes(query)
    );
  }, [orders, searchQuery]);

  useEffect(() => {
    if (!user && !authLoading) navigate('/auth', { replace: true });
  }, [authLoading, navigate, user]);

  if (!user) {
    return null;
  }

  return (
    <DashboardLayout>
      <PageMeta title="Engagement Orders" description="Track your Boostly Pro engagement deliveries — live progress, per-type breakdown, and organic growth stats." canonicalPath="/engagement-orders" noIndex />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6 text-primary" /> Engagement Orders</h1>
            <p className="text-muted-foreground">Track your full engagement deliveries in real-time</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button onClick={() => navigate('/engagement-order')}>
              + New Order
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, curve, order number or Reel link..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Search Results Info */}
        {searchQuery && (
          <p className="text-sm text-muted-foreground">
            {filteredOrders?.length || 0} result{filteredOrders?.length !== 1 ? 's' : ''} found for "{searchQuery}"
          </p>
        )}

        {/* Orders List */}
        {ordersLoading ? (
          <div className="space-y-3" aria-label="Loading engagement orders">
            {[0, 1].map((index) => (
              <Card key={index} className="overflow-hidden">
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-6 w-24" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                    <Skeleton className="h-5 w-16" />
                  </div>
                  <Skeleton className="h-4 w-2/3 max-w-md" />
                  <div className="grid grid-cols-3 gap-3 pt-1">
                    <Skeleton className="h-10 rounded-lg" />
                    <Skeleton className="h-10 rounded-lg" />
                    <Skeleton className="h-10 rounded-lg" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : orders?.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground mb-4">No engagement orders yet</p>
            <Button onClick={() => navigate('/engagement-order')}>
              Place Your First Order
            </Button>
          </Card>
        ) : filteredOrders?.length === 0 ? (
          <Card className="p-12 text-center">
            <Search className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-muted-foreground mb-2">No orders found for "{searchQuery}"</p>
            <p className="text-sm text-muted-foreground mb-4">Try searching with order number or video link</p>
            <Button variant="outline" onClick={() => setSearchQuery("")}>
              Clear Search
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="glass-card p-3 flex flex-wrap items-center gap-2 sticky top-2 z-10">
              <Checkbox
                checked={!!filteredOrders?.length && selected.size === filteredOrders.length}
                onCheckedChange={(c) => setSelected(c ? new Set((filteredOrders ?? []).map((o: any) => o.id)) : new Set())}
              />
              <span className="text-sm text-muted-foreground mr-auto">
                {selected.size ? `${selected.size} selected` : "Select orders for bulk Pause / Resume / Delete"}
              </span>
              <Button size="sm" variant="outline" disabled={!selected.size || busy} onClick={() => doAction([...selected], "pause")}>
                <Pause className="h-4 w-4 mr-1" /> Pause
              </Button>
              <Button size="sm" variant="outline" disabled={!selected.size || busy} onClick={() => doAction([...selected], "resume")}>
                <Play className="h-4 w-4 mr-1" /> Resume
              </Button>
              <Button size="sm" variant="destructive" disabled={!selected.size || busy} onClick={() => setConfirmDelete([...selected])}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            </div>
            {filteredOrders?.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onClick={() => navigate(`/engagement-orders/${order.order_number}`)}
                onRefill={() => setRefillOrderId(order.id)}
                selected={selected.has(order.id)}
                onToggleSelect={() => toggleSelect(order.id)}
                busy={busy}
                onPause={() => doAction([order.id], "pause")}
                onResume={() => doAction([order.id], "resume")}
                onDelete={() => setConfirmDelete([order.id])}
              />
            ))}
          </div>
        )}
      </div>
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.length ?? 0} order(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              All runs not yet sent to providers will be stopped and the order(s) will be removed from this list. Runs already sent to a provider cannot be pulled back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { const ids = confirmDelete ?? []; setConfirmDelete(null); void doAction(ids, "delete"); }}
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RefillOrderDialog
        orderId={refillOrderId}
        open={!!refillOrderId}
        onOpenChange={(o) => { if (!o) setRefillOrderId(null); }}
        onDone={() => refetch()}
      />
    </DashboardLayout>
  );
}

function OrderCard({ order, onClick, onRefill, selected, onToggleSelect, busy, onPause, onResume, onDelete }: {
  order: any; onClick: () => void; onRefill?: () => void;
  selected?: boolean; onToggleSelect?: () => void; busy?: boolean;
  onPause?: () => void; onResume?: () => void; onDelete?: () => void;
}) {
  const { formatPrice } = useCurrency();
  // Calculate progress
  const allRuns = order.items?.flatMap((item: any) => item.runs || []) || [];
  const isTargetCompleteCancelMessage = (message: string) => (
    message.startsWith('target met') ||
    message.startsWith('target count reached') ||
    message.includes('target count reached') ||
    message.includes('target reached') ||
    message.includes('cancelling remaining runs') ||
    message.startsWith('delivery reserved') ||
    message.includes('already delivered') ||
    message.includes('auto-cancelled') ||
    message.includes('auto completed') ||
    message.includes('auto-completed') ||
    message.includes('item completed')
  );
  // Auto-cancelled-because-target-met runs should display as completed.
  const isAutoCompletedCancel = (r: any) => {
    const status = (r.status || '').toString().toLowerCase().trim();
    const message = (r.error_message || '').toString().toLowerCase().trim();
    if (status !== 'cancelled' && status !== 'canceled') return false;
    return isTargetCompleteCancelMessage(message);
  };
  const completedRuns = allRuns.filter((r: any) => r.status === 'completed' || isAutoCompletedCancel(r)).length;
  // Exclude user-cancelled runs from total — auto-completed ones still count.
  const effectiveRuns = allRuns.filter((r: any) => r.status !== 'cancelled' || isAutoCompletedCancel(r)).length;
  const totalRuns = effectiveRuns;

  // Calculate delivered using provider truth (matches Live Stats on detail page)
  const normalizeProviderStatus = (s: any): string => (s ?? '').toString().toLowerCase().trim();
  const calculateActualDelivered = (run: any): number => {
    const ps = normalizeProviderStatus(run.provider_status);
    if (
      (run.status === 'cancelled' || run.status === 'canceled') &&
      isTargetCompleteCancelMessage((run.error_message || '').toLowerCase())
    ) {
      return run.quantity_to_send;
    }
    if (ps === 'completed' || ps === 'complete') return run.quantity_to_send;
    if (run.provider_remains !== null && run.provider_remains !== undefined) {
      return Math.max(0, run.quantity_to_send - run.provider_remains);
    }
    if (run.status === 'completed') return run.quantity_to_send;
    return 0;
  };
  const totalDelivered = allRuns.reduce((sum: number, r: any) => sum + calculateActualDelivered(r), 0);

  const totalQuantity = order.items?.reduce((sum: number, item: any) => sum + item.quantity, 0) || 0;

  // Progress = delivery-based when target known, else runs-based
  const progressPercent = totalQuantity > 0
    ? Math.min(100, (totalDelivered / totalQuantity) * 100)
    : totalRuns > 0 ? (completedRuns / totalRuns) * 100 : 0;

  // Find next run
  const pendingRuns = allRuns
    .filter((r: any) => r.status === 'pending')
    .sort((a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  const nextRun = pendingRuns[0];

  // Active runs
  const activeRuns = allRuns.filter((r: any) => r.status === 'started').length;

  // Derive effective status: if provider delivered everything, treat as completed
  // regardless of stale DB status (real-time accuracy).
  let effectiveStatus = order.status as string;
  if (totalQuantity > 0 && totalDelivered >= totalQuantity) {
    effectiveStatus = 'completed';
  } else if (effectiveStatus !== 'cancelled' && effectiveStatus !== 'failed' && effectiveStatus !== 'paused') {
    if (activeRuns > 0 || pendingRuns.length > 0 || totalDelivered > 0) {
      effectiveStatus = 'processing';
    }
  }
  const StatusIcon = STATUS_CONFIG[effectiveStatus as keyof typeof STATUS_CONFIG]?.icon || Clock;
  const statusColor = STATUS_CONFIG[effectiveStatus as keyof typeof STATUS_CONFIG]?.color || "";

  return (
    <Card 
      className="glass-card overflow-hidden cursor-pointer hover:border-muted-foreground/50 transition-all"
      onClick={onClick}
    >
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {onToggleSelect && (
                <span onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={!!selected} onCheckedChange={() => onToggleSelect()} />
                </span>
              )}
              <CardTitle className="text-lg text-foreground break-words [overflow-wrap:anywhere]">{order.order_name || `Order #${order.order_number}`}</CardTitle>
              <Badge className={statusColor}>
                <StatusIcon className="h-3 w-3 mr-1" />
                {effectiveStatus === 'completed' ? 'Complete' : effectiveStatus === 'processing' ? 'Processing' : effectiveStatus}
              </Badge>
              {order.is_organic_mode && (
                <Badge variant="outline" className="border-border text-muted-foreground">
                  🌱 Organic
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-2 break-words">Curve: {order.curve_name || 'Not recorded (older order)'}</p>
            <a 
              href={order.link} 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors break-all"
            >
              {order.link.length > 50 ? order.link.slice(0, 50) + '...' : order.link}
              <ExternalLink className="h-3 w-3" />
            </a>
            {onRefill && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-8 px-3 text-xs gap-1.5"
                onClick={(e) => { e.stopPropagation(); onRefill(); }}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refill (same curve)
              </Button>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {(effectiveStatus === 'pending' || effectiveStatus === 'processing' || effectiveStatus === 'started') && onPause && (
                <Button variant="outline" size="sm" className="h-8 px-3 text-xs gap-1.5" disabled={busy} onClick={onPause}>
                  <Pause className="h-3.5 w-3.5" /> Pause
                </Button>
              )}
              {order.status === 'paused' && onResume && (
                <Button variant="outline" size="sm" className="h-8 px-3 text-xs gap-1.5" disabled={busy} onClick={onResume}>
                  <Play className="h-3.5 w-3.5" /> Resume
                </Button>
              )}
              {onDelete && (
                <Button variant="outline" size="sm" className="h-8 px-3 text-xs gap-1.5 text-destructive" disabled={busy} onClick={onDelete}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              )}

            </div>
          </div>
          <div className="text-right flex items-center gap-2">
            <div>
              <p className="font-semibold text-foreground">{formatPrice(order.total_price || 0)}</p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* Real-time Stats */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="p-3 bg-secondary rounded-xl border border-border">
            <Zap className="h-4 w-4 mx-auto mb-1 text-foreground" />
            <p className="text-sm font-bold text-foreground">{totalDelivered.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Delivered</p>
          </div>
          <div className="p-3 bg-secondary rounded-xl border border-border">
            <CheckCircle2 className="h-4 w-4 mx-auto mb-1 text-foreground" />
            <p className="text-sm font-bold text-foreground">{completedRuns}</p>
            <p className="text-[10px] text-muted-foreground">Complete</p>
          </div>
          <div className="p-3 bg-secondary rounded-xl border border-border">
            <Clock className="h-4 w-4 mx-auto mb-1 text-foreground" />
            <p className="text-sm font-bold text-foreground">{pendingRuns.length}</p>
            <p className="text-[10px] text-muted-foreground">Pending</p>
          </div>
          <div className="p-3 bg-secondary rounded-xl border border-border">
            <Play className="h-4 w-4 mx-auto mb-1 text-foreground" />
            <p className="text-sm font-bold text-foreground">{activeRuns}</p>
            <p className="text-[10px] text-muted-foreground">Active</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{completedRuns} / {totalRuns} runs</span>
            <span>{totalDelivered.toLocaleString()} / {totalQuantity.toLocaleString()}</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        {/* Next Run Timer */}
        {nextRun && (
          <div className="flex items-center gap-2 p-3 bg-secondary rounded-xl border border-border text-sm">
            <Timer className="h-4 w-4 text-foreground" />
            <span className="text-muted-foreground">Next run:</span>
            <strong className="text-foreground">{new Date(nextRun.scheduled_at).getTime() <= Date.now() ? 'due now' : istClock(nextRun.scheduled_at) + ' IST'}</strong>
            <span className="text-muted-foreground">
              {new Date(nextRun.scheduled_at).getTime() > Date.now() && `(${formatDistanceToNow(new Date(nextRun.scheduled_at), { addSuffix: true })})`}
            </span>
          </div>
        )}

        {/* Engagement Items */}
        <div className="flex flex-wrap gap-2">
          {order.items?.map((item: any) => {
            const Icon = ENGAGEMENT_ICONS[item.engagement_type as keyof typeof ENGAGEMENT_ICONS] || Eye;
            const itemRuns = item.runs || [];
            const itemCompleted = itemRuns.filter((r: any) => r.status === 'completed' || isAutoCompletedCancel(r)).length;
            const itemDelivered = itemRuns.reduce(
              (sum: number, r: any) => sum + calculateActualDelivered(r),
              0
            );

            return (
              <Badge 
                key={item.id}
                variant="secondary"
                className="flex items-center gap-1.5 py-1.5 px-3"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="capitalize">{item.engagement_type}:</span>
                <span className="font-mono">{itemDelivered.toLocaleString()}/{item.quantity.toLocaleString()}</span>
                <span className="text-muted-foreground">({itemCompleted}/{itemRuns.length})</span>
              </Badge>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}