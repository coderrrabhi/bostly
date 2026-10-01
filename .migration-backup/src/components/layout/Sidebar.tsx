import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, ListOrdered, Settings, LifeBuoy, Shield, LogOut,
  Rocket, Sparkles, X, Server, Boxes, Brain, Send, Crown
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';

interface SidebarProps { onClose?: () => void; }

// Clean light palette
const C = {
  navy:  '#141414',
  pink:  '#2563EB',
  pink2: '#3B82F6',
  white: '#FFFFFF',
  cream: '#F3F4F6',
  ink:   '#6B7280',
  line:  'rgba(17,24,39,0.10)',
};

const menuItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Rocket, label: 'Full Engagement', path: '/engagement-order', tag: 'NEW' },
  { icon: Boxes, label: 'Mass Order', path: '/mass-order', tag: 'NEW' },
  { icon: Brain, label: 'AI Intelligence', path: '/ai-intelligence' },
  { icon: Sparkles, label: 'Engagement Orders', path: '/engagement-orders' },
  { icon: Crown, label: 'Subscription', path: '/subscription', tag: 'PRO' },
  { icon: LifeBuoy, label: 'Support', path: '/support' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

const providerItems = [
  { icon: Server, label: 'My Providers', path: '/my-providers', tag: 'PRO' },
  { icon: Package, label: 'My Bundles', path: '/my-bundles', tag: 'PRO' },
];

const adminNavItems = [{ icon: Shield, label: 'Admin Panel', path: '/admin' }];
const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function Sidebar({ onClose }: SidebarProps) {
  const location = useLocation();
  const { isAdmin, signOut, profile, user } = useAuth();
  const displayName = profile?.full_name || profile?.fullName || profile?.email?.split('@')[0] || 'User';

  const { data: providerStats } = useQuery({
    queryKey: ['sidebar-provider-balance', user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('user_provider_accounts_safe')
        .select('balance_cached, balance_currency, is_active');
      const rows = (data || []) as any[];
      const INR_PER_USD = 90;
      let totalUsd = 0;
      for (const r of rows) {
        const cur = (r.balance_currency || 'USD').toUpperCase();
        const amt = Number(r.balance_cached) || 0;
        totalUsd += cur === 'INR' ? amt / INR_PER_USD : amt;
      }
      return {
        count: rows.length,
        active: rows.filter(r => r.is_active).length,
        totalUsd,
      };
    },
  });



  const renderItem = (item: any) => {
    const isActive = location.pathname === item.path
      || (item.path !== '/dashboard' && location.pathname.startsWith(item.path + '/'));
    return (
      <a
        key={item.path}
        href={`${appBasePath}${item.path}`}
        onClick={() => onClose?.()}
        className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-semibold mb-1 transition-all"
        style={
          isActive
            ? { background: 'rgba(29,92,255,0.10)', color: C.navy, boxShadow: `inset 0 0 0 1px rgba(29,92,255,0.35)` }
            : { color: C.ink }
        }
      >
        <item.icon
          className="w-[18px] h-[18px] shrink-0"
          style={{ color: isActive ? C.pink : C.navy, opacity: isActive ? 1 : 0.75 }}
          strokeWidth={2.2}
        />
        <span className="flex-1 truncate" style={{ color: isActive ? C.navy : undefined }}>{item.label}</span>
        {item.tag && (
          <span
            className="text-[9.5px] font-black px-1.5 py-0.5 rounded tracking-wider"
            style={
              item.tag === 'NEW'
                ? { background: 'rgba(29,92,255,0.10)', color: C.pink, border: `1px solid ${C.pink}55` }
                : { background: C.cream, color: '#B4741A', border: `1px solid #E9BE7A` }
            }
          >{item.tag}</span>
        )}
      </a>
    );
  };

  return (
    <div className="h-full w-full overflow-hidden flex flex-col" style={{ background: C.white }}>
      {/* Brand */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <Link to="/" className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center overflow-hidden"
            style={{ background: C.navy, boxShadow: '0 8px 20px -8px rgba(14,27,77,0.45)' }}
          >
            <img src={logo} alt="Boostly Pro logo" className="w-full h-full object-cover" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-black tracking-tight" style={{ color: C.navy }}>
              boostly<span style={{ color: C.pink }}>.</span>pro
            </span>
            <span className="text-[9.5px] font-bold tracking-[0.16em]" style={{ color: C.pink }}>LUXURY EDITION</span>
          </div>
        </Link>
        <button
          onClick={onClose}
          aria-label="Close sidebar"
          className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg"
          style={{ color: C.navy, background: 'rgba(14,27,77,0.06)' }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* User row */}
      {profile && (
        <div
          className="mx-4 mb-4 flex items-center gap-3 px-3 py-2.5 rounded-2xl"
          style={{ background: C.cream, border: `1px solid ${C.line}` }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-[13px] font-black text-white shrink-0"
            style={{ background: `linear-gradient(135deg, ${C.pink}, ${C.pink2})` }}
          >
            {displayName[0]?.toUpperCase() || 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold truncate" style={{ color: C.navy }}>{displayName}</p>
            <p className="text-[10.5px] truncate" style={{ color: C.ink }}>{profile.email}</p>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
        <p className="px-3 mb-2 text-[9.5px] font-black tracking-[0.18em]" style={{ color: C.pink }}>:MENU</p>
        {menuItems.map(i => renderItem(i))}

        <div className="my-4 h-px" style={{ background: C.line }} />
        <p className="px-3 mb-2 text-[9.5px] font-black tracking-[0.18em]" style={{ color: C.pink }}>:MY PROVIDER</p>
        {providerItems.map(i => renderItem(i))}

        {providerStats && providerStats.count > 0 && (
          <div
            className="mx-1 mt-3 mb-1 p-3 rounded-2xl"
            style={{ background: C.cream, border: `1px solid ${C.line}` }}
          >
            <p className="text-[9px] font-black tracking-[0.18em] mb-1" style={{ color: C.pink }}>:PROVIDER BALANCE</p>
            <p className="text-[17px] font-black tracking-tight" style={{ color: C.navy }}>
              {providerStats.totalUsd.toFixed(2)} <span className="text-[10px] font-bold" style={{ color: C.ink }}>USD</span>
            </p>
            <p className="text-[10px] font-semibold mt-0.5" style={{ color: C.ink }}>{providerStats.active}/{providerStats.count} panels active</p>

          </div>

        )}

        {isAdmin && (
          <>
            <div className="my-4 h-px" style={{ background: C.line }} />
            <p className="px-3 mb-2 text-[9.5px] font-black tracking-[0.18em]" style={{ color: C.pink }}>:ADMIN</p>
            {adminNavItems.map(item => {
              const isActive = location.pathname.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-semibold mb-1"
                  style={
                    isActive
                      ? { background: 'rgba(29,92,255,0.10)', color: C.navy, boxShadow: `inset 0 0 0 1px rgba(29,92,255,0.35)` }
                      : { color: C.ink }
                  }
                >
                  <item.icon className="w-[18px] h-[18px]" style={{ color: isActive ? C.pink : C.navy }} strokeWidth={2.2} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* Telegram */}
      <div className="px-3 pb-2">
        <a
          href="https://t.me/whopcampaign"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-[12.5px] font-bold transition-transform hover:-translate-y-[1px]"
          style={{ background: C.navy, color: C.white, boxShadow: '0 10px 24px -12px rgba(14,27,77,0.55)' }}
        >
          <Send className="w-4 h-4" style={{ color: C.pink2 }} />
          <span className="tracking-[0.14em]">:JOIN TELEGRAM</span>
        </a>
      </div>

      {/* Sign out */}
      <div className="p-3" style={{ borderTop: `1px solid ${C.line}` }}>
        <button
          onClick={() => signOut()}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12.5px] font-semibold transition-colors"
          style={{ color: C.ink }}
          onMouseEnter={(e) => { e.currentTarget.style.color = C.pink; e.currentTarget.style.background = 'rgba(29,92,255,0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.ink; e.currentTarget.style.background = 'transparent'; }}
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}
