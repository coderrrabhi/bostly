import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { useCurrency } from '@/hooks/useCurrency';
import { api } from '@/lib/api';
import { Wallet, ShoppingCart, TrendingUp, Activity, Sparkles, Package, ChevronRight, Zap, Eye, Heart, MessageCircle, BarChart3, ArrowUpRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PageMeta } from '@/components/seo/PageMeta';
import { Badge } from '@/components/ui/badge';

export default function Dashboard() {
  const { user, wallet, profile } = useAuth();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard', user?.id],
    queryFn: api.getDashboard,
    enabled: !!user?.id,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
  const recentOrders = dashboard?.recentOrders ?? [];
  const engagementOrders = dashboard?.engagementOrders ?? [];
  const stats = {
    totalOrders: dashboard?.stats?.total_orders ?? 0,
    completedOrders: dashboard?.stats?.completed_orders ?? 0,
    activeOrders: dashboard?.stats?.active_orders ?? 0,
    totalSpent: Number(dashboard?.stats?.total_spent ?? 0),
  };

  const statusColor: Record<string, string> = {
    completed: '#3b82f6', processing: '#3b82f6', pending: '#f59e0b', failed: '#ef4444', paused: '#f59e0b',
  };

  const typeIcon: Record<string, any> = { views: Eye, likes: Heart, comments: MessageCircle };

  const cardStyle = { background: 'white', border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.03)' };

  return (
    <DashboardLayout>
      <PageMeta title="Dashboard" description="Manage your social media growth orders." noIndex />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[12px] font-medium mb-0.5" style={{ color: '#999' }}>
              Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'},
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: '#111827', fontFamily: "'Outfit', system-ui, sans-serif" }}>
              Account Dashboard
            </h1>
            <p className="text-[13px] mt-0.5" style={{ color: '#666' }}>
              {profile?.full_name || 'User'}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => navigate('/engagement-order')} className="h-10 px-4 rounded-lg text-[12px] font-semibold flex items-center gap-1.5" style={{ border: '1px solid rgba(0,0,0,.08)', color: '#555' }}>
              <Sparkles className="w-3.5 h-3.5" style={{ color: '#2563EB' }} /> Engagement
            </button>
            <button onClick={() => navigate('/order')} className="h-10 px-4 rounded-lg text-[12px] font-semibold text-white flex items-center gap-1.5" style={{ background: '#2563EB' }}>
              <Zap className="w-3.5 h-3.5" /> New Order
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: ShoppingCart, label: 'Total Orders', value: stats?.totalOrders || 0, sub: `${stats?.completedOrders || 0} completed`, accent: '#3b82f6' },
            { icon: Activity, label: 'Active', value: stats?.activeOrders || 0, sub: 'In progress', accent: '#f59e0b' },
            { icon: TrendingUp, label: 'Total Spent', value: formatPrice(stats?.totalSpent || 0), sub: 'All time', accent: '#2563EB' },
          ].map((s, i) => (
            <div key={i} className="rounded-xl p-5" style={cardStyle}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: s.accent + '12', color: s.accent }}>
                <s.icon className="w-4 h-4" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#aaa' }}>{s.label}</p>
              <p className="text-2xl font-extrabold tracking-tight" style={{ color: '#111827' }}>{s.value}</p>
              <p className="text-[11px] mt-1" style={{ color: '#bbb' }}>{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Orders */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 rounded-xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,.06)' }}>
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" style={{ color: '#2563EB' }} />
                <h2 className="text-[14px] font-bold" style={{ color: '#111827' }}>Engagement Orders</h2>
              </div>
              <Link to="/engagement-orders" className="text-[11px] font-medium flex items-center gap-0.5" style={{ color: '#2563EB' }}>
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div>
              {engagementOrders && engagementOrders.length > 0 ? engagementOrders.slice(0, 4).map((order: any) => (
                <Link key={order.id} to={`/engagement-orders/${order.order_number}`}
                  className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-[#EAF1FF]"
                  style={{ borderBottom: '1px solid rgba(0,0,0,.04)' }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-mono" style={{ background: '#EAF1FF', color: '#888' }}>#{order.order_number}</div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate max-w-[200px]" style={{ color: '#111827' }}>{order.link?.replace('https://', '').slice(0, 35)}...</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {order.items?.slice(0, 3).map((item: any, idx: number) => {
                          const Icon = typeIcon[item.engagement_type] || Eye;
                          return <span key={idx} className="text-[11px] flex items-center gap-0.5" style={{ color: '#999' }}><Icon className="w-3 h-3" />{item.quantity?.toLocaleString()}</span>;
                        })}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-1 rounded-md" style={{ background: (statusColor[order.status] || '#999') + '14', color: statusColor[order.status] || '#999' }}>{order.status}</span>
                </Link>
              )) : (
                <div className="px-5 py-12 text-center">
                  <p className="text-[13px] mb-3" style={{ color: '#999' }}>No engagement orders yet</p>
                  <button onClick={() => navigate('/engagement-order')} className="text-[12px] font-semibold px-4 py-2 rounded-lg text-white" style={{ background: '#2563EB' }}>Create First Order</button>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,.06)' }}>
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4" style={{ color: '#888' }} />
                <h2 className="text-[14px] font-bold" style={{ color: '#111827' }}>Single Orders</h2>
              </div>
              <Link to="/orders" className="text-[11px] font-medium flex items-center gap-0.5" style={{ color: '#2563EB' }}>
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div>
              {recentOrders && recentOrders.length > 0 ? recentOrders.slice(0, 4).map((order: any) => (
                <div key={order.id} className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(0,0,0,.04)' }}>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate max-w-[150px]" style={{ color: '#111827' }}>{order.service?.name || 'Service'}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: '#999' }}>{order.quantity?.toLocaleString()} • {formatPrice(Number(order.price))}</p>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-1 rounded-md" style={{ background: (statusColor[order.status] || '#999') + '14', color: statusColor[order.status] || '#999' }}>{order.status}</span>
                </div>
              )) : (
                <div className="px-5 py-12 text-center">
                  <p className="text-[13px] mb-3" style={{ color: '#999' }}>No orders yet</p>
                  <button onClick={() => navigate('/order')} className="text-[12px] font-semibold px-4 py-2 rounded-lg text-white" style={{ background: '#2563EB' }}>Place Order</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: Sparkles, label: 'Full Engagement', desc: 'Views + Likes + Comments', path: '/engagement-order', accent: '#2563EB' },
          ].map((a, i) => (
            <Link key={i} to={a.path} className="group flex items-center gap-3.5 p-4 rounded-xl transition-all hover:-translate-y-0.5" style={cardStyle}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: a.accent + '12', color: a.accent }}>
                <a.icon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold" style={{ color: '#111827' }}>{a.label}</p>
                <p className="text-[11px]" style={{ color: '#999' }}>{a.desc}</p>
              </div>
              <ArrowUpRight className="w-4 h-4 shrink-0" style={{ color: '#ccc' }} />
            </Link>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
