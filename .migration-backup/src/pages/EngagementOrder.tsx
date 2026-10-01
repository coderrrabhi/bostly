import { useState, useMemo, useEffect, useCallback, useRef, memo } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { NoBundleBanner } from "@/components/NoBundleBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PlatformSelector } from "@/components/engagement/PlatformSelector";
import { QuantitySelector } from "@/components/engagement/QuantitySelector";
import { EngagementTypeCard } from "@/components/engagement/EngagementTypeCard";
import { DeliveryPreview } from "@/components/engagement/DeliveryPreview";
import { LiveGrowthChart } from "@/components/engagement/LiveGrowthChart";
import { DrawableGrowthChart } from "@/components/engagement/DrawableGrowthChart";
import { PageMeta } from "@/components/seo/PageMeta";
import {
  EngagementType,
  EngagementConfig,
  DEFAULT_RATIOS,
  DEFAULT_ORGANIC_SETTINGS,
} from "@/lib/engagement-types";
import {
  ControlPoint,
  DrawModeState,
  createInitialPoints,
  curveToSchedule,
  calculateQuantitiesFromCurve,
} from "@/lib/curve-to-schedule";
import { Loader2, Rocket, Link as LinkIcon, Brain, Percent, HelpCircle, ArrowDown, Sparkles, Clock, Shuffle, Shield, TrendingUp, Eye } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useDebounce } from "@/hooks/useDebounce";
import { FullOrganicConfig } from "@/lib/organic-algorithm";

type EngagementConfigs = Record<string, EngagementConfig>;

type UserBundleItemProvider = {
  id: string;
  enabled: boolean;
  priority: number;
  provider_service_id: string | null;
  user_provider_account_id: string;
};

type UserBundleItem = {
  id: string;
  engagement_type: string;
  quantity: number;
  user_bundle_id: string;
  user_service_id: string | null;
  user_bundle_item_providers?: UserBundleItemProvider[];
};

type UserBundle = {
  id: string;
  name: string;
  platform: string | null;
  is_active: boolean;
  user_bundle_items?: UserBundleItem[];
};

