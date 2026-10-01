import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Leaf,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { PageMeta } from "@/components/seo/PageMeta";

const statusFilters = ["All", "pending", "processing", "completed", "partial", "failed", "cancelled"];

type ApiOrder = Record<string, unknown>;

const value = (order: ApiOrder, snake: string, camel: string) => order[snake] ?? order[camel];
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : value == null ? fallback : String(value);
const number = (value: unknown) => Number(value ?? 0) || 0;

function serviceFor(order: ApiOrder) {
  const service = order.service;
  return service && typeof service === "object" ? service as Record<string, unknown> : null;
}

export default function CoreOrders() {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // The authenticated API is the current Clerk-backed source of order data.
  const { data: orders = [], refetch } = useQuery<ApiOrder[]>({
    queryKey: ["orders", user?.id],
    queryFn: api.getOrders,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.data?.some((order) => {
        const status = text(order.status).toLowerCase();
        return status === "pending" || status === "processing";
      }) ? 30_000 : false,
  });

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const filteredOrders = useMemo(() => {
    const normalizedSearch = searchQuery.toLowerCase();
    return orders.filter((order) => {
      const service = serviceFor(order);
      const orderNumber = text(value(order, "order_number", "orderNumber"), text(order.id));
      const link = text(order.link);
      const serviceName = text(service?.name);
      return (
        (orderNumber.includes(searchQuery) ||
          link.toLowerCase().includes(normalizedSearch) ||
          serviceName.toLowerCase().includes(normalizedSearch)) &&
        (statusFilter === "All" || text(order.status).toLowerCase() === statusFilter)
      );
    });
  }, [orders, searchQuery, statusFilter]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-success/20 text-success border-success/30";
      case "processing": return "bg-warning/20 text-warning border-warning/30";
      case "pending": return "bg-muted text-muted-foreground border-muted";
      case "partial": return "bg-primary/20 text-primary border-primary/30";
      case "failed": return "bg-destructive/20 text-destructive border-destructive/30";
      default: return "bg-muted text-muted-foreground border-muted";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle2 className="h-4 w-4 text-success" />;
      case "processing": return <Loader2 className="h-4 w-4 text-warning animate-spin" />;
      case "failed": return <AlertCircle className="h-4 w-4 text-destructive" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const hasProcessingOrders = orders.some((order) => ["pending", "processing"].includes(text(order.status).toLowerCase()));

  return (
    <DashboardLayout>
      <PageMeta title="Your Orders" description="View and manage your Boostly Pro social media orders — track delivery, refills, and status in real-time." canonicalPath="/orders" noIndex />
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Orders</h1>
            <p className="text-muted-foreground">Track and manage your orders.</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={isRefreshing} className="gap-2" data-testid="button-refresh-orders">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {hasProcessingOrders && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/30 px-4 py-2 rounded-lg" data-testid="status-orders-auto-refresh">
            <Loader2 className="h-4 w-4 animate-spin text-warning" />
            <span>Auto-refreshing every 30 seconds while orders are processing...</span>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by order #, link, or service..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="pl-10 input-glass" data-testid="input-search-orders" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {statusFilters.map((status) => (
              <button key={status} onClick={() => setStatusFilter(status)} data-testid={`button-filter-orders-${status}`} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${statusFilter === status ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {filteredOrders.length > 0 ? (
          <div className="space-y-4">
            {filteredOrders.map((order) => {
              const id = text(order.id);
              const service = serviceFor(order);
              const status = text(order.status, "pending").toLowerCase();
              const organic = Boolean(value(order, "is_organic_mode", "isOrganicMode"));
              const providerOrderId = Boolean(value(order, "provider_order_id", "providerOrderId"));
              const targetCount = number(value(order, "target_count", "targetCount"));
              const startCount = number(value(order, "start_count", "startCount"));
              const currentCount = number(value(order, "current_count", "currentCount") ?? startCount);
              const remainingCount = number(value(order, "remaining_count", "remainingCount") ?? value(order, "remains", "remains"));
              const percentage = number(value(order, "progress_percentage", "progressPercentage"));
              const isExpanded = expandedOrder === id;
              return (
                <div key={id} className="glass-card overflow-hidden" data-testid={`card-order-${id}`}>
                  <div className="p-6 cursor-pointer hover:bg-secondary/20 transition-colors" onClick={() => setExpandedOrder(isExpanded ? null : id)} data-testid={`button-expand-order-${id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                          <span className="text-sm font-mono text-primary">#{text(value(order, "order_number", "orderNumber"), id.slice(0, 8))}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{text(service?.name, "Unknown Service")}</h3>
                            {organic && <span className="flex items-center gap-1 text-xs text-success bg-success/20 px-2 py-0.5 rounded-full"><Leaf className="h-3 w-3" />Organic</span>}
                          </div>
                          <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <span className="truncate max-w-[300px]">{text(order.link)}</span><ExternalLink className="h-3 w-3 shrink-0" />
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right"><p className="font-semibold">{number(order.quantity).toLocaleString()}</p><p className="text-sm text-muted-foreground">{formatPrice(number(order.price))}</p></div>
                        <div className="flex items-center gap-2">{getStatusIcon(status)}<span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(status)}`} data-testid={`status-order-${id}`}>{status}</span></div>
                        {organic && (isExpanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />)}
                      </div>
                    </div>

                    {organic && status === "processing" && !isExpanded && <div className="mt-4 pt-4 border-t border-border/50"><div className="flex items-center gap-4"><Loader2 className="h-4 w-4 text-warning animate-spin" /><div className="flex-1"><Progress value={30} className="h-2" /></div><span className="text-xs text-muted-foreground">Processing...</span></div></div>}

                    {!organic && providerOrderId && targetCount > 0 && <div className="mt-4 pt-4 border-t border-border/50">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
                        {[["Starting", startCount], ["Current", currentCount], ["Target", targetCount], ["Remaining", Math.max(0, remainingCount)]].map(([label, count]) => <div key={String(label)}><p className="text-muted-foreground">{label}</p><p className="font-semibold">{number(count).toLocaleString()}</p></div>)}
                      </div>
                      <div className="flex items-center gap-3"><Progress value={Math.min(100, percentage)} className="h-2 flex-1" /><span className="text-xs font-medium text-muted-foreground w-14 text-right">{percentage.toFixed(1)}%</span></div>
                      {Boolean(value(order, "last_synced_at", "lastSyncedAt")) && <p className="text-[10px] text-muted-foreground mt-1">Last sync: {new Date(text(value(order, "last_synced_at", "lastSyncedAt"))).toLocaleTimeString()}</p>}
                    </div>}
                    {Boolean(value(order, "error_message", "errorMessage")) && <div className="mt-3 p-2 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive">{text(value(order, "error_message", "errorMessage"))}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-card p-12 text-center" data-testid="status-no-orders">
            <p className="text-muted-foreground mb-4">No orders found</p>
            <Button variant="gradient" asChild><a href="/engagement-order" data-testid="link-place-first-order">Place Your First Order</a></Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}