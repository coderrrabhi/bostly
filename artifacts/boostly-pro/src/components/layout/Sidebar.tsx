import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Package, Settings, LifeBuoy, Shield, LogOut,
  Rocket, Sparkles, X, Server, Boxes, Brain, Send, Crown, ChevronRight, Loader2,
  Wallet
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';
import { preloadRoute, preloadSidebarRoutes } from '@/lib/routePreload';

interface SidebarProps { onClose?: () => void; }

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

export function Sidebar({ onClose }: SidebarProps) {
  const location = useLocation();
  const { isAdmin, signOut, profile, user } = useAuth();
  const displayName = profile?.full_name || profile?.fullName || profile?.email?.split('@')[0] || 'User';

  // Router navigations are transitions: while a page chunk or its data is
  // still arriving nothing on screen changes, which reads as an ignored click.
  // Highlight the tapped item at once and keep it lit until the route lands.
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  useEffect(() => { setPendingPath(null); }, [location.pathname]);
  // Safety net: never leave a spinner running for more than 2 s.
  useEffect(() => {
    if (!pendingPath) return;
    const t = window.setTimeout(() => setPendingPath(null), 2000);
    return () => window.clearTimeout(t);
  }, [pendingPath]);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const timeoutId = window.setTimeout(preloadSidebarRoutes, 800);
    const idleId = idleWindow.requestIdleCallback?.(preloadSidebarRoutes, { timeout: 1500 });

    return () => {
      window.clearTimeout(timeoutId);
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
    };
  }, []);

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
    const isPending = !isActive && pendingPath === item.path;

    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={() => {
          if (!isActive) setPendingPath(item.path);
          onClose?.();
        }}
        onMouseEnter={() => preloadRoute(item.path)}
        onFocus={() => preloadRoute(item.path)}
        onTouchStart={() => preloadRoute(item.path)}
        aria-busy={isPending || undefined}
        className={cn(
          "group flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 outline-none",
          isActive
            ? "bg-blue-600/10 text-[#141414] shadow-[inset_0_0_0_1px_rgba(37,99,235,0.25)]"
            : isPending
              ? "bg-[#F3F4F6] text-[#141414]"
              : "text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#141414]"
        )}
      >
        {isPending ? (
          <Loader2 className="w-[16px] h-[16px] shrink-0 animate-spin text-blue-600" strokeWidth={2.5} />
        ) : (
          <item.icon
            className={cn(
              "w-[16px] h-[16px] shrink-0 transition-colors",
              isActive ? "text-blue-600" : "text-[#6B7280] group-hover:text-[#141414]"
            )}
            strokeWidth={2.5}
          />
        )}
        <span className="flex-1 truncate">{item.label}</span>
        {item.tag && (
          <span
            className={cn(
              "text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ml-auto",
              item.tag === 'NEW'
                ? "bg-blue-600/10 text-blue-600 border border-blue-600/20"
                : "bg-amber-100/50 text-amber-700 border border-amber-200/60"
            )}
          >
            {item.tag}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="h-full w-full flex flex-col bg-white border-r border-[#141414]/10">
      
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-6 pb-5 shrink-0">
        <Link to="/" onClick={onClose} className="flex items-center gap-3 group outline-none">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden bg-[#141414] shadow-[0_4px_12px_-4px_rgba(20,20,20,0.5)] transition-transform group-hover:scale-105">
            <img src={logo} alt="Boostly Pro" className="w-full h-full object-cover" />
          </div>
          <div className="flex flex-col leading-none justify-center">
            <span className="text-[15px] font-black tracking-tight text-[#141414] mb-1">
              boostly<span className="text-blue-600">.</span>pro
            </span>
            <span className="text-[8.5px] font-bold tracking-[0.22em] text-blue-600 uppercase">
              Luxury Edition
            </span>
          </div>
        </Link>
        <button
          onClick={onClose}
          aria-label="Close sidebar"
          className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg text-[#141414] bg-[#141414]/5 hover:bg-[#141414]/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Nav */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 scrollbar-thin flex flex-col gap-6">
        
        {/* User Identity */}
        {profile && (
          <div className="flex items-center gap-3 p-2.5 rounded-xl border border-[#141414]/5 bg-[#F9FAFB] hover:bg-[#F3F4F6] hover:border-[#141414]/10 transition-all group shrink-0 cursor-default">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[13px] font-black text-white shrink-0 bg-gradient-to-br from-blue-600 to-blue-500 shadow-sm">
              {displayName[0]?.toUpperCase() || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold truncate text-[#141414] leading-tight mb-0.5">{displayName}</p>
              <p className="text-[11px] truncate text-[#6B7280] font-medium leading-tight">{profile.email}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-[#6B7280] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </div>
        )}

        {/* Main Menu */}
        <nav className="flex flex-col gap-0.5">
          <p className="px-3 mb-2 text-[10px] font-bold tracking-[0.15em] text-[#6B7280]/80 uppercase">Main Menu</p>
          {menuItems.map(renderItem)}
        </nav>

        {/* Provider Section */}
        <nav className="flex flex-col gap-0.5">
          <p className="px-3 mb-2 text-[10px] font-bold tracking-[0.15em] text-[#6B7280]/80 uppercase">My Provider</p>
          {providerItems.map(renderItem)}
          
          {providerStats && providerStats.count > 0 && (
            <div className="mx-2 mt-3 p-3.5 rounded-xl border border-[#141414]/5 bg-gradient-to-b from-[#F9FAFB] to-white shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9.5px] font-bold tracking-[0.15em] text-[#6B7280] uppercase">Balance</p>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-slow shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <p className="text-xl font-black tracking-tight text-[#141414]">
                  ${providerStats.totalUsd.toFixed(2)}
                </p>
                <span className="text-[10px] font-bold text-[#6B7280]">USD</span>
              </div>
              <p className="text-[10.5px] font-semibold mt-1.5 text-[#6B7280] flex items-center gap-1.5">
                <Wallet className="w-3 h-3 text-[#141414]/40" />
                {providerStats.active}/{providerStats.count} panels active
              </p>
            </div>
          )}
        </nav>

        {/* Admin Section */}
        {isAdmin && (
          <nav className="flex flex-col gap-0.5">
            <p className="px-3 mb-2 text-[10px] font-bold tracking-[0.15em] text-[#6B7280]/80 uppercase">Admin</p>
            {adminNavItems.map(renderItem)}
          </nav>
        )}
      </div>

      {/* Fixed Footer */}
      <div className="p-4 border-t border-[#141414]/5 bg-[#FAFAFA] flex flex-col gap-2.5 shrink-0">
        <a
          href="https://t.me/whopcampaign"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl text-[12px] font-bold text-white transition-all shadow-[0_4px_12px_-4px_rgba(20,20,20,0.4)] hover:shadow-[0_6px_16px_-4px_rgba(20,20,20,0.5)] hover:-translate-y-[1px] bg-[#141414]"
        >
          <Send className="w-3.5 h-3.5 text-blue-500" strokeWidth={3} />
          <span className="tracking-[0.12em] uppercase">Join Telegram</span>
        </a>

        <button
          onClick={() => signOut()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold text-[#6B7280] hover:text-[#141414] hover:bg-[#F3F4F6] transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" strokeWidth={2.5} />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}
