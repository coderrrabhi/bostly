import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// ============================================
// SERVICE-SPECIFIC ORGANIC SCHEDULING v7.0
// Each engagement type has UNIQUE delivery patterns
// ============================================

type ServiceCategory =
  | 'views' | 'likes' | 'comments' | 'followers' | 'subscribers'
  | 'retweets' | 'shares' | 'saves' | 'watch_hours' | 'reposts' | 'generic'

interface OrganicServiceConfig {
  baseIntervalMinutes: number
  intervalVariance: number
  quantityVariancePercent: number
  spikeChance: number
  spikeMagnitude: [number, number]
  dipChance: number
  dipMagnitude: [number, number]
  burstChance: number
  pauseChance: number
  patternBreakerChance: number
  peakHourBoost: number
  nightReduction: number
  runsPerThousand: number
  minRunsPerOrder: number
  maxRunsPerOrder: number
  targetHumanScore: [number, number]
  defaultMinQty: number
}

interface ScheduledRunInput {
  run_number?: number
  scheduled_at: string
  quantity_to_send: number
  base_quantity?: number
  variance_applied?: number
  peak_multiplier?: number
}

function uniquifyScheduledRuns(
  runs: ScheduledRunInput[],
  totalTargetQty: number,
  providerMin: number,
  maxBatchCap: number
) {
  const normalizedRuns = runs
    .map((run, index) => ({
      run_number: index + 1,
      scheduled_at: new Date(run.scheduled_at).toISOString(),
      quantity_to_send: Math.max(0, Math.round(Number(run.quantity_to_send) || 0)),
      base_quantity: Math.max(0, Math.round(Number(run.base_quantity ?? run.quantity_to_send) || 0)),
      variance_applied: Number(run.variance_applied ?? 0),
      peak_multiplier: Number(run.peak_multiplier ?? 1),
      status: 'pending'
    }))
    .filter((run) => run.quantity_to_send > 0)

  const used = new Set<number>()

  normalizedRuns.forEach((run, index) => {
    const previous = index > 0 ? normalizedRuns[index - 1].quantity_to_send : null
    let candidate = run.quantity_to_send
    let fallback = candidate

    for (let step = 0; step <= Math.max(1, maxBatchCap - providerMin); step++) {
      const options = step === 0 ? [candidate] : [candidate + step, candidate - step]
      let applied = false

      for (const option of options) {
        if (option < providerMin || option > maxBatchCap) continue
        if (used.has(option)) continue
        if (previous !== null && Math.abs(option - previous) < 2) continue
        if (option % 5 === 0 && option !== providerMin) continue

        run.quantity_to_send = option
        run.base_quantity = option
        applied = true
        break
      }

      if (applied) break

      for (const option of options) {
        if (option < providerMin || option > maxBatchCap) continue
        if (used.has(option)) continue
        fallback = option
      }
    }

    run.quantity_to_send = fallback
    run.base_quantity = fallback
    used.add(run.quantity_to_send)
  })

  let drift = totalTargetQty - normalizedRuns.reduce((sum, run) => sum + run.quantity_to_send, 0)
  let guard = 0

  while (drift !== 0 && guard < 10000) {
    let changed = false
    const indexes = normalizedRuns
      .map((run, index) => ({ index, quantity: run.quantity_to_send }))
      .sort((a, b) => drift > 0 ? a.quantity - b.quantity : b.quantity - a.quantity)
      .map((item) => item.index)

    for (const index of indexes) {
      const step = drift > 0 ? 1 : -1
      const nextQty = normalizedRuns[index].quantity_to_send + step
      const previous = index > 0 ? normalizedRuns[index - 1].quantity_to_send : null

      if (nextQty < providerMin || nextQty > maxBatchCap) continue
      if (normalizedRuns.some((run, runIndex) => runIndex !== index && run.quantity_to_send === nextQty)) continue
      if (previous !== null && Math.abs(nextQty - previous) < 2) continue

      normalizedRuns[index].quantity_to_send = nextQty
      normalizedRuns[index].base_quantity = nextQty
      drift += drift > 0 ? -1 : 1
      changed = true

      if (drift === 0) break
    }

    if (!changed) break
    guard++
  }

  if (drift !== 0 && normalizedRuns.length > 0) {
    const lastRun = normalizedRuns[normalizedRuns.length - 1]
    lastRun.quantity_to_send = Math.max(providerMin, Math.min(maxBatchCap, lastRun.quantity_to_send + drift))
    lastRun.base_quantity = lastRun.quantity_to_send
  }

  return normalizedRuns
}

// COMPLETE SERVICE-SPECIFIC CONFIGS
const MAX_BATCH_CAPS: Record<string, number> = {
  views: 200, likes: 35, comments: 3, saves: 20, shares: 25,
  followers: 8, subscribers: 5, retweets: 35, reposts: 30,
  watch_hours: 1, story_views: 200, impressions: 300, reach: 250,
  profile_visits: 15, mentions: 3, quotes: 4, bookmarks: 25,
  favorites: 35, plays: 200, listens: 150, downloads: 5, generic: 50,
}

const MIN_INTERVAL_CAPS: Record<string, number> = {
  views: 25, likes: 40, comments: 90, saves: 55, shares: 75,
  followers: 150, subscribers: 180, retweets: 35, reposts: 42,
  watch_hours: 240, story_views: 20, impressions: 28, reach: 30,
  profile_visits: 65, mentions: 120, quotes: 95, bookmarks: 50,
  favorites: 45, plays: 22, listens: 28, downloads: 85, generic: 50,
}