export default function EngagementOrder() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading, isAdmin, wallet, refreshWallet } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Pricing/visibility now comes only from user's own bundles and mapped provider service IDs.

  // Realtime: refresh view when user's own bundle/provider setup changes.
  useEffect(() => {
    const channel = supabase
      .channel('pricing-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_bundles' }, () => {
        queryClient.invalidateQueries({ queryKey: ['full-engagement-user-bundles'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_bundle_items' }, () => {
        queryClient.invalidateQueries({ queryKey: ['full-engagement-user-bundles'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_bundle_item_providers' }, () => {
        queryClient.invalidateQueries({ queryKey: ['full-engagement-user-bundles'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_services' }, () => {
        queryClient.invalidateQueries({ queryKey: ['full-engagement-user-bundles'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Form State
  const [platform, setPlatform] = useState('instagram');
  const [link, setLink] = useState('');
  const [baseQuantity, setBaseQuantity] = useState(10000);
  // Debounce base quantity for expensive recalculations
  const debouncedBaseQuantity = useDebounce(baseQuantity, 200);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewSchedules, setPreviewSchedules] = useState<Record<string, { scheduled_at: string; quantity_to_send: number; base_quantity: number; variance_applied: number; peak_multiplier: number }[]>>({});

  // Draw mode state for custom curve editing
  const [drawModeState, setDrawModeState] = useState<DrawModeState>({
    isEnabled: false,
    activeType: null,
    points: {} as Record<EngagementType, ControlPoint[]>,
  });

  // Engagement configs - initialize empty, will be populated when bundle loads
  const [engagements, setEngagements] = useState<EngagementConfigs>({});

  // Track per-type user-edited quantities so auto-ratio sync doesn't overwrite them.
  // Once a user manually edits a type's quantity, it stays locked to their value
  // regardless of base quantity changes — they can edit each type independently.
  const userEditedQtyRef = useRef<Set<EngagementType>>(new Set());

  // Local settings toggles (defaulted from localStorage)
  const [isOrganicMode, setIsOrganicMode] = useState(true);
  const [isAutoRatios, setIsAutoRatios] = useState(true);
  // User-saved custom ratios from Settings page (stored in localStorage)
  const [userSavedRatios, setUserSavedRatios] = useState<Record<string, number> | null>(null);

  // Sync with localStorage on load
  useEffect(() => {
    try {
      const savedOrganic = localStorage.getItem('organic_settings');
      if (savedOrganic) {
        const parsed = JSON.parse(savedOrganic);
        if (typeof parsed.isOrganicMode === 'boolean') setIsOrganicMode(parsed.isOrganicMode);
        if (parsed.ratios) setUserSavedRatios(parsed.ratios);
      }
    } catch { /* ignore */ }
  }, []);


  // Fetch USER's own bundles + provider mappings (drives visible platforms/types)
  const { data: userBundles = [], isLoading: userBundlesLoading } = useQuery({
    queryKey: ['full-engagement-user-bundles', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('user_bundles')
        .select('id, name, platform, is_active, user_bundle_items(id, engagement_type, quantity, user_bundle_id, user_service_id, user_bundle_item_providers(id, enabled, priority, provider_service_id, user_provider_account_id))')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as UserBundle[];
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  const bundlesWithItems = useMemo(() => {
    return userBundles.filter((b) => (b.user_bundle_items?.length ?? 0) > 0 && !!b.platform);
  }, [userBundles]);

  const hasAnyUserBundle = bundlesWithItems.length > 0;

  // Available platforms = platforms user has in their own bundle only.
  const availablePlatforms = useMemo(() => {
    return [...new Set(bundlesWithItems.map((b) => b.platform).filter(Boolean) as string[])];
  }, [bundlesWithItems]);

  // Auto-select first available platform if current selection has no bundles
  useEffect(() => {
    if (availablePlatforms.length > 0 && !availablePlatforms.includes(platform)) {
      setPlatform(availablePlatforms[0]);
    }
  }, [availablePlatforms, platform]);

  const selectedBundle = useMemo(() => {
    return bundlesWithItems.find((b) => b.platform === platform) ?? null;
  }, [bundlesWithItems, platform]);

  const bundlesLoading = userBundlesLoading;

  // Get active engagement types from bundle
  const activeEngagementTypes = useMemo<EngagementType[]>(() => {
    const items = selectedBundle?.user_bundle_items ?? [];
    const uniqueTypes = [...new Set(items.map(item => item.engagement_type as EngagementType).filter(Boolean))];

    const PREFERRED_ORDER: Record<string, number> = {
      views: 1,
      likes: 2,
      comments: 3,
      shares: 4,
      reposts: 5,
      saves: 6,
    };

    return uniqueTypes.sort((a, b) => (PREFERRED_ORDER[a] || 99) - (PREFERRED_ORDER[b] || 99));
  }, [selectedBundle]);

  // Base per-type quantities (used as "100%" reference for draw-mode scaling)
  // Use debounced value for expensive calculations
  const baseTypeQuantities = useMemo(() => {
    const base: Record<EngagementType, number> = {} as Record<EngagementType, number>;
    activeEngagementTypes.forEach((type) => {
      // Use user's custom ratio if available from localStorage, else fallback to default
      const userRatio = userSavedRatios?.[type];
      const ratio = typeof userRatio === 'number' ? userRatio : DEFAULT_RATIOS[type];
      base[type] = Math.round(debouncedBaseQuantity * (ratio / 100));
    });
    return base;
  }, [debouncedBaseQuantity, activeEngagementTypes, userSavedRatios]);
  const mappedProviderServiceIds = useMemo(() => {
    const ids = new Set<string>();
    (selectedBundle?.user_bundle_items ?? []).forEach((item) => {
      (item.user_bundle_item_providers ?? [])
        .filter((p) => p.enabled && p.provider_service_id)
        .forEach((p) => ids.add(p.provider_service_id as string));
    });
    return [...ids];
  }, [selectedBundle]);

  const { data: userServices = [] } = useQuery({
    queryKey: ['full-engagement-user-services', user?.id, mappedProviderServiceIds.join(',')],
    enabled: !!user?.id && mappedProviderServiceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_services')
        .select('id, user_provider_account_id, provider_service_id, rate, min_quantity, max_quantity, is_active')
        .eq('user_id', user!.id)
        .in('provider_service_id', mappedProviderServiceIds)
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60 * 1000,
  });

  // Get service metadata from user's mapped provider services only.
  const servicePrices = useMemo(() => {
    const prices: Record<string, { pricePerK: number; serviceId: string | null; userServiceId: string | null; minQuantity: number; maxQuantity?: number }> = {};
    const serviceByAccountAndProviderId = new Map<string, any>();
    userServices.forEach((s: any) => {
      serviceByAccountAndProviderId.set(`${s.user_provider_account_id}:${s.provider_service_id}`, s);
    });

    (selectedBundle?.user_bundle_items ?? []).forEach((item) => {
      const mappedProviders = (item.user_bundle_item_providers ?? [])
        .filter((p) => p.enabled && p.provider_service_id)
        .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

      const matchedServices = mappedProviders
        .map((p) => serviceByAccountAndProviderId.get(`${p.user_provider_account_id}:${p.provider_service_id}`))
        .filter(Boolean);

      if (matchedServices.length > 0) {
        const rateServices = matchedServices.filter((s: any) => Number(s.rate) > 0);
        const cheapest = (rateServices.length > 0 ? rateServices : matchedServices)
          .reduce((a: any, b: any) => Number(a.rate) <= Number(b.rate) ? a : b);
        const mins = matchedServices.map((s: any) => Number(s.min_quantity || 0)).filter((n: number) => n > 0);
        const maxes = matchedServices.map((s: any) => Number(s.max_quantity || 0)).filter((n: number) => n > 0);

        prices[item.engagement_type] = {
          pricePerK: Number(cheapest.rate) || 0,
          serviceId: null,
          userServiceId: cheapest.id,
          minQuantity: mins.length > 0 ? Math.min(...mins) : 0,
          maxQuantity: maxes.length > 0 ? Math.max(...maxes) : undefined,
        };
        return;
      }

      // If services were not imported, still show the card from provider mappings.
      // Backend will validate/route by provider_service_id; price stays hidden/zero.
      if (mappedProviders.length > 0) {
        prices[item.engagement_type] = {
          pricePerK: 0,
          serviceId: null,
          userServiceId: null,
          minQuantity: item.engagement_type === 'views' ? 100 : 0,
        };
      }
    });

    if (prices['views']) {
      prices['views'] = {
        ...prices['views'],
        minQuantity: Math.max(100, prices['views'].minQuantity || 0),
      };
    }
    return prices;
  }, [selectedBundle, userServices]);

  // Update engagement configs when bundle or base quantity changes
  // Use debounced value to prevent excessive recalculations
  useEffect(() => {
    const items = selectedBundle?.user_bundle_items ?? [];
    if (items.length === 0) {
      setEngagements({});
      return;
    }

    // Get all engagement types from bundle items
    const bundleTypes = items
      .map(item => item.engagement_type as EngagementType);

    const uniqueBundleTypes = [...new Set(bundleTypes)];

    setEngagements((prev) => {
      const updated: EngagementConfigs = {};

      uniqueBundleTypes.forEach((type) => {
        // If auto-ratios is OFF, only enable 'views' by default
        const isEnabledByDefault = isAutoRatios || type === 'views';

        // Use user's custom ratio if available from localStorage, else fallback to default
        const userRatio = userSavedRatios?.[type];
        const ratioPercent = typeof userRatio === 'number' ? userRatio : (DEFAULT_RATIOS[type] ?? 1);

        const ratioQuantity = Math.round(debouncedBaseQuantity * (ratioPercent / 100));

        const serviceData = servicePrices[type];

        // Respect user's base quantity exactly — no auto bump to provider minimum.
        // If it's below provider min, the per-card warning will appear.
        const quantity = ratioQuantity;

        const isUserEdited = userEditedQtyRef.current.has(type);
        const finalQuantity = isUserEdited && prev[type]
          ? prev[type].quantity
          : ((isAutoRatios || !prev[type]) ? quantity : prev[type].quantity);
        const finalPrice = serviceData
          ? (finalQuantity / 1000) * serviceData.pricePerK
          : prev[type]?.price ?? 0;

        updated[type] = {
          type,
          enabled: prev[type] ? prev[type].enabled : isEnabledByDefault,
          quantity: finalQuantity,
          price: finalPrice,
          serviceId: serviceData?.serviceId ?? prev[type]?.serviceId ?? null,
          userServiceId: serviceData?.userServiceId ?? (prev[type] as any)?.userServiceId ?? null,
          minQuantity: serviceData?.minQuantity ?? prev[type]?.minQuantity,
          // Per-type organic settings
          timeLimitHours: prev[type]?.timeLimitHours ?? DEFAULT_ORGANIC_SETTINGS.timeLimitHours,
          variancePercent: prev[type]?.variancePercent ?? DEFAULT_ORGANIC_SETTINGS.variancePercent,
          peakHoursEnabled: prev[type]?.peakHoursEnabled ?? DEFAULT_ORGANIC_SETTINGS.peakHoursEnabled,
        };
      });
      return updated;
    });
  }, [debouncedBaseQuantity, selectedBundle, servicePrices, userSavedRatios, isAutoRatios]);

  const handleEngagementChange = useCallback((type: EngagementType, config: EngagementConfig) => {
    setEngagements(prev => {
      const prevQty = prev[type]?.quantity;
      if (prevQty !== undefined && config.quantity !== prevQty) {
        userEditedQtyRef.current.add(type);
      }
      return { ...prev, [type]: config };
    });
    // Reset draw mode when user manually changes quantity
    if (drawModeState.isEnabled) {
      setDrawModeState(prev => ({
        ...prev,
        points: {
          ...prev.points,
          [type]: createInitialPoints(type, config.quantity),
        },
      }));
    }
  }, [drawModeState.isEnabled]);

  // Real-time: when user drags curve, update quantities instantly (and schedule updates automatically)
  useEffect(() => {
    if (!drawModeState.isEnabled) return;

    const nextQuantities = calculateQuantitiesFromCurve(drawModeState.points, baseTypeQuantities);

    setEngagements((prev) => {
      let changed = false;
      const updated: EngagementConfigs = { ...prev };

      Object.keys(prev).forEach((type) => {
        const engType = type as EngagementType;
        const desired = nextQuantities[engType];
        if (typeof desired !== 'number' || Number.isNaN(desired)) return;

        // Clamp to provider/service minimum if present
        const min = updated[engType]?.minQuantity ?? 0;
        const clamped = min > 0 ? Math.max(min, desired) : desired;

        if (clamped === updated[engType]?.quantity) return;

        const prevQty = updated[engType]?.quantity || 0;
        const pricePerK = prevQty > 0 ? ((updated[engType]?.price || 0) * 1000) / prevQty : 0;

        updated[engType] = {
          ...updated[engType],
          quantity: clamped,
          price: pricePerK > 0 ? (clamped / 1000) * pricePerK : updated[engType]?.price || 0,
        };
        changed = true;
      });

      return changed ? updated : prev;
    });
  }, [drawModeState.isEnabled, drawModeState.points, baseTypeQuantities]);

  // Handle curve change from drawable chart (end-of-drag / preset / reset)
  const handleCurveChange = useCallback((type: EngagementType, points: ControlPoint[]) => {
    // Update the draw mode state with new points
    setDrawModeState(prev => ({
      ...prev,
      points: { ...prev.points, [type]: points },
    }));
    // Refresh key kept for any downstream reset behavior
    setPreviewRefreshKey(k => k + 1);
  }, []);

  // Ref guard: skip setPreviewSchedules when the schedule CONTENT hasn't
  // changed. Timestamps from new Date() always differ, so we compare only
  // quantities + structure (runNumber, engagementType) to detect real changes.
  // Without this guard, every DeliveryPreview render calls onScheduleChange →
  // setPreviewSchedules → parent re-render → new engagements object →
  // DeliveryPreview re-render → infinite "Maximum update depth exceeded" loop.
  const prevScheduleContentKey = useRef<string>('');

  const handleScheduleChange = useCallback((payload: {
    schedules: FullOrganicConfig[];
    customQuantities: Record<string, number>;
  }) => {
    // Build a content key that excludes timestamps (they change on every render
    // because schedules are generated relative to `new Date()`).
    const contentKey = JSON.stringify(
      payload.schedules.map(s => ({
        type: s.engagementType,
        runs: s.runs.map(r => ({ n: r.runNumber, q: payload.customQuantities[`${s.engagementType}-${r.runNumber}`] ?? r.quantity })),
      }))
    );
    if (contentKey === prevScheduleContentKey.current) return;
    prevScheduleContentKey.current = contentKey;

    const nextSchedules = payload.schedules.reduce((acc, schedule) => {
      acc[schedule.engagementType] = schedule.runs.map((run) => {
        const runId = `${schedule.engagementType}-${run.runNumber}`;
        const quantity = payload.customQuantities[runId] ?? run.quantity;

        return {
          scheduled_at: run.scheduledAt.toISOString(),
          quantity_to_send: quantity,
          base_quantity: quantity,
          variance_applied: run.varianceApplied,
          peak_multiplier: run.peakMultiplier,
        };
      });

      return acc;
    }, {} as Record<string, { scheduled_at: string; quantity_to_send: number; base_quantity: number; variance_applied: number; peak_multiplier: number }[]>);

    setPreviewSchedules(nextSchedules);
  }, []);

  // Calculate totals
  const totalPrice = useMemo(() => {
    return Object.values(engagements)
      .filter(e => e.enabled)
      .reduce((sum, e) => sum + e.price, 0);
  }, [engagements]);

  const totalEngagements = useMemo(() => {
    return Object.values(engagements)
      .filter(e => e.enabled)
      .reduce((sum, e) => sum + e.quantity, 0);
  }, [engagements]);

  // Place order mutation
  const placeOrderMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated');
      if (!link.trim()) throw new Error('Please enter a valid link');

      // Wallet balance not required — orders are fulfilled directly from user's own provider account.



      // Prevent non-2xx failures from provider min-quantity rules
      const belowMin = Object.entries(engagements)
        .filter(([_, config]) => config.enabled)
        .filter(([_, config]) => (config.minQuantity ?? 0) > 0)
        .filter(([_, config]) => config.quantity < (config.minQuantity ?? 0))
        .map(([type, config]) => ({
          type,
          quantity: config.quantity,
          min: config.minQuantity as number,
        }));

      if (belowMin.length > 0) {
        const first = belowMin[0];
        throw new Error(
          `${first.type} quantity ${first.quantity} is below minimum ${first.min}. Increase Base Quantity or edit that type.`
        );
      }

      const bundle = selectedBundle;

      if (!bundle) {
        throw new Error('Please create a bundle first.');
      }

      const selectedEngagements = Object.entries(engagements)
        .filter(([_, config]) => config.enabled)
        .map(([type, config]) => {
          const bundleItem = bundle.user_bundle_items?.find((item) => item.engagement_type === type);
          const providerMappings = (bundleItem?.user_bundle_item_providers ?? [])
            .filter((p) => p.enabled && p.provider_service_id)
            .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

          return { type, config, bundleItem, providerMappings };
        });

      const missingProviders = selectedEngagements
        .filter((entry) => entry.providerMappings.length === 0)
        .map((entry) => entry.type);

      if (missingProviders.length > 0) {
        throw new Error(`${missingProviders.join(', ')} provider service IDs are not mapped. Please save them in My Bundles.`);
      }

      // Call edge function to process engagement order with per-type organic settings
      const { data, error } = await supabase.functions.invoke('process-engagement-order', {
        body: {
          user_id: user.id,
          user_bundle_id: bundle.id,
          bundle_id: null,
          link: link.trim(),
          base_quantity: baseQuantity,
          total_price: totalPrice,
          is_organic_mode: isOrganicMode,
          // Per-type settings will be in each engagement object
          engagements: selectedEngagements
            .map(({ type, config, bundleItem, providerMappings }) => {
              // CRITICAL: Resolve time limit - if -1 (custom), the actual value should be stored
              // The EngagementTypeCard should store actual hours, but if it sends -1, treat as Auto (0)
              let effectiveTimeLimit = config.timeLimitHours;
              if (effectiveTimeLimit === -1) {
                // -1 means "Custom" was selected but no value stored - treat as Auto
                effectiveTimeLimit = 0;
              }

              // Build scheduled runs, filtering out zero-quantity entries (organic
              // scheduler can produce them via variance/rounding) and redistributing
              // any lost quantity onto the last run.
              // IMPORTANT: if the preview schedule is stale (user changed quantities
              // after the preview was generated), its run totals won't match
              // config.quantity. In that case we drop the schedule entirely and let
              // the server create a single clean run — this avoids the
              // "schedule quantity does not match its order quantity" error.
              const rawRuns = (previewSchedules[type] ?? []).map((run, index) => ({
                ...run,
                run_number: index + 1,
              }));
              const filteredRuns = rawRuns.filter((run) => (run.quantity_to_send ?? 0) > 0);
              const lostQty =
                rawRuns.reduce((s, r) => s + (r.quantity_to_send ?? 0), 0) -
                filteredRuns.reduce((s, r) => s + r.quantity_to_send, 0);
              if (lostQty > 0 && filteredRuns.length > 0) {
                filteredRuns[filteredRuns.length - 1] = {
                  ...filteredRuns[filteredRuns.length - 1],
                  quantity_to_send: filteredRuns[filteredRuns.length - 1].quantity_to_send + lostQty,
                };
              }
              // Final safety check: only use the schedule if it sums exactly to the
              // order quantity. Any mismatch means the schedule is stale.
              const filteredTotal = filteredRuns.reduce((s, r) => s + r.quantity_to_send, 0);
              const scheduledRuns =
                filteredRuns.length > 0 && filteredTotal === config.quantity
                  ? filteredRuns
                  : undefined;

              return {
                type,
                quantity: config.quantity,
                price: config.price,
                service_id: null,
                user_service_id: (config as any).userServiceId ?? bundleItem?.user_service_id ?? null,
                user_bundle_item_id: bundleItem?.id ?? null,
                provider_mappings: providerMappings.map((p) => ({
                  user_provider_account_id: p.user_provider_account_id,
                  provider_service_id: p.provider_service_id,
                  priority: p.priority,
                })),
                // Per-type organic settings - always send resolved hours value
                time_limit_hours: effectiveTimeLimit,
                variance_percent: config.variancePercent,
                peak_hours_enabled: config.peakHoursEnabled,
                scheduled_runs: scheduledRuns,
              };
            }),
        },
      });

      if (error) {
        // Supabase often returns a generic message ("non-2xx") — try to extract the real server error
        let message = (error as any)?.message || 'Order failed';
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.text === 'function') {
          try {
            const text = await ctx.text();
            if (text) {
              try {
                const parsed = JSON.parse(text);
                message = parsed?.error || parsed?.message || text;
              } catch {
                message = text;
              }
            }
          } catch {
            // ignore
          }
        }
        throw new Error(message);
      }

      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "🚀 Order Placed!",
        description: `Order #${data.order_number} created.`,
      });
      // Immediately refresh wallet from auth context
      refreshWallet();
      queryClient.invalidateQueries({ queryKey: ['engagement-orders'] });
      navigate('/engagement-orders');
    },
    onError: (error: Error) => {
      toast({
        title: "Order Failed",
        description: error.message,
        variant: "destructive",
      });
      // Refresh wallet to show updated balance
      refreshWallet();
    },
  });

  // INSTANT RENDER - No loading state blocking UI
  // Redirect happens via useEffect in DashboardLayout if not authenticated

  if (!user && !authLoading) {
    return <Navigate to="/auth" replace />;
  }

  // Check if user can afford the order
  const canAfford = wallet && wallet.balance > 0 && wallet.balance >= totalPrice;

  // Detect platform from link for validation
  const detectPlatformFromLink = (url: string): string | null => {
    const lower = url.toLowerCase();
    if (lower.includes('instagram.com') || lower.includes('instagr.am')) return 'instagram';
    if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
    if (lower.includes('tiktok.com')) return 'tiktok';
    if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
    if (lower.includes('facebook.com') || lower.includes('fb.com')) return 'facebook';
    return null;
  };

  // Handle order button click - SUBSCRIPTION FIRST, then BALANCE
  const handlePlaceOrder = () => {
    // Wait for bundles to load
    if (bundlesLoading) {
      toast({
        title: "Loading...",
        description: "Please wait while services load.",
      });
      return;
    }

    // Basic validation first
    if (!link.trim()) {
      toast({
        title: "Link Required",
        description: "Please enter a valid link.",
        variant: "destructive",
      });
      return;
    }

    // NEW: Detect platform from link and validate it matches selected platform
    const detectedPlatform = detectPlatformFromLink(link);
    if (detectedPlatform && detectedPlatform !== platform) {
      toast({
        title: "⚠️ Platform Mismatch",
        description: `You selected ${platform.toUpperCase()}, but the link is for ${detectedPlatform.toUpperCase()}. Please select the correct platform.`,
        variant: "destructive",
      });
      return;
    }

    // NEW: Check if the selected platform has services configured
    if (activeEngagementTypes.length === 0) {
      toast({
        title: "❌ Services Not Available",
        description: `No services are configured for ${platform.toUpperCase()} yet. Please add service IDs in My Bundles.`,
        variant: "destructive",
      });
      return;
    }

    // Admin gets free access - no subscription or balance required
    if (isAdmin) {
      placeOrderMutation.mutate();
      return;
    }
    // No wallet balance check — orders are deducted from the user's own provider account.
    placeOrderMutation.mutate();
  };

  const showBundleBanner = !userBundlesLoading && !hasAnyUserBundle;

  return (
    <DashboardLayout>
      <PageMeta title="New Engagement Order" description="Place a natural, AI-organic engagement order — Instagram, YouTube, or TikTok views, likes, and comments delivered on a real growth curve." canonicalPath="/engagement-order" noIndex />

      <div className="max-w-5xl mx-auto px-2 sm:px-6 lg:px-8 space-y-3 sm:space-y-6 pb-8">
        {showBundleBanner && <NoBundleBanner message="Engagement types will appear once you add services to your bundle. Please create a bundle first." />}
        {/* Header with gradient - Compact on mobile */}
        <div className="relative overflow-hidden rounded-xl sm:rounded-2xl p-2.5 sm:p-4 lg:p-5" style={{ background: 'linear-gradient(135deg, #2563EB 0%, #3B82F6 100%)', boxShadow: '0 8px 24px rgba(37,99,235,.18)' }}>
          <div className="relative z-10 text-center">
            <div className="inline-flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,.2)', backdropFilter: 'blur(8px)' }}>
                <Rocket className="h-3.5 w-3.5 sm:h-5 sm:w-5 text-white" />
              </div>
            </div>
            <h1 className="text-sm sm:text-xl lg:text-2xl font-bold text-white mb-0.5 tracking-tight">
              Organic Full Engagement
            </h1>
            <p className="text-[10px] sm:text-sm max-w-lg mx-auto leading-snug" style={{ color: 'rgba(255,255,255,.7)' }}>
              One link → All engagement types with organic settings
            </p>
          </div>
          <div className="absolute top-0 right-0 w-32 sm:w-48 h-32 sm:h-48 bg-gradient-to-bl from-white/10 to-transparent rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-24 sm:w-36 h-24 sm:h-36 bg-gradient-to-tr from-white/10 to-transparent rounded-full blur-3xl" />
        </div>

        {/* AI Automation Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-6">
          <Card className={cn(
            "glass-card border-2 transition-all duration-300 relative overflow-hidden",
            isOrganicMode ? "border-success/40 bg-success/5 shadow-[0_0_30px_rgba(59,130,246,0.1)]" : "border-border"
          )}>
            <CardContent className="p-2.5 sm:p-4 flex items-center justify-between gap-2 sm:gap-3">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className={cn(
                  "w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl flex items-center justify-center transition-all shadow-inner shrink-0",
                  isOrganicMode ? "bg-success text-white" : "bg-secondary text-muted-foreground"
                )}>
                  <Brain className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <h3 className="text-[13px] sm:text-sm font-black text-foreground tracking-tight">AI Organic Algorithm</h3>
                    <Badge variant="outline" className={cn(
                      "text-[8px] sm:text-[9px] font-black uppercase tracking-wider border-none px-1.5 py-0 whitespace-nowrap",
                      isOrganicMode ? "bg-success text-white" : "bg-muted text-muted-foreground"
                    )}>
                      {isOrganicMode ? "ON" : "OFF"}
                    </Badge>
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium mb-1.5">AI generates UNIQUE organic patterns for each order automatically</p>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="bg-success/10 text-[8px] sm:text-[9px] text-success border-success/20 font-bold py-0 px-1.5">✓ Unique S-curve</Badge>
                    <Badge variant="outline" className="bg-success/10 text-[8px] sm:text-[9px] text-success border-success/20 font-bold py-0 px-1.5">✓ Random variance</Badge>
                    <Badge variant="outline" className="bg-success/10 text-[8px] sm:text-[9px] text-success border-success/20 font-bold py-0 px-1.5">✓ Anti-bot</Badge>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-center gap-2 shrink-0 scale-90 sm:scale-100">
                <Switch
                  checked={isOrganicMode}
                  onCheckedChange={(val) => {
                    setIsOrganicMode(val);
                    if (val) setIsAutoRatios(false); // turn off the other
                  }}
                  className="data-[state=checked]:bg-success"
                />
              </div>
            </CardContent>
          </Card>

          <Card className={cn(
            "glass-card border-2 transition-all duration-300 relative overflow-hidden",
            isAutoRatios ? "border-primary/40 bg-primary/5 shadow-[0_0_30px_rgba(155,135,245,0.1)]" : "border-border"
          )}>
            <CardContent className="p-2.5 sm:p-4 flex items-center justify-between gap-2 sm:gap-3">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className={cn(
                  "w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl flex items-center justify-center transition-all shadow-inner shrink-0",
                  isAutoRatios ? "bg-primary text-white" : "bg-secondary text-muted-foreground"
                )}>
                  <Percent className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <h3 className="text-[13px] sm:text-sm font-black text-foreground tracking-tight">AI Smart Ratios</h3>
                    <Badge variant="outline" className={cn(
                      "text-[8px] sm:text-[9px] font-black uppercase tracking-wider border-none px-1.5 py-0 whitespace-nowrap",
                      isAutoRatios ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                    )}>
                      {isAutoRatios ? "AUTO" : "MANUAL"}
                    </Badge>
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium mb-1.5">AI automatically calculates organic engagement ratios</p>
                  <div className="flex flex-wrap gap-1">
                    {isAutoRatios ? (
                      <Badge variant="outline" className="bg-primary/10 text-[8px] sm:text-[9px] text-primary border-primary/20 font-bold py-0 px-1.5 italic">Optimized for algorithms</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-500/10 text-[8px] sm:text-[9px] text-amber-500 border-amber-500/20 font-bold py-0 px-1.5">Customized by User</Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-center gap-2 shrink-0 scale-90 sm:scale-100">
                <Switch
                  checked={isAutoRatios}
                  onCheckedChange={(val) => {
                    setIsAutoRatios(val);
                    if (val) setIsOrganicMode(false); // turn off the other
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>{/* end AI Automation Toggles grid */}

        {/* Platform Selector */}
        <Card className="glass-card border-2 border-border">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-foreground/10 flex items-center justify-center">
                <Rocket className="h-3.5 w-3.5 text-foreground" />
              </div>
              <Label className="text-sm font-bold tracking-tight text-foreground">Select Platform</Label>
              <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Pick one</span>
            </div>
            <PlatformSelector
              selected={platform}
              onSelect={setPlatform}
              availablePlatforms={availablePlatforms}
            />
          </CardContent>
        </Card>

        {/* Link Input */}
        <Card className="glass-card border-2 border-border">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-foreground/10 flex items-center justify-center">
                <LinkIcon className="h-4 w-4 sm:h-5 sm:w-5 text-foreground" />
              </div>
              <Label className="text-base sm:text-lg font-bold tracking-tight text-foreground">Video/Post Link</Label>
            </div>
            <Input
              placeholder={`https://${platform}.com/...`}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="h-12 sm:h-14 text-base sm:text-lg rounded-xl border-2 border-border focus:border-foreground bg-secondary text-foreground font-medium placeholder:text-muted-foreground transition-all"
            />
          </CardContent>
        </Card>

        {/* Base Quantity */}
        <Card className="glass-card border-2 border-border">
          <CardContent className="p-4 sm:p-6">
            <QuantitySelector
              value={baseQuantity}
              onChange={setBaseQuantity}
              min={100}
              max={1000000}
            />
          </CardContent>
        </Card>

        {/* Engagement Types with Per-Type Settings */}
        <div className="space-y-4 sm:space-y-5">
          <div className="flex items-center justify-between px-1 gap-2">
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">Engagement Breakdown</h2>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 hidden sm:block">
                Customize organic settings per type
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="relative inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl border border-success/40 bg-success/10 text-success hover:bg-success/15 transition-colors"
                    aria-label="How organic engagement works"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                    </span>
                    <HelpCircle className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">How it works</span>
                    <span className="sm:hidden">Guide</span>
                    <ArrowDown className="h-3 w-3 animate-bounce" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[320px] sm:w-[380px] p-0 overflow-hidden">
                  <div className="p-4 bg-gradient-to-br from-success/15 via-success/5 to-transparent border-b border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="h-4 w-4 text-success" />
                      <h3 className="text-sm font-bold text-foreground">How Full Engagement Works</h3>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      One link → views, likes, comments, saves & shares — delivered like real humans.
                    </p>
                  </div>
                  <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
                    {[
                      { icon: LinkIcon, title: 'Paste your post link', desc: 'Instagram reel, post or YouTube — one link triggers all engagement types.' },
                      { icon: Eye, title: 'Pick what you want', desc: 'Toggle Views, Likes, Comments, Saves, Shares. Set quantity per type or use the bundle.' },
                      { icon: Brain, title: 'AI plans organic delivery', desc: 'S-curve schedule splits each type into 5–15 runs with ±50% qty variance — no two batches identical.' },
                      { icon: Clock, title: 'Smart timing', desc: 'Peak hours (6–10 PM IST) get 1.5× boost. Night slows down. ±5min jitter on every run.' },
                      { icon: Shuffle, title: 'Multi-provider rotation', desc: 'Each run auto-routes to the best available provider for that type — quality stays high.' },
                      { icon: TrendingUp, title: 'Maintained, not dumped', desc: 'Engagement keeps trickling over hours so your post looks consistently active — not spiked.' },
                      { icon: Shield, title: '100% account safe', desc: 'Randomized patterns + human-like pacing = undetectable. Zero ban risk.' },
                    ].map((s, i) => (
                      <div key={s.title} className="flex gap-2.5">
                        <div className="shrink-0 w-7 h-7 rounded-lg bg-success/10 text-success flex items-center justify-center font-bold text-[11px]">
                          {i + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <s.icon className="h-3 w-3 text-success" />
                            <p className="text-[12px] font-bold text-foreground">{s.title}</p>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-snug">{s.desc}</p>
                        </div>
                      </div>
                    ))}
                    <div className="mt-3 p-2.5 rounded-lg bg-muted/50 border border-border">
                      <p className="text-[11px] text-foreground leading-snug">
                        <strong>Pro tip:</strong> Tap <span className="font-mono px-1 py-0.5 bg-background rounded border border-border text-[10px]">Settings</span> on each card below to fine-tune delivery time, number of runs and variance per engagement type.
                      </p>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <span className="text-xs sm:text-sm bg-foreground text-background px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl font-bold">
                {bundlesLoading ? (
                  <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> ...</span>
                ) : (
                  `${Object.values(engagements).filter(e => e.enabled).length} active`
                )}
              </span>
            </div>
          </div>
          <div className="grid gap-3 sm:gap-4">
            {activeEngagementTypes.map(type => (
              engagements[type] && (
                <EngagementTypeCard
                  key={type}
                  type={type}
                  config={engagements[type]}
                  baseQuantity={baseQuantity}
                  onChange={(config) => handleEngagementChange(type, config)}
                  minQuantity={engagements[type]?.minQuantity}
                  customCurvePoints={drawModeState.isEnabled ? drawModeState.points[type] : undefined}
                  pricePerK={servicePrices[type]?.pricePerK}
                  previewSchedule={previewSchedules[type]}
                />
              )
            ))}
          </div>
        </div>




        {/* Live Growth Chart - Real-time visualization (shown when not drawing) */}
        {!drawModeState.isEnabled && activeEngagementTypes.length > 0 && (
          <LiveGrowthChart
            engagements={engagements as Record<EngagementType, EngagementConfig>}
            refreshKey={previewRefreshKey}
            onRefresh={() => setPreviewRefreshKey(k => k + 1)}
            platform={platform as 'instagram' | 'tiktok' | 'youtube' | 'twitter' | 'facebook'}
          />
        )}

        {/* Delivery Timeline Preview - Detailed schedule */}
        {activeEngagementTypes.length > 0 && (
          <DeliveryPreview
            engagements={engagements as Record<EngagementType, EngagementConfig>}
            refreshKey={previewRefreshKey}
            platform={platform as 'instagram' | 'tiktok' | 'youtube' | 'twitter' | 'facebook'}
            customCurvePoints={drawModeState.isEnabled ? drawModeState.points : undefined}
            onScheduleChange={handleScheduleChange}
          />
        )}

        <Card className="glass-card border-2 border-primary/40 bg-gradient-to-br from-primary/5 via-transparent to-primary/10 overflow-hidden">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1 sm:space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl lg:text-4xl font-bold text-primary">{totalEngagements.toLocaleString()}</span>
                  <span className="text-muted-foreground text-xs sm:text-sm">engagements</span>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {Object.values(engagements).filter(e => e.enabled).length} types selected
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
                <Button
                  size="lg"
                  onClick={handlePlaceOrder}
                  disabled={!link.trim() || placeOrderMutation.isPending || bundlesLoading}
                  className="h-12 sm:h-14 px-6 sm:px-8 text-base sm:text-lg font-bold rounded-xl bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/25 transition-all duration-300"
                >
                  {placeOrderMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin mr-2" />
                      Processing...
                    </>
                  ) : bundlesLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin mr-2" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <Rocket className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                      Place Order
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

    </DashboardLayout>
  );
}
