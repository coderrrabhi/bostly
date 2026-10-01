import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { WhatsAppFloatingButton } from '@/components/chat/WhatsAppFloatingButton';
import { PopupAdDialog } from '@/components/PopupAdDialog';

interface DashboardLayoutProps { children: ReactNode; }

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !user) navigate('/auth');
  }, [user, isLoading, navigate]);

  if (isLoading || !user) {
    return <div className="min-h-screen bg-background" aria-busy="true" />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 w-[260px] hidden md:block border-r border-border">
        <Sidebar />
      </aside>
      <MobileBottomNav />
      <main className="md:pl-[260px] w-full min-w-0">
        <div className="min-h-screen pt-16 md:pt-0 px-3 sm:px-4 py-4 sm:py-5 lg:p-8 min-w-0">
          <div className="max-w-7xl mx-auto w-full">{children}</div>
        </div>
      </main>
      <WhatsAppFloatingButton />
      <PopupAdDialog />
    </div>
  );
}
