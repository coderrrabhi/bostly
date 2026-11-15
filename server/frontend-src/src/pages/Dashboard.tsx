import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { Activity, Sparkles, ChevronRight, Zap, ShoppingCart, CheckCircle2, Pause, RefreshCw, BarChart3, ArrowUpRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PageMeta } from '@/components/seo/PageMeta';
import { DashboardEngagementOrders, useDashboardEngagementOrders } from '@/components/engagement/DashboardEngagementOrders';
import { dashboardOrderCounts } from '@/lib/engagement-order-management';

export default function Dashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { data: orders = [], isLoading } = useDashboardEngagementOrders(user?.id);
  const counts = dashboardOrderCounts(orders);

  const cardStyle = { background: 'white', border: '1px solid rgba(15,23,42,.08)', boxShadow: '0 8px 28px rgba(15,23,42,.055)' };
  const stats = [
    { icon: ShoppingCart, label: 'Total Orders', value: counts.total, sub: 'Live Reel links', accent: '#2563EB', soft: '#EFF6FF' },
    { icon: Activity, label: 'Processing', value: counts.processing, sub: 'Runs in progress', accent: '#0284C7', soft: '#F0F9FF' },
    { icon: CheckCircle2, label: 'Complete', value: counts.completed, sub: 'Delivered Reels', accent: '#059669', soft: '#ECFDF5' },
    { icon: Pause, label: 'Paused', value: counts.paused, sub: 'Resume anytime', accent: '#D97706', soft: '#FFFBEB' },
    { icon: RefreshCw, label: 'Refill', value: counts.refill, sub: 'Refill orders', accent: '#7C3AED', soft: '#F5F3FF' },
  ];

  return (
    <DashboardLayout>
      <PageMeta title="Dashboard" description="Manage your social media growth orders." noIndex />
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[12px] font-medium mb-0.5" style={{ color: '#94A3B8' }}>
              Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'},
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: '#0F172A', fontFamily: "'Outfit', system-ui, sans-serif" }}>
              Account Dashboard
            </h1>
            <p className="text-[13px] mt-0.5" style={{ color: '#64748B' }}>{profile?.full_name || 'User'}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => navigate('/engagement-order')} className="h-10 px-4 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 bg-white" style={{ border: '1px solid #E2E8F0', color: '#475569' }}>
              <Sparkles className="w-3.5 h-3.5" style={{ color: '#2563EB' }} /> Engagement
            </button>
            <button onClick={() => navigate('/order')} className="h-10 px-4 rounded-xl text-[12px] font-semibold text-white flex items-center gap-1.5 shadow-sm" style={{ background: '#2563EB' }}>
              <Zap className="w-3.5 h-3.5" /> New Order
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-2xl p-4 sm:p-5" style={{ ...cardStyle, borderTop: `3px solid ${stat.accent}` }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: stat.soft, color: stat.accent }}>
                <stat.icon className="w-4 h-4" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#64748B' }}>{stat.label}</p>
              <p className="text-2xl font-extrabold tracking-tight tabular-nums" style={{ color: '#0F172A' }}>{isLoading ? '…' : stat.value}</p>
              <p className="text-[11px] mt-1" style={{ color: '#94A3B8' }}>{stat.sub}</p>
            </div>
          ))}
        </div>

        <section className="rounded-2xl overflow-hidden" style={cardStyle}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #EEF2F7', background: 'linear-gradient(135deg,#FFFFFF 0%,#F8FAFC 100%)' }}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#EFF6FF', color: '#2563EB' }}>
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-[15px] font-bold" style={{ color: '#0F172A' }}>Engagement Orders</h2>
                <p className="text-[11px]" style={{ color: '#94A3B8' }}>Every live Reel, its curve and delivery controls</p>
              </div>
            </div>
            <Link to="/engagement-orders" className="text-[11px] font-semibold flex items-center gap-0.5" style={{ color: '#2563EB' }}>
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <DashboardEngagementOrders userId={user?.id} />
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link to="/engagement-order" className="group flex items-center gap-3.5 p-4 rounded-2xl transition-all hover:-translate-y-0.5" style={cardStyle}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#EFF6FF', color: '#2563EB' }}>
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: '#0F172A' }}>Full Engagement</p>
              <p className="text-[11px]" style={{ color: '#94A3B8' }}>Views + Likes + Comments</p>
            </div>
            <ArrowUpRight className="w-4 h-4 shrink-0" style={{ color: '#CBD5E1' }} />
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}