const SERVICE_CONFIGS: Record<ServiceCategory, OrganicServiceConfig> = {
  views: {
    baseIntervalMinutes: 45, intervalVariance: 25, quantityVariancePercent: 55,
    spikeChance: 0.08, spikeMagnitude: [1.2, 1.5], dipChance: 0.20, dipMagnitude: [0.5, 0.8],
    burstChance: 0.05, pauseChance: 0.25, patternBreakerChance: 0.30,
    peakHourBoost: 1.3, nightReduction: 0.25, runsPerThousand: 20,
    minRunsPerOrder: 25, maxRunsPerOrder: 300, targetHumanScore: [85, 99], defaultMinQty: 100
  },
  likes: {
    baseIntervalMinutes: 85, intervalVariance: 45, quantityVariancePercent: 70,
    spikeChance: 0.04, spikeMagnitude: [1.1, 1.35], dipChance: 0.30, dipMagnitude: [0.35, 0.65],
    burstChance: 0.02, pauseChance: 0.35, patternBreakerChance: 0.40,
    peakHourBoost: 1.15, nightReduction: 0.15, runsPerThousand: 180, 
    minRunsPerOrder: 10, maxRunsPerOrder: 200, targetHumanScore: [88, 99], defaultMinQty: 10
  },
  comments: {
    baseIntervalMinutes: 150, intervalVariance: 80, quantityVariancePercent: 75,
    spikeChance: 0.03, spikeMagnitude: [1.1, 1.3], dipChance: 0.40, dipMagnitude: [0.4, 0.7],
    burstChance: 0.02, pauseChance: 0.50, patternBreakerChance: 0.40,
    peakHourBoost: 1.15, nightReduction: 0.10, runsPerThousand: 250,
    minRunsPerOrder: 15, maxRunsPerOrder: 150, targetHumanScore: [92, 99], defaultMinQty: 5
  },
  followers: {
    baseIntervalMinutes: 300, intervalVariance: 150, quantityVariancePercent: 65,
    spikeChance: 0.02, spikeMagnitude: [1.1, 1.3], dipChance: 0.35, dipMagnitude: [0.45, 0.7],
    burstChance: 0.01, pauseChance: 0.55, patternBreakerChance: 0.35,
    peakHourBoost: 1.1, nightReduction: 0.15, runsPerThousand: 80,
    minRunsPerOrder: 15, maxRunsPerOrder: 120, targetHumanScore: [92, 99], defaultMinQty: 10
  },
  subscribers: {
    baseIntervalMinutes: 360, intervalVariance: 180, quantityVariancePercent: 70,
    spikeChance: 0.01, spikeMagnitude: [1.1, 1.2], dipChance: 0.40, dipMagnitude: [0.5, 0.75],
    burstChance: 0.01, pauseChance: 0.60, patternBreakerChance: 0.40,
    peakHourBoost: 1.08, nightReduction: 0.10, runsPerThousand: 120,
    minRunsPerOrder: 12, maxRunsPerOrder: 100, targetHumanScore: [94, 99], defaultMinQty: 10
  },
  retweets: {
    baseIntervalMinutes: 70, intervalVariance: 38, quantityVariancePercent: 60,
    spikeChance: 0.08, spikeMagnitude: [1.2, 1.6], dipChance: 0.18, dipMagnitude: [0.45, 0.7],
    burstChance: 0.06, pauseChance: 0.22, patternBreakerChance: 0.28,
    peakHourBoost: 1.35, nightReduction: 0.22, runsPerThousand: 65,
    minRunsPerOrder: 18, maxRunsPerOrder: 150, targetHumanScore: [82, 97], defaultMinQty: 10
  },
  shares: {
    baseIntervalMinutes: 100, intervalVariance: 55, quantityVariancePercent: 65,
    spikeChance: 0.05, spikeMagnitude: [1.15, 1.4], dipChance: 0.28, dipMagnitude: [0.45, 0.7],
    burstChance: 0.03, pauseChance: 0.35, patternBreakerChance: 0.32,
    peakHourBoost: 1.2, nightReduction: 0.18, runsPerThousand: 250,
    minRunsPerOrder: 3, maxRunsPerOrder: 120, targetHumanScore: [88, 99], defaultMinQty: 10
  },
  saves: {
    baseIntervalMinutes: 110, intervalVariance: 60, quantityVariancePercent: 65,
    spikeChance: 0.04, spikeMagnitude: [1.15, 1.4], dipChance: 0.30, dipMagnitude: [0.45, 0.72],
    burstChance: 0.03, pauseChance: 0.38, patternBreakerChance: 0.30,
    peakHourBoost: 1.18, nightReduction: 0.15, runsPerThousand: 180,
    minRunsPerOrder: 2, maxRunsPerOrder: 100, targetHumanScore: [86, 98], defaultMinQty: 10
  },
  watch_hours: {
    baseIntervalMinutes: 480, intervalVariance: 240, quantityVariancePercent: 55,
    spikeChance: 0.01, spikeMagnitude: [1.05, 1.2], dipChance: 0.45, dipMagnitude: [0.55, 0.8],
    burstChance: 0.005, pauseChance: 0.65, patternBreakerChance: 0.25,
    peakHourBoost: 1.05, nightReduction: 0.30, runsPerThousand: 1000,
    minRunsPerOrder: 8, maxRunsPerOrder: 50, targetHumanScore: [95, 99], defaultMinQty: 1
  },
  reposts: {
    baseIntervalMinutes: 85, intervalVariance: 45, quantityVariancePercent: 60,
    spikeChance: 0.07, spikeMagnitude: [1.2, 1.5], dipChance: 0.22, dipMagnitude: [0.42, 0.68],
    burstChance: 0.05, pauseChance: 0.28, patternBreakerChance: 0.28,
    peakHourBoost: 1.28, nightReduction: 0.20, runsPerThousand: 120,
    minRunsPerOrder: 2, maxRunsPerOrder: 120, targetHumanScore: [84, 97], defaultMinQty: 10
  },
  generic: {
    baseIntervalMinutes: 80, intervalVariance: 45, quantityVariancePercent: 60,
    spikeChance: 0.05, spikeMagnitude: [1.15, 1.4], dipChance: 0.25, dipMagnitude: [0.45, 0.72],
    burstChance: 0.04, pauseChance: 0.32, patternBreakerChance: 0.30,
    peakHourBoost: 1.2, nightReduction: 0.20, runsPerThousand: 50,
    minRunsPerOrder: 2, maxRunsPerOrder: 150, targetHumanScore: [85, 98], defaultMinQty: 10
  }
}

