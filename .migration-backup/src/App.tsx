import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { CurrencyProvider } from "@/hooks/useCurrency";
import { ScrollToTop } from "@/components/ScrollToTop";
import { toast } from "sonner";
import { AppErrorBoundary } from "@/components/app/AppErrorBoundary";
import { Loader2 } from "lucide-react";


// Landing eager (LCP) — everything else lazy for smaller initial bundle
import Index from "./pages/Index";

const SmmPanelUsa = lazy(() => import("./pages/SmmPanelUsa"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Orders = lazy(() => import("./pages/Orders"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Settings = lazy(() => import("./pages/Settings"));
const Support = lazy(() => import("./pages/Support"));
const ApiAccess = lazy(() => import("./pages/ApiAccess"));
const MyProviders = lazy(() => import("./pages/MyProviders"));
const MyServices = lazy(() => import("./pages/MyServices"));
const MyBundles = lazy(() => import("./pages/MyBundles"));
const MassOrder = lazy(() => import("./pages/MassOrder"));
const AIIntelligence = lazy(() => import("./pages/AIIntelligence"));
const Subscription = lazy(() => import("./pages/Subscription"));
const Maintenance = lazy(() => import("./pages/Maintenance"));

// 🔧 Maintenance mode toggle — set to false to bring the site back online
const MAINTENANCE_MODE = false;
// Admin bypass: visit /?admin-bypass=1 once to set localStorage flag
const isAdminBypass = () => {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("admin-bypass") === "1") {
      localStorage.setItem("bp_admin_bypass", "1");
    }
    return localStorage.getItem("bp_admin_bypass") === "1"
      || window.location.pathname.startsWith("/admin");
  } catch { return false; }
};

const EngagementOrder = lazy(() => import("./pages/EngagementOrder"));
const EngagementOrders = lazy(() => import("./pages/EngagementOrders"));
const EngagementOrderDetail = lazy(() => import("./pages/EngagementOrderDetail"));

// Admin — heavy, lazy
const Admin = lazy(() => import("./pages/admin/Admin"));
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
      retry: 2,
      retryDelay: (i) => Math.min(1000 * 2 ** i, 10000),
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});

const PageFallback = () => (
  <div className="min-h-screen flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
  </div>
);

const ADMIN_EMAILS = ["admin@gmail.com"];

const AppRoutes = () => {
  const { user } = useAuth();
  const location = useLocation();
  const isAdminUser = !!user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());
  const allowThroughMaintenance =
    isAdminUser ||
    isAdminBypass() ||
    location.pathname === "/auth" ||
    location.pathname.startsWith("/admin");

  if (MAINTENANCE_MODE && !allowThroughMaintenance) {
    return (
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="*" element={<Maintenance />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* User pages */}
      <Route path="/" element={<Index />} />
      <Route path="/smm-panel-usa" element={<SmmPanelUsa />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/orders" element={<Orders />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/support" element={<Support />} />
      <Route path="/api-access" element={<ApiAccess />} />
      <Route path="/my-providers" element={<MyProviders />} />
      <Route path="/my-services" element={<MyServices />} />
      <Route path="/my-bundles" element={<MyBundles />} />
      <Route path="/mass-order" element={<MassOrder />} />
      <Route path="/ai-intelligence" element={<AIIntelligence />} />
      <Route path="/subscription" element={<Subscription />} />
      <Route path="/admin/subscriptions" element={<AdminGuard><AdminSubscriptions /></AdminGuard>} />

      {/* Engagement */}
      <Route path="/engagement-order" element={<EngagementOrder />} />
      <Route path="/engagement-orders" element={<EngagementOrders />} />
      <Route path="/engagement-orders/:orderNumber" element={<EngagementOrderDetail />} />

      {/* Admin — server-verified guard */}
      <Route path="/admin" element={<AdminGuard><Admin /></AdminGuard>} />
      <Route path="/admin/services" element={<NotFound />} />
      <Route path="/admin/users" element={<AdminGuard><AdminUsers /></AdminGuard>} />
      <Route path="/admin/bundles" element={<AdminGuard><AdminBundles /></AdminGuard>} />
      <Route path="/admin/cron-monitor" element={<AdminGuard><AdminCronMonitor /></AdminGuard>} />
      <Route path="/admin/chat" element={<NotFound />} />
      <Route path="/admin/deposits" element={<AdminGuard><AdminDeposits /></AdminGuard>} />
      <Route path="/admin/provider-accounts" element={<AdminGuard><AdminProviderAccounts /></AdminGuard>} />
      <Route path="/admin/service-provider-mapping" element={<AdminGuard><AdminServiceProviderMapping /></AdminGuard>} />
      <Route path="/admin/audit-log" element={<AdminGuard><AdminAuditLog /></AdminGuard>} />
      <Route path="/admin/oxapay-events" element={<AdminGuard><AdminOxaPayEvents /></AdminGuard>} />
      <Route path="/admin/popup-ad" element={<AdminGuard><AdminPopupAd /></AdminGuard>} />
      <Route path="/admin/topup-plan" element={<AdminGuard><AdminTopupPlan /></AdminGuard>} />

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
      <AuthProvider>
        <CurrencyProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <AppErrorBoundary>
              <BrowserRouter>
                <ScrollToTop />
                <Suspense fallback={<PageFallback />}>
                  <AppRoutes />
                </Suspense>
              </BrowserRouter>

            </AppErrorBoundary>
          </TooltipProvider>
        </CurrencyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
