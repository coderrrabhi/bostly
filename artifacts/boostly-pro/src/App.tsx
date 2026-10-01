import { useEffect, lazy, Suspense, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { CurrencyProvider } from "@/hooks/useCurrency";
import { ScrollToTop } from "@/components/ScrollToTop";
import { toast } from "sonner";
import { AppErrorBoundary } from "@/components/app/AppErrorBoundary";
import { Loader2 } from "lucide-react";
import { routeLoaders } from "@/lib/routePreload";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Landing eager (LCP) — everything else lazy for smaller initial bundle
import Index from "./pages/Index";

const SmmPanelUsa = lazy(() => import("./pages/SmmPanelUsa"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(routeLoaders["/dashboard"] as () => Promise<{ default: React.ComponentType }>);
const Orders = lazy(() => import("./pages/Orders"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Settings = lazy(() => import("./pages/Settings"));
const Support = lazy(() => import("./pages/Support"));
const Maintenance = lazy(() => import("./pages/Maintenance"));
const EngagementOrder = lazy(routeLoaders["/engagement-order"] as () => Promise<{ default: React.ComponentType }>);
const EngagementOrders = lazy(routeLoaders["/engagement-orders"] as () => Promise<{ default: React.ComponentType }>);
const EngagementOrderDetail = lazy(() => import("./pages/EngagementOrderDetail"));
const ApiAccess = lazy(() => import("./pages/ApiAccess"));
const MyProviders = lazy(routeLoaders["/my-providers"] as () => Promise<{ default: React.ComponentType }>);
const MyServices = lazy(() => import("./pages/MyServices"));
const MyBundles = lazy(routeLoaders["/my-bundles"] as () => Promise<{ default: React.ComponentType }>);
const MassOrder = lazy(routeLoaders["/mass-order"] as () => Promise<{ default: React.ComponentType }>);
const AIIntelligence = lazy(routeLoaders["/ai-intelligence"] as () => Promise<{ default: React.ComponentType }>);
const Subscription = lazy(routeLoaders["/subscription"] as () => Promise<{ default: React.ComponentType }>);
const Admin = lazy(routeLoaders["/admin"] as () => Promise<{ default: React.ComponentType }>);
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminBundles = lazy(() => import("./pages/admin/AdminBundles"));
const AdminCronMonitor = lazy(() => import("./pages/admin/AdminCronMonitor"));
const AdminDeposits = lazy(() => import("./pages/admin/AdminDeposits"));
const AdminProviderAccounts = lazy(() => import("./pages/admin/AdminProviderAccounts"));
const AdminServiceProviderMapping = lazy(() => import("./pages/admin/AdminServiceProviderMapping"));
const AdminAuditLog = lazy(() => import("./pages/admin/AdminAuditLog"));
const AdminOxaPayEvents = lazy(() => import("./pages/admin/AdminOxaPayEvents"));
const AdminPopupAd = lazy(() => import("./pages/admin/AdminPopupAd"));
const AdminTopupPlan = lazy(() => import("./pages/admin/AdminTopupPlan"));
const AdminSubscriptions = lazy(() => import("./pages/admin/AdminSubscriptions"));
const AdminServices = lazy(() => import("./pages/admin/AdminServices"));
const AdminChat = lazy(() => import("./pages/admin/AdminChat"));

// 🔧 Maintenance mode toggle — set to false to bring the site back online
const MAINTENANCE_MODE = false;

const TermsOfService = lazy(() => import("./pages/legal/TermsOfService"));
const PrivacyPolicy = lazy(() => import("./pages/legal/PrivacyPolicy"));
const RefundPolicy = lazy(() => import("./pages/legal/RefundPolicy"));
const CookiePolicy = lazy(() => import("./pages/legal/CookiePolicy"));
const ContactUs = lazy(() => import("./pages/legal/ContactUs"));
const AboutUs = lazy(() => import("./pages/legal/AboutUs"));
const ShippingPolicy = lazy(() => import("./pages/legal/ShippingPolicy"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 15 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: 1,
      retryDelay: (i) => Math.min(1000 * 2 ** i, 10000),
    },
    mutations: {
      retry: 0,
    },
  },
});

const PageFallback = () => (
  <div className="min-h-screen flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
  </div>
);

const AppRoutes = () => {
  const location = useLocation();
  const allowThroughMaintenance =
    location.pathname === "/auth" ||
    location.pathname.startsWith("/sign-in") ||
    location.pathname.startsWith("/sign-up");

  if (MAINTENANCE_MODE && !allowThroughMaintenance) {
    return (
      <Routes>
        <Route path="/auth" element={<Navigate to="/sign-in" replace />} />
        <Route path="/sign-in/*" element={<Auth />} />
        <Route path="/sign-up/*" element={<Auth />} />
        <Route path="*" element={<Maintenance />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/sign-in/*" element={<Auth />} />
      <Route path="/sign-up/*" element={<Auth />} />
      
      <Route path="/auth" element={<Navigate to="/sign-in" replace />} />

      {/* User pages */}
      <Route path="/" element={<Index />} />
      <Route path="/smm-panel-usa" element={<SmmPanelUsa />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/engagement-order" element={<EngagementOrder />} />
      <Route path="/orders" element={<Orders />} />
      <Route path="/wallet" element={<Wallet />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/support" element={<Support />} />
      <Route path="/api-access" element={<ApiAccess />} />
      <Route path="/my-providers" element={<MyProviders />} />
      <Route path="/my-services" element={<MyServices />} />
      <Route path="/my-bundles" element={<MyBundles />} />
      <Route path="/mass-order" element={<MassOrder />} />
      <Route path="/ai-intelligence" element={<AIIntelligence />} />
      <Route path="/subscription" element={<Subscription />} />
      <Route path="/engagement-orders" element={<EngagementOrders />} />
      <Route path="/engagement-orders/:orderNumber" element={<EngagementOrderDetail />} />
      <Route path="/admin" element={<AdminGuard><Admin /></AdminGuard>} />
      <Route path="/admin/services" element={<AdminGuard><AdminServices /></AdminGuard>} />
      <Route path="/admin/users" element={<AdminGuard><AdminUsers /></AdminGuard>} />
      <Route path="/admin/bundles" element={<AdminGuard><AdminBundles /></AdminGuard>} />
      <Route path="/admin/cron-monitor" element={<AdminGuard><AdminCronMonitor /></AdminGuard>} />
      <Route path="/admin/chat" element={<AdminGuard><AdminChat /></AdminGuard>} />
      <Route path="/admin/deposits" element={<AdminGuard><AdminDeposits /></AdminGuard>} />
      <Route path="/admin/provider-accounts" element={<AdminGuard><AdminProviderAccounts /></AdminGuard>} />
      <Route path="/admin/service-provider-mapping" element={<AdminGuard><AdminServiceProviderMapping /></AdminGuard>} />
      <Route path="/admin/audit-log" element={<AdminGuard><AdminAuditLog /></AdminGuard>} />
      <Route path="/admin/oxapay-events" element={<AdminGuard><AdminOxaPayEvents /></AdminGuard>} />
      <Route path="/admin/popup-ad" element={<AdminGuard><AdminPopupAd /></AdminGuard>} />
      <Route path="/admin/topup-plan" element={<AdminGuard><AdminTopupPlan /></AdminGuard>} />
      <Route path="/admin/subscriptions" element={<AdminGuard><AdminSubscriptions /></AdminGuard>} />

      {/* Legal */}
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/refund" element={<RefundPolicy />} />
      <Route path="/cookies" element={<CookiePolicy />} />
      <Route path="/contact" element={<ContactUs />} />
      <Route path="/about" element={<AboutUs />} />
      <Route path="/shipping" element={<ShippingPolicy />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => {
  useEffect(() => {
    const handleRejection = (e: PromiseRejectionEvent) => {
      console.error("Unhandled rejection:", e.reason);
      toast.error("An error occurred. Please try again.");
      e.preventDefault();
    };
    const handleError = (e: ErrorEvent) => {
      console.error("Unhandled error:", e.error || e.message);
    };
    window.addEventListener("unhandledrejection", handleRejection);
    window.addEventListener("error", handleError);
    return () => {
      window.removeEventListener("unhandledrejection", handleRejection);
      window.removeEventListener("error", handleError);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={basePath}>
          <AuthProvider>
            <CurrencyProvider>
              <TooltipProvider>
                <Toaster />
                <Sonner />
                <AppErrorBoundary>
                  <ScrollToTop />
                  <Suspense fallback={<PageFallback />}>
                    <AppRoutes />
                  </Suspense>
                </AppErrorBoundary>
              </TooltipProvider>
            </CurrencyProvider>
          </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