const PROVIDER_MINIMUMS: Record<string, number> = {
  views: 100, likes: 10, comments: 10, saves: 10, shares: 10, followers: 10,
  subscribers: 10, retweets: 10, reposts: 10, watch_hours: 10,
}

const DAILY_PATTERNS: number[] = [
  0.3, 0.2, 0.1, 0.1, 0.15, 0.3,   // 0-5 AM
  0.5, 0.7, 0.9, 1.0, 1.1, 1.2,   // 6-11 AM
  1.0, 0.9, 0.8, 0.85, 0.9, 1.0,  // 12-5 PM
  1.3, 1.5, 1.6, 1.5, 1.2, 0.8,   // 6-11 PM
]

function getServiceConfig(engType: string): OrganicServiceConfig {
  return SERVICE_CONFIGS[engType as ServiceCategory] || SERVICE_CONFIGS.generic
}

const supabaseModule = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const KEY_SECRET = Deno.env.get('PROVIDER_KEY_SECRET') || ''

async function getProviderCryptoKey() {
  const raw = new TextEncoder().encode(KEY_SECRET)
  const hash = await crypto.subtle.digest('SHA-256', raw)
  return await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['decrypt'])
}

async function decryptProviderKey(payload: string): Promise<string> {
  if (!KEY_SECRET) throw new Error('PROVIDER_KEY_SECRET missing')
  const key = await getProviderCryptoKey()
  const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
  const iv = bytes.slice(0, 12)
  const ct = bytes.slice(12)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(plain)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    const supabase = supabaseModule
    const token = authHeader?.replace('Bearer ', '') || ''
    
    // Fix: Use getUser instead of getClaims
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      console.error('Auth error:', authError)
      return new Response(JSON.stringify({ error: authError?.message || 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const user_id = user.id

    // ============ BAN CHECK ============
    const { data: banRow } = await supabase
      .from('profiles')
      .select('is_banned, banned_reason')
      .eq('user_id', user_id)
      .maybeSingle()
    if ((banRow as any)?.is_banned) {
      return new Response(JSON.stringify({ error: 'Account suspended: ' + ((banRow as any).banned_reason || 'fraud') }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const body = await req.json()
    const { bundle_id, user_bundle_id, link, total_price, engagements, base_quantity } = body

    // ============ SERVER-SIDE PRICE RECOMPUTATION (anti-tamper) ============
    // NEVER trust client-supplied price. Recompute from services.price + global markup.
    if (!Array.isArray(engagements) || engagements.length === 0) {
      return new Response(JSON.stringify({ error: 'No engagements provided' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    let serverTotal = 0
    const isUserBundleOrder = Boolean(user_bundle_id)

    if (isUserBundleOrder) {
      const { data: userBundle, error: userBundleError } = await supabase
        .from('user_bundles')
        .select('id, user_id, is_active')
        .eq('id', user_bundle_id)
        .eq('user_id', user_id)
        .eq('is_active', true)
        .maybeSingle()

      if (userBundleError || !userBundle) {
        return new Response(JSON.stringify({ error: 'Your bundle was not found or is inactive' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const { data: bundleItems, error: bundleItemsError } = await supabase
        .from('user_bundle_items')
        .select('id, engagement_type, user_bundle_id, user_bundle_item_providers(id, enabled, priority, provider_service_id, user_provider_account_id)')
        .eq('user_bundle_id', user_bundle_id)
        .eq('user_id', user_id)

      if (bundleItemsError || !bundleItems?.length) {
        return new Response(JSON.stringify({ error: 'No engagement types found in your bundle' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const accountIds = new Set<string>()
      const providerServiceIds = new Set<string>()
      for (const item of bundleItems as any[]) {
        for (const mapping of item.user_bundle_item_providers || []) {
          if (mapping.enabled && mapping.user_provider_account_id && mapping.provider_service_id) {
            accountIds.add(mapping.user_provider_account_id)
            providerServiceIds.add(String(mapping.provider_service_id))
          }
        }
      }

      const { data: userServices } = accountIds.size && providerServiceIds.size
        ? await supabase
          .from('user_services')
          .select('id, user_provider_account_id, provider_service_id, rate, min_quantity, max_quantity, is_active')
          .eq('user_id', user_id)
          .eq('is_active', true)
          .in('user_provider_account_id', [...accountIds])
          .in('provider_service_id', [...providerServiceIds])
        : { data: [] as any[] }

      const serviceByKey = new Map<string, any>()
      for (const svc of userServices || []) {
        serviceByKey.set(`${svc.user_provider_account_id}:${svc.provider_service_id}`, svc)
      }

      for (const eng of engagements) {
        const qty = Math.max(0, Math.floor(Number(eng.quantity) || 0))
        if (qty <= 0) {
          return new Response(JSON.stringify({ error: 'Invalid quantity' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const bundleItem = (bundleItems as any[]).find((item: any) =>
          item.id === eng.user_bundle_item_id || item.engagement_type === eng.type
        )
        if (!bundleItem) {
          return new Response(JSON.stringify({ error: `Bundle item not found for ${eng.type}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const allowedMappings = new Map<string, any>()
        for (const mapping of bundleItem.user_bundle_item_providers || []) {
          if (!mapping.enabled || !mapping.provider_service_id || !mapping.user_provider_account_id) continue
          allowedMappings.set(`${mapping.user_provider_account_id}:${mapping.provider_service_id}`, mapping)
        }

        const requestedMappings = Array.isArray(eng.provider_mappings) ? eng.provider_mappings : []
        const sourceMappings = requestedMappings.length > 0 ? requestedMappings : [...allowedMappings.values()]
        const providerMappings = sourceMappings
          .map((mapping: any) => allowedMappings.get(`${mapping.user_provider_account_id}:${mapping.provider_service_id}`))
          .filter(Boolean)
          .sort((a: any, b: any) => Number(a.priority || 999) - Number(b.priority || 999))
          .map((mapping: any) => ({
            user_provider_account_id: mapping.user_provider_account_id,
            provider_service_id: String(mapping.provider_service_id),
            priority: Number(mapping.priority || 999),
          }))

        if (providerMappings.length === 0) {
          return new Response(JSON.stringify({ error: `${eng.type} has no active provider mapping. Please save Service IDs in My Bundles.` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const matchedServices = providerMappings
          .map((mapping: any) => serviceByKey.get(`${mapping.user_provider_account_id}:${mapping.provider_service_id}`))
          .filter(Boolean)
        const rateServices = matchedServices.filter((svc: any) => Number(svc.rate) > 0)
        const cheapest = rateServices.length > 0
          ? rateServices.reduce((a: any, b: any) => Number(a.rate) <= Number(b.rate) ? a : b)
          : matchedServices[0]
        const minValues = matchedServices.map((svc: any) => Number(svc.min_quantity || 0)).filter((n: number) => n > 0)
        const maxValues = matchedServices.map((svc: any) => Number(svc.max_quantity || 0)).filter((n: number) => n > 0)
        const providerMin = minValues.length > 0 ? Math.min(...minValues) : Math.max(PROVIDER_MINIMUMS[eng.type] || 0, getServiceConfig(eng.type).defaultMinQty)
        const providerMax = maxValues.length > 0 ? Math.max(...maxValues) : 0

        if (providerMin && qty < providerMin) {
          return new Response(JSON.stringify({ error: `${eng.type} quantity below provider minimum ${providerMin}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        if (providerMax && qty > providerMax) {
          return new Response(JSON.stringify({ error: `${eng.type} quantity above provider maximum ${providerMax}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const userPrice = cheapest ? (qty / 1000) * Number(cheapest.rate || 0) : 0
        eng.quantity = qty
        eng.price = Math.round(userPrice * 10000) / 10000
        eng.service_id = null
        eng.user_bundle_item_id = bundleItem.id
        eng.user_service_id = cheapest?.id || eng.user_service_id || null
        eng.user_provider_account_id = providerMappings[0]?.user_provider_account_id || null
        eng.provider_mappings = providerMappings
        eng.provider_min_quantity = providerMin
        serverTotal += eng.price
      }
    } else {
      const serviceIds = [...new Set(engagements.map((e: any) => e.service_id).filter(Boolean))]
      const { data: svcRows, error: svcErr } = await supabase
        .from('services')
        .select('id, price, min_quantity, max_quantity, is_active')
        .in('id', serviceIds)
      if (svcErr || !svcRows || svcRows.length !== serviceIds.length) {
        return new Response(JSON.stringify({ error: 'Invalid service in engagements' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const svcMap = new Map(svcRows.map((s: any) => [s.id, s]))
      const { data: ps } = await supabase.from('platform_settings').select('global_markup_percent').limit(1).maybeSingle()
      const markupPct = Number(ps?.global_markup_percent ?? 0)
      const markupMul = 1 + (markupPct / 100)

      const bundleItemPriceMap = new Map<string, number>()
      if (bundle_id) {
        const { data: biRows } = await supabase
          .from('bundle_items')
          .select('service_id, engagement_type, price_per_k')
          .eq('bundle_id', bundle_id)
        if (Array.isArray(biRows)) {
          for (const bi of biRows) {
            const ppk = Number(bi.price_per_k) || 0
            if (bi.service_id && ppk > 0) bundleItemPriceMap.set(bi.service_id as string, ppk)
          }
        }
      }

      for (const eng of engagements) {
        const svc = svcMap.get(eng.service_id) as any
        if (!svc || svc.is_active === false) {
          return new Response(JSON.stringify({ error: `Service unavailable: ${eng.service_id}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        const qty = Math.max(0, Math.floor(Number(eng.quantity) || 0))
        if (qty <= 0) {
          return new Response(JSON.stringify({ error: 'Invalid quantity' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        if (svc.min_quantity && qty < svc.min_quantity) {
          return new Response(JSON.stringify({ error: `Quantity below minimum for ${svc.id}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        if (svc.max_quantity && qty > svc.max_quantity) {
          return new Response(JSON.stringify({ error: `Quantity above maximum for ${svc.id}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        const effectivePricePerK = bundleItemPriceMap.get(eng.service_id) ?? Number(svc.price)
        const userPrice = (qty / 1000) * effectivePricePerK * markupMul
        eng.quantity = qty
        eng.price = Math.round(userPrice * 10000) / 10000
        serverTotal += eng.price
      }
    }
    serverTotal = Math.round(serverTotal * 10000) / 10000

    // Tolerate 1% client/server rounding drift, otherwise reject
    const clientTotal = Number(total_price) || 0
    if (clientTotal > 0 && Math.abs(clientTotal - serverTotal) / serverTotal > 0.01) {
      console.warn(`[anti-tamper] client total=${clientTotal} server total=${serverTotal} user=${user_id}`)
    }
    // Always use server-computed total — ignore client value entirely
    const safeTotalPrice = serverTotal

    // Wallet balance is not required — orders are fulfilled from the user's own provider account.

    // Check if bundle has AI Organic Mode enabled (default ON)
    let aiOrganicEnabled = true
    if (bundle_id && !isUserBundleOrder) {
      const { data: bundle } = await supabase.from('engagement_bundles').select('ai_organic_enabled').eq('id', bundle_id).single()
      if (bundle) aiOrganicEnabled = bundle.ai_organic_enabled ?? true
    }

    // Create order
    const { data: order, error: orderError } = await supabase.from('engagement_orders').insert({
      user_id,
      bundle_id: isUserBundleOrder ? null : bundle_id,
      user_bundle_id: isUserBundleOrder ? user_bundle_id : null,
      link,
      total_price: safeTotalPrice,
      base_quantity,
      is_organic_mode: true,
      status: 'processing'
    }).select().single()

    if (orderError || !order) return new Response(JSON.stringify({ error: `Failed to create order: ${orderError?.message || 'Unknown error'}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    // No wallet debit — cost is borne by the user's own provider account at the SMM provider.
    const newBalance = 0

    const createdItemIds: Array<{ type: string; itemId: string; engagement: any; finalServiceId: string | null }> = []
    for (const eng of engagements) {
      const { data: item } = await supabase.from('engagement_order_items').insert({
        engagement_order_id: order.id,
        engagement_type: eng.type,
        service_id: eng.service_id,
        user_service_id: eng.user_service_id || null,
        user_provider_account_id: eng.user_provider_account_id || null,
        user_bundle_item_id: eng.user_bundle_item_id || null,
        provider_mappings: eng.provider_mappings || null,
        quantity: eng.quantity,
        price: eng.price,
        status: 'pending'
      }).select().single()
      if (item) createdItemIds.push({ type: eng.type, itemId: item.id, engagement: eng, finalServiceId: eng.service_id })
    }

    const backgroundWork = async () => {
      const bgStart = Date.now()
      const orderTag = `[order=${order.order_number} oid=${order.id.slice(0,8)}]`
      const itemReport: Record<string, { attempts: number; lastError?: string; runsInserted: number; status: 'ok' | 'fallback' | 'failed' }> = {}
      console.log(`${orderTag} 🚀 Background scheduler started (items=${createdItemIds.length})`)
      try {
        const startTime = new Date()
        const detectPlatform = (url: string): string => {
          const l = url.toLowerCase()
          if (l.includes('instagram.com')) return 'instagram'
          if (l.includes('tiktok.com')) return 'tiktok'
          if (l.includes('youtube.com')) return 'youtube'
          if (l.includes('twitter.com') || l.includes('x.com')) return 'twitter'
          return 'generic'
        }
        const platform = detectPlatform(link)

        const PLATFORM_PRIORITIES: Record<string, number> = {
          views: 1, impressions: 1, plays: 1, watch_hours: 1, reach: 1,
          likes: 2, favorites: 2,
          comments: 3,
          saves: 4, bookmarks: 4,
          shares: 5, retweets: 5, reposts: 5,
          followers: 6, subscribers: 6,
          generic: 10
        }

        const platformStagger: Record<string, { base: number, variance: number }> = {
          views: { base: 0, variance: 0 },
          likes: { base: 45, variance: 30 },
          comments: { base: 90, variance: 60 },
          generic: { base: 30, variance: 30 }
        }

        const platformDailyPattern = DAILY_PATTERNS
        const sortedItems = [...createdItemIds].sort((a,b) => (PLATFORM_PRIORITIES[a.type] || 10) - (PLATFORM_PRIORITIES[b.type] || 10))

        let viewsStartTime: Date | null = null
        let viewsFirstRunScheduled = false
        let viewsEndTime: Date | null = null
        let viewsDurationMinutes = 0

        for (const { type: engType, itemId, engagement, finalServiceId } of sortedItems) {
         const itemTag = `${orderTag}[${engType} item=${itemId.slice(0,8)} qty=${engagement.quantity}]`
         itemReport[itemId] = { attempts: 0, runsInserted: 0, status: 'failed' }
         let lastErr: any = null
         // Retry the entire per-item scheduling up to 2 times on transient crashes.
         for (let attempt = 1; attempt <= 2; attempt++) {
         itemReport[itemId].attempts = attempt
         try {
           console.log(`${itemTag} ▶️ scheduling attempt ${attempt}`)
          const config = getServiceConfig(engType)
          let providerMin = config.defaultMinQty
          if (finalServiceId) {
            const { data: s } = await supabase.from('services').select('min_quantity').eq('id', finalServiceId).single()
            if (s?.min_quantity) providerMin = s.min_quantity
          }
          // Enforce platform minimum floors (e.g. views must be >= 100)
          const floorMin = PROVIDER_MINIMUMS[engType] || 0
          if (floorMin > 0) providerMin = Math.max(providerMin, floorMin)

          const isViewType = ['views', 'impressions', 'reach', 'plays', 'watch_hours'].includes(engType)
          const stagger = platformStagger[engType] || platformStagger.generic
          const priority = PLATFORM_PRIORITIES[engType] || 10

          let initialDelayMinutes = 0
          if (isViewType && !viewsFirstRunScheduled) {
            // Instant-feel start: first views run kicks off within ~1-2 minutes
            // (was 10-25 min — users complained it felt too slow).
            initialDelayMinutes = 0.5 + Math.random() * 1.5
            viewsStartTime = new Date(startTime.getTime() + initialDelayMinutes * 60 * 1000)
            viewsFirstRunScheduled = true
          } else if (viewsStartTime) {
            // Non-view types start shortly AFTER views start so they ramp together,
            // not all-at-once before views begin.
            const stepDelay = 5 + (priority - 1) * 8
            initialDelayMinutes = stepDelay + Math.random() * Math.min(stagger.variance, 15)
          } else {
            initialDelayMinutes = (priority - 1) * 60 + 20 + Math.random() * stagger.variance
          }

          let timeLimitHours = engagement.time_limit_hours || 0
          let peakHoursEnabled = engagement.peak_hours_enabled ?? false
          
          if (aiOrganicEnabled && timeLimitHours === 0) {
            const options = [0, 0, 0, 4, 6, 8, 12]
            timeLimitHours = options[Math.floor(Math.random() * options.length)]
          }

          // ORGANIC SYNC: Non-view engagements MUST span the same total window as views.
          // This prevents likes/saves/shares from finishing before views have arrived.
          if (!isViewType && viewsDurationMinutes > 0) {
            const viewsHours = viewsDurationMinutes / 60
            // Always match views window (override any auto time limit)
            timeLimitHours = Math.max(viewsHours, 0.25)
          }

          let baseInterval = config.baseIntervalMinutes
          let intervalRange = config.intervalVariance
          const baseMaxBatchCap = MAX_BATCH_CAPS[engType] || MAX_BATCH_CAPS.generic
          let maxBatchCap = Math.max(baseMaxBatchCap, Math.round(providerMin * 2.5))
          const minIntCap = MIN_INTERVAL_CAPS[engType] || MIN_INTERVAL_CAPS.generic

          let idealRuns = Math.round((engagement.quantity / 1000) * config.runsPerThousand)
          const maxPosForQty = Math.max(1, Math.floor(engagement.quantity / providerMin))
          const absoluteMaxRuns = Math.max(1, Math.floor(maxPosForQty * 0.8))
          
          let targetRuns: number
          let timeLimitApplied = false

          if (timeLimitHours > 0) {
            const totalMinutes = timeLimitHours * 60
            const availableMinutes = Math.max(30, totalMinutes - initialDelayMinutes)
            const maxPosRuns = Math.floor(availableMinutes / 5)
            
            let initialTarget = Math.min(maxPosRuns, Math.max(config.minRunsPerOrder, Math.min(config.maxRunsPerOrder, idealRuns)))
            // Clamp targetRuns first so baseInterval spans the entire time limit
            targetRuns = Math.min(initialTarget, absoluteMaxRuns)
            if (targetRuns < 2 && engagement.quantity >= providerMin * 2) targetRuns = 2
            
            const avgNeeded = Math.ceil(engagement.quantity / targetRuns)
            maxBatchCap = Math.max(maxBatchCap, Math.min(avgNeeded * 2, providerMin * 4))
            baseInterval = Math.max(5, availableMinutes / Math.max(targetRuns - 1, 1))
            intervalRange = baseInterval * 0.15
            timeLimitApplied = true
            console.log(`  ⏱️ ${engType}: ${timeLimitHours}h | Stagger ${Math.round(initialDelayMinutes)}m | Int ${baseInterval.toFixed(1)}m | Runs ${targetRuns}`)
          } else {
            targetRuns = Math.max(config.minRunsPerOrder, Math.ceil(engagement.quantity / maxBatchCap), Math.min(config.maxRunsPerOrder, idealRuns))
            targetRuns = Math.min(targetRuns, absoluteMaxRuns)
            if (targetRuns < 2 && engagement.quantity >= providerMin * 2) targetRuns = 2
          }

          const previewRuns = Array.isArray(engagement.scheduled_runs)
            ? (engagement.scheduled_runs as ScheduledRunInput[])
            : []

          let validatedEntries: any[] = []
          const totalTargetQty = engagement.quantity

          if (previewRuns.length > 0) {
            // ✅ Trust the client preview verbatim — user already saw and
            // approved exactly these timings + quantities. Do NOT re-roll
            // through uniquifyScheduledRuns (that mutated 100→101→102…).
            validatedEntries = previewRuns
              .map((r) => ({
                scheduled_at: new Date(r.scheduled_at).toISOString(),
                quantity_to_send: Math.max(0, Math.round(Number(r.quantity_to_send) || 0)),
                base_quantity: Math.max(0, Math.round(Number(r.base_quantity ?? r.quantity_to_send) || 0)),
                variance_applied: Number(r.variance_applied ?? 0),
                peak_multiplier: Number(r.peak_multiplier ?? 1),
              }))
              .filter((r) => r.quantity_to_send > 0)
              .map((r, idx) => ({
                engagement_order_item_id: itemId,
                run_number: idx + 1,
                scheduled_at: r.scheduled_at,
                quantity_to_send: r.quantity_to_send,
                base_quantity: r.base_quantity,
                variance_applied: r.variance_applied,
                peak_multiplier: r.peak_multiplier,
                status: 'pending'
              }))
          }

          if (validatedEntries.length === 0) {
            let remaining = engagement.quantity
            let currentTime: Date
            if (isViewType && viewsStartTime) currentTime = new Date(viewsStartTime.getTime())
            else if (viewsStartTime) currentTime = new Date(viewsStartTime.getTime() + initialDelayMinutes * 60 * 1000)
            else currentTime = new Date(startTime.getTime() + initialDelayMinutes * 60 * 1000)

            let runNumber = 1
            const scheduleEntries = []

            while (remaining > 0 && (!timeLimitApplied || runNumber <= targetRuns)) {
              const interval = (baseInterval + (Math.random() * 2 - 1) * intervalRange) * (timeLimitApplied ? 1 : (Math.random() < 0.2 ? 1.5 : 1))
              const scheduledAt = new Date(currentTime.getTime() + (Math.random() * 2 - 1) * 2 * 60 * 1000)
              if (scheduledAt < new Date(startTime.getTime() + 5*60*1000)) scheduledAt.setTime(startTime.getTime() + 5*60*1000)

              const istHour = new Date(scheduledAt.getTime() + 5.5*3600000).getUTCHours()
              const multiplier = peakHoursEnabled ? (platformDailyPattern[istHour] || 1) : (0.9 + Math.random()*0.2)
              
              const runsLeft = Math.max(1, targetRuns - runNumber + 1)
              let qty = Math.round((remaining / runsLeft) * (0.8 + Math.random() * 0.4) * multiplier)
              
              qty = Math.max(providerMin, Math.min(qty, remaining, maxBatchCap))

              // Soft warm-start: first run for views is a SMALL starter (~5% of total),
              // so the user sees a quick organic-looking burst instead of a huge spike.
              if (isViewType && runNumber === 1 && targetRuns > 1) {
                const starter = Math.max(providerMin, Math.ceil(engagement.quantity * 0.05))
                qty = Math.min(starter, remaining, maxBatchCap)
              }

              if (runNumber === targetRuns || remaining <= providerMin) {
                qty = remaining
              }

              if (!timeLimitApplied && runNumber > absoluteMaxRuns && remaining > 0) {
                qty = remaining
              }

              scheduleEntries.push({
                engagement_order_item_id: itemId,
                run_number: runNumber,
                scheduled_at: scheduledAt.toISOString(),
                quantity_to_send: qty,
                base_quantity: qty,
                status: 'pending'
              })

              remaining -= qty
              runNumber++
              currentTime = new Date(currentTime.getTime() + Math.max(5, interval) * 60000)
              if (runNumber > 1000) break
            }

            if (remaining > 0 && scheduleEntries.length > 0) {
              scheduleEntries[scheduleEntries.length - 1].quantity_to_send += remaining
              scheduleEntries[scheduleEntries.length - 1].base_quantity += remaining
            }
            
            let carry = 0
            validatedEntries = []

            for (let i = 0; i < scheduleEntries.length; i++) {
              const e = scheduleEntries[i]
              e.quantity_to_send += carry
              e.base_quantity = e.quantity_to_send
              carry = 0
              
              if (e.quantity_to_send < providerMin && i < scheduleEntries.length - 1) {
                carry = e.quantity_to_send
              } else {
                if (e.quantity_to_send > 0) validatedEntries.push(e)
              }
            }

            if (validatedEntries.length >= 2) {
              const lastEntry = validatedEntries[validatedEntries.length - 1]
              if (lastEntry.quantity_to_send < providerMin) {
                const prevEntry = validatedEntries[validatedEntries.length - 2]
                prevEntry.quantity_to_send += lastEntry.quantity_to_send
                prevEntry.base_quantity = prevEntry.quantity_to_send
                validatedEntries.pop()
              }
            }
            
            if (validatedEntries.length === 0 && totalTargetQty > 0) {
              validatedEntries.push({
                engagement_order_item_id: itemId,
                run_number: 1,
                scheduled_at: new Date(startTime.getTime() + 10 * 60 * 1000).toISOString(),
                quantity_to_send: Math.max(carry, totalTargetQty),
                base_quantity: Math.max(carry, totalTargetQty),
                status: 'pending'
              })
            }
            
            validatedEntries.forEach((e, i) => e.run_number = i + 1)

            {
              const scheduledSum = validatedEntries.reduce((s, r) => s + r.quantity_to_send, 0)
              const shortfall = totalTargetQty - scheduledSum
              if (shortfall >= providerMin && validatedEntries.length > 0) {
                const perRun = Math.max(providerMin, Math.min(maxBatchCap, Math.ceil(shortfall / Math.max(5, Math.ceil(shortfall / maxBatchCap)))))
                const extraRuns = Math.max(1, Math.ceil(shortfall / perRun))
                const lastTime = new Date(validatedEntries[validatedEntries.length - 1].scheduled_at).getTime()
                let leftover = shortfall
                for (let k = 0; k < extraRuns && leftover > 0; k++) {
                  const qty = (k === extraRuns - 1) ? leftover : Math.min(perRun, leftover)
                  if (qty <= 0) break
                  const t = new Date(lastTime + (k + 1) * (baseInterval * 60 * 1000) + (Math.random() * 2 - 1) * 60 * 1000)
                  validatedEntries.push({
                    engagement_order_item_id: itemId,
                    run_number: validatedEntries.length + 1,
                    scheduled_at: t.toISOString(),
                    quantity_to_send: qty,
                    base_quantity: qty,
                    status: 'pending'
                  })
                  leftover -= qty
                }
                console.log(`🛟 [${engType}] Top-up: scheduled ${scheduledSum}/${totalTargetQty}, added ${extraRuns} runs for shortfall ${shortfall}`)
              }
            }
            validatedEntries.forEach((e, i) => e.run_number = i + 1)
          }

          if (validatedEntries.length > 0) {
            const { error: schedErr } = await supabase.from('organic_run_schedule').insert(validatedEntries)
            if (schedErr) {
               console.error(`${itemTag} ❌ Insert error (attempt ${attempt}):`, schedErr.message)
               itemReport[itemId].lastError = `insert: ${schedErr.message}`
               throw new Error(schedErr.message)
            } else {
               const scheduledSum = validatedEntries.reduce((s, r) => s + r.quantity_to_send, 0)
               console.log(`${itemTag} ✅ Scheduled ${validatedEntries.length} runs (sum=${scheduledSum}/${totalTargetQty}) in ${Date.now()-bgStart}ms`)
               itemReport[itemId].runsInserted = validatedEntries.length
               itemReport[itemId].status = 'ok'
            }
            // Capture the views window so non-view types can mirror it
            if (isViewType && !viewsEndTime) {
              const lastAt = validatedEntries.reduce((max, e) => {
                const t = new Date(e.scheduled_at).getTime()
                return t > max ? t : max
              }, 0)
              if (lastAt > 0) {
                viewsEndTime = new Date(lastAt)
                viewsDurationMinutes = Math.max(0, (lastAt - startTime.getTime()) / 60000)
              }
            }
          } else {
            console.warn(`${itemTag} ⚠️ No schedule entries created (qty=${totalTargetQty}) — will rely on fallback`)
            itemReport[itemId].lastError = 'no entries produced'
          }
           break // success path, exit retry loop
         } catch (itemErr: any) {
           lastErr = itemErr
           itemReport[itemId].lastError = itemErr?.message || String(itemErr)
           console.error(`${itemTag} ❌ attempt ${attempt} crashed:`, itemErr?.message || itemErr, itemErr?.stack ? `\n${itemErr.stack}` : '')
           if (attempt < 2) {
             await new Promise(r => setTimeout(r, 500 * attempt))
             continue
           }
         }
         }
         if (lastErr) console.error(`${itemTag} 🛑 all retries exhausted — safety net will create fallback run`)
        }

        // SAFETY NET: Ensure every item got at least one scheduled run.
        // If scheduling crashed/skipped for any item, create a single fallback
        // run so the engagement actually gets delivered (not silently lost).
        const fallbackCreated: Array<{ type: string; itemId: string; qty: number }> = []
        for (const { type: engType, itemId, engagement } of createdItemIds) {
          let attempted = 0
          let inserted = false
          while (attempted < 3 && !inserted) {
            attempted++
            try {
              const { count, error: cntErr } = await supabase
                .from('organic_run_schedule')
                .select('id', { count: 'exact', head: true })
                .eq('engagement_order_item_id', itemId)
              if (cntErr) throw cntErr
              if ((count ?? 0) > 0) { inserted = true; break }
              if (engagement.quantity <= 0) { inserted = true; break }
              const fallbackAt = new Date(Date.now() + (5 + Math.random() * 10) * 60 * 1000).toISOString()
              const { error: fbErr } = await supabase.from('organic_run_schedule').insert([{
                engagement_order_item_id: itemId,
                run_number: 1,
                scheduled_at: fallbackAt,
                quantity_to_send: engagement.quantity,
                base_quantity: engagement.quantity,
                status: 'pending',
              }])
              if (fbErr) throw fbErr
              console.warn(`${orderTag}[${engType}] 🛟 Fallback run created (qty=${engagement.quantity}, attempt ${attempted})`)
              itemReport[itemId] = { ...(itemReport[itemId] || { attempts: 0, runsInserted: 0, status: 'failed' }), runsInserted: 1, status: 'fallback' }
              fallbackCreated.push({ type: engType, itemId, qty: engagement.quantity })
              inserted = true
            } catch (sErr: any) {
              console.error(`${orderTag}[${engType}] safety-net attempt ${attempted} failed:`, sErr?.message || sErr)
              if (attempted < 3) await new Promise(r => setTimeout(r, 750 * attempted))
            }
          }
          if (!inserted) {
            console.error(`${orderTag}[${engType}] 🚨 SAFETY NET FAILED — item ${itemId} has NO runs after retries`)
          }
        }

        // Final summary log — easy to grep later.
        const totalMs = Date.now() - bgStart
        const summaryLines = createdItemIds.map(c => {
          const r = itemReport[c.itemId] || { attempts: 0, runsInserted: 0, status: 'failed' as const }
          return `  • ${c.type}(qty=${c.engagement.quantity}) → ${r.status} runs=${r.runsInserted} attempts=${r.attempts}${r.lastError ? ` err="${r.lastError}"` : ''}`
        }).join('\n')
        console.log(`${orderTag} 📊 Scheduler finished in ${totalMs}ms\n${summaryLines}`)

        // Telegram alert when any fallback fired or any item failed entirely.
        const failed = createdItemIds.filter(c => (itemReport[c.itemId]?.runsInserted ?? 0) === 0)
        if (fallbackCreated.length > 0 || failed.length > 0) {
          try {
            await supabase.functions.invoke('send-telegram-notification', {
              body: {
                message: `⚠️ <b>Scheduler recovery</b>\nOrder <code>#${order.order_number}</code>\nFallbacks: <b>${fallbackCreated.length}</b> | Failed: <b>${failed.length}</b>\n<pre>${summaryLines.replace(/</g,'&lt;')}</pre>`,
                parse_mode: 'HTML',
              },
            })
          } catch (tgErr: any) {
            console.error(`${orderTag} Telegram alert failed:`, tgErr?.message || tgErr)
          }
        }

        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/execute-all-runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
          body: JSON.stringify({ instant: true, order_id: order.id })
        }).catch(() => {})
      } catch (err: any) {
        console.error(`${orderTag} 💥 Background fatal error:`, err?.message || err, err?.stack ? `\n${err.stack}` : '')
      }
    }

    if (typeof (globalThis as any).EdgeRuntime !== 'undefined' && (globalThis as any).EdgeRuntime.waitUntil) {
      (globalThis as any).EdgeRuntime.waitUntil(backgroundWork())
    } else {
      backgroundWork()
    }

    return new Response(JSON.stringify({ success: true, order_id: order.id, new_balance: newBalance }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error) {
    console.error('Error:', error)
      return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
