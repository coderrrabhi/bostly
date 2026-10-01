import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageMeta } from "@/components/seo/PageMeta";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { api } from "@/lib/api";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  Eye,
  Heart,
  MessageCircle,
  Package,
  ShoppingCart,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

const statusColor: Record<string, string> = {
  completed: "#3b82f6",
  processing: "#3b82f6",
  pending: "#f59e0b",
  failed: "#ef4444",
  paused: "#f59e0b",
};

const typeIcon: Record<string, typeof Eye> = { views: Eye, likes: Heart, comments: MessageCircle };
const cardStyle = { background: "white", border: "1px solid rgba(0,0,0,.06)", boxShadow: "0 2px 12px rgba(0,0,0,.03)" };

export default function CoreDashboard() {
  const { user, profile } = useAuth();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["dashboard", user?.id],
    queryFn: api.getDashboard,
    enabled: Boolean(user),
  });

  const engagementOrders = data?.engagementOrders ?? [];
  const singleOrders = data?.recentOrders ?? [];
  const stats = data?.stats ?? {};
  const name = data?.profile?.fullName || profile?.fullName || profile?.full_name || "User";

  return (
    <DashboardLayout>
      <PageMeta title="Dashboard" description="Manage your social media growth orders." noIndex />
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-0.5 text-[12px] font-medium text-[#999]">
              Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"},
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight text-[#111827]" style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}>
              Account Dashboard
            </h1>
            <p className="mt-0.5 text-[13px] text-[#666]">{name}</p>
          </div>
          <button
            onClick={() => navigate("/engagement-order")}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 text-[12px] font-semibold text-white"
          >
            <Sparkles className="h-3.5 w-3.5" /> Full Engagement
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {[
            { icon: ShoppingCart, label: "Total Orders", value: stats.total_orders ?? 0, sub: `${stats.completed_orders ?? 0} completed`, accent: "#3b82f6" },
            { icon: Activity, label: "Active", value: stats.active_orders ?? 0, sub: "In progress", accent: "#f59e0b" },
            { icon: TrendingUp, label: "Total Spent", value: formatPrice(Number(stats.total_spent ?? 0)), sub: "All time", accent: "#2563EB" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl p-5" style={cardStyle}>
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${item.accent}12`, color: item.accent }}>
                <item.icon className="h-4 w-4" />
              </div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#aaa]">{item.label}</p>
              <p className="text-2xl font-extrabold tracking-tight text-[#111827]">{item.value}</p>
              <p className="mt-1 text-[11px] text-[#bbb]">{item.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <section className="overflow-hidden rounded-xl lg:col-span-3" style={cardStyle}>
            <div className="flex items-center justify-between border-b border-black/[.06] px-5 py-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#2563EB]" />
                <h2 className="text-[14px] font-bold text-[#111827]">Engagement Orders</h2>
              </div>
              <Link to="/orders" className="flex items-center text-[11px] font-medium text-[#2563EB]">
                View all <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {engagementOrders.length ? engagementOrders.slice(0, 4).map((order: any) => (
              <Link key={order.id} to="/orders" className="flex items-center justify-between border-b border-black/[.04] px-5 py-3.5 transition-colors hover:bg-[#EAF1FF]">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EAF1FF] font-mono text-[10px] text-[#888]">#{order.order_number}</div>
                  <div className="min-w-0">
                    <p className="max-w-[200px] truncate text-[13px] font-medium text-[#111827]">{order.link?.replace("https://", "") || "Engagement order"}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {order.items?.slice(0, 3).map((item: any, index: number) => {
                        const Icon = typeIcon[item.engagement_type] || Eye;
                        return <span key={index} className="flex items-center gap-0.5 text-[11px] text-[#999]"><Icon className="h-3 w-3" />{Number(item.quantity || 0).toLocaleString()}</span>;
                      })}
                    </div>
                  </div>
                </div>
                <span className="rounded-md px-2 py-1 text-[10px] font-semibold capitalize" style={{ background: `${statusColor[order.status] || "#999"}14`, color: statusColor[order.status] || "#999" }}>{order.status}</span>
              </Link>
            )) : <div className="px-5 py-12 text-center text-[13px] text-[#999]">No engagement orders yet</div>}
          </section>

          <section className="overflow-hidden rounded-xl lg:col-span-2" style={cardStyle}>
            <div className="flex items-center justify-between border-b border-black/[.06] px-5 py-4">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-[#888]" />
                <h2 className="text-[14px] font-bold text-[#111827]">Single Orders</h2>
              </div>
              <Link to="/orders" className="flex items-center text-[11px] font-medium text-[#2563EB]">View all <ChevronRight className="h-3 w-3" /></Link>
            </div>
            {singleOrders.length ? singleOrders.slice(0, 4).map((order: any) => (
              <div key={order.id} className="flex items-center justify-between border-b border-black/[.04] px-5 py-3.5">
                <div className="min-w-0">
                  <p className="max-w-[150px] truncate text-[13px] font-medium text-[#111827]">{order.service?.name || "Service"}</p>
                  <p className="mt-0.5 text-[11px] text-[#999]">{Number(order.quantity || 0).toLocaleString()} • {formatPrice(Number(order.price || 0))}</p>
                </div>
                <span className="text-[10px] font-semibold capitalize text-[#999]">{order.status}</span>
              </div>
            )) : <div className="px-5 py-12 text-center text-[13px] text-[#999]">No single orders yet</div>}
          </section>
        </div>

        <Link to="/engagement-order" className="group flex items-center gap-3.5 rounded-xl p-4 transition-all hover:-translate-y-0.5" style={cardStyle}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2563EB]/[.07] text-[#2563EB]"><Sparkles className="h-4.5 w-4.5" /></div>
          <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-[#111827]">Full Engagement</p><p className="text-[11px] text-[#999]">Views + Likes + Comments</p></div>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-[#ccc]" />
        </Link>
      </div>
    </DashboardLayout>
  );
}