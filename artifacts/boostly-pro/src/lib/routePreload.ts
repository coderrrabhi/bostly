type RouteLoader = () => Promise<unknown>;

export const routeLoaders: Record<string, RouteLoader> = {
  "/dashboard": () => import("@/pages/Dashboard"),
  "/engagement-order": () => import("@/pages/EngagementOrder"),
  "/mass-order": () => import("@/pages/MassOrder"),
  "/ai-intelligence": () => import("@/pages/AIIntelligence"),
  "/engagement-orders": () => import("@/pages/EngagementOrders"),
  "/subscription": () => import("@/pages/Subscription"),
  "/support": () => import("@/pages/Support"),
  "/settings": () => import("@/pages/Settings"),
  "/my-providers": () => import("@/pages/MyProviders"),
  "/my-bundles": () => import("@/pages/MyBundles"),
  "/admin": () => import("@/pages/admin/Admin"),
};

const preloadedRoutes = new Set<string>();

export function preloadRoute(path: string) {
  const loader = routeLoaders[path];
  if (!loader || preloadedRoutes.has(path)) return;

  preloadedRoutes.add(path);
  void loader().catch(() => {
    preloadedRoutes.delete(path);
  });
}

export function preloadSidebarRoutes() {
  for (const path of Object.keys(routeLoaders)) {
    preloadRoute(path);
  }
}