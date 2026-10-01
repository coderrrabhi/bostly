import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000
const MAX_RUN_RETRIES = 9999
const ACTIVE_ORDER_RETRY_MS = 60 * 1000
const TEMPORARY_RETRY_MS = 60 * 1000
const MAX_RUNS_PER_ITEM_PER_INVOCATION = 25
// Wall-clock slice for the dispatch loop (edge runtime allows ~150s).
const DISPATCH_TIME_BUDGET_MS = 100_000

function getRunProviderAccountId(run: any): string | null {
  return run?.provider_account_id || run?.user_provider_account_id || null
}

function getRunProviderAccountName(run: any): string | null {
  return run?.provider_account_name || run?.user_provider_account_name || null
}

// Inline status-check cache for this execution (avoids re-polling same account row).
const inlineProviderAccountCache = new Map<string, { api_key: string; api_url: string } | null>()
const TERMINAL_PROVIDER_STATUSES = new Set([
  'completed','complete','partial','refunded','canceled','cancelled','error','failed','success','refund','canscelled',
])

async function inlineRefreshRunStatus(supabase: SupabaseClient, run: any): Promise<any> {
  try {
    const effectiveAccountId = getRunProviderAccountId(run)
    if (!run?.provider_order_id || !effectiveAccountId) return run
    const lastCheck = run.last_status_check ? new Date(run.last_status_check).getTime() : 0
    // Only re-poll if we haven't checked in the last 25s (cron is every 1-2min, this is the inline safety net)
    if (Date.now() - lastCheck < 25_000) return run
    const curStatus = (run.provider_status || '').toLowerCase()
    if (TERMINAL_PROVIDER_STATUSES.has(curStatus)) return run

    const isUserOwned = !!run.user_provider_account_id
    const cacheKey = `${isUserOwned ? 'user' : 'admin'}:${effectiveAccountId}`
    let acct = inlineProviderAccountCache.get(cacheKey)
    if (acct === undefined) {
      if (isUserOwned) {
        const { data } = await supabase
          .from('user_provider_accounts')
          .select('id, api_key_ciphertext, api_url')
          .eq('id', effectiveAccountId)
          .maybeSingle()
        if (data?.api_key_ciphertext && data?.api_url) {
          const apiKey = await getUserProviderKey(data.id, data.api_key_ciphertext)
          acct = { api_key: apiKey, api_url: data.api_url }
        } else {
          acct = null
        }
      } else {
        const { data } = await supabase
          .from('provider_accounts')
          .select('api_key, api_url')
          .eq('id', effectiveAccountId)
          .maybeSingle()
        acct = data && data.api_key && data.api_url ? { api_key: data.api_key, api_url: data.api_url } : null
      }
      inlineProviderAccountCache.set(cacheKey, acct)
    }
    if (!acct) return run

    const formData = new URLSearchParams()
    formData.append('key', acct.api_key)
    formData.append('action', 'status')
    formData.append('order', String(run.provider_order_id))

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)
    let result: any
    try {
      const response = await fetch(acct.api_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
        signal: controller.signal,
      })
      const txt = await response.text()
      try { result = JSON.parse(txt) } catch { result = { error: txt } }
    } finally {
      clearTimeout(timeoutId)
    }

    if (!result || result.error) return run

    const providerStatus = result.status || result.Status || run.provider_status
    const remains = result.remains !== undefined ? Number(result.remains) : run.provider_remains
    const startCount = result.start_count !== undefined ? Number(result.start_count) : run.provider_start_count
    const charge = result.charge !== undefined ? Number(result.charge) : run.provider_charge

    await supabase.from('organic_run_schedule').update({
      provider_status: providerStatus,
      provider_remains: Number.isFinite(remains) ? remains : run.provider_remains,
      provider_start_count: Number.isFinite(startCount) ? startCount : run.provider_start_count,
      provider_charge: Number.isFinite(charge) ? charge : run.provider_charge,
      last_status_check: new Date().toISOString(),
    }).eq('id', run.id)

    return {
      ...run,
      provider_status: providerStatus,
      provider_remains: Number.isFinite(remains) ? remains : run.provider_remains,
      provider_start_count: Number.isFinite(startCount) ? startCount : run.provider_start_count,
      provider_charge: Number.isFinite(charge) ? charge : run.provider_charge,
      last_status_check: new Date().toISOString(),
    }
  } catch (_e) {
    return run
  }
}

// Substrings (lowercase) that indicate the provider rejected the order because
// another order for the same link is still active/processing on their side.
const ACTIVE_ORDER_PATTERNS = [
  'active order', 'wait until order', 'already has an order',
  'order in progress', 'in progress', 'link currently active',
  'processing previous order', 'wait for completion',
  'same link', 'cannot start a new order', 'active processing',
  'active processing order', 'duplicate order', 'duplicate link',
  'link is being processed', 'link is processing',
]

function isActiveOrderErrorMsg(msg: string | null | undefined): boolean {
  if (!msg) return false
  const m = msg.toLowerCase()
  return ACTIVE_ORDER_PATTERNS.some(p => m.includes(p))
}

const TEMPORARY_ERRORS = [
  'balance', 'not have enough', 'processing another transaction',
  'rate limit', 'timeout', 'temporarily', 'too many requests',
  ...ACTIVE_ORDER_PATTERNS,
]

const ACCOUNT_SPECIFIC_ERRORS = [
  'invalid api key', 'api key not found', 'invalid key',
  'unauthorized', 'authentication failed', 'wrong api key', 'api key invalid',
]

const TRY_NEXT_PROVIDER_ERRORS = [
  'quantity less than minimal', 'quantity less than minimum', 'min quantity',
  'minimum order', 'minimum quantity', 'max quantity', 'maximum quantity',
  'quantity more than maximum', 'service not found', 'incorrect service',
  'invalid service', 'service unavailable', 'service is not available',
  'disabled', 'not work', 'maintenance', 'down',
]

interface ProviderAccount {
  id: string
  provider_id: string
  name: string
  api_key: string
  api_url: string
  priority: number
  is_active: boolean
  last_used_at: string | null
  delivery_multiplier?: number | null
}

interface ServiceMapping {
  id: string
  service_id: string
  provider_account_id: string
  provider_service_id: string
  sort_order: number
  is_active: boolean
  provider_account: ProviderAccount
}

type ProviderCandidate = {
  account: ProviderAccount
  providerServiceId: string
  minQuantity: number
  sortOrder: number
}

// Module-level caches
const balanceCache = new Map<string, { balance: number; checkedAt: number }>()

const supabaseModule = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

// ==========================================
// OPTIMIZED: Per-invocation mapping cache
// Avoids repeated DB queries for same service
// ==========================================
class MappingCache {
  private cache = new Map<string, ProviderCandidate[]>()
  private configuredMapping = new Map<string, boolean>()
  
  async getForService(supabase: any, serviceId: string, excludeIds: string[], executionId: string): Promise<ProviderCandidate[]> {
    // Fetch once per service per invocation
    if (!this.cache.has(serviceId)) {
      const { data: mappings, error } = await supabase
        .from('service_provider_mapping')
        .select(`*, provider_account:provider_accounts(*)`)
        .eq('service_id', serviceId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      
      this.configuredMapping.set(serviceId, Boolean(!error && mappings && mappings.length > 0))

      if (error || !mappings || mappings.length === 0) {
        this.cache.set(serviceId, [])
      } else {
        const sorted = [...mappings].sort((a: any, b: any) => {
          // STRICT priority ASC only — no last_used_at / health tiebreak.
          const aPriority = a.sort_order || 0
          const bPriority = b.sort_order || 0
          return aPriority - bPriority
        })

        
        // Fetch each provider-service min_quantity from services table (by provider_service_id + provider_id)
        const providerServiceIds = sorted
          .map((m: any) => m.provider_service_id)
          .filter(Boolean)
        const accountIds = sorted
          .map((m: any) => m.provider_account?.id)
          .filter(Boolean)
        const minByKey = new Map<string, number>()
        if (providerServiceIds.length > 0 && accountIds.length > 0) {
          const { data: providerSvcRows } = await supabase
            .from('services')
            .select('provider_service_id, provider_id, min_quantity')
            .in('provider_service_id', providerServiceIds)
          if (providerSvcRows) {
            for (const row of providerSvcRows as any[]) {
              minByKey.set(`${row.provider_id}:${row.provider_service_id}`, Number(row.min_quantity || 0))
            }
          }
        }

        const accounts: ProviderCandidate[] = []
        for (const mapping of sorted) {
          const account = mapping.provider_account as ProviderAccount
          if (account && account.is_active && isValidHttpUrl(account.api_url)) {
            const key = `${account.provider_id}:${mapping.provider_service_id}`
            accounts.push({
              account,
              providerServiceId: mapping.provider_service_id,
              minQuantity: minByKey.get(key) || 0,
              sortOrder: Number(mapping.sort_order || 999),
            })
          } else if (account && account.is_active && !isValidHttpUrl(account.api_url)) {
            console.log(`⚠️ Skipping provider ${account.name}: invalid api_url`)
          }
        }
        this.cache.set(serviceId, accounts)
      }
    }
    
    // Return filtered copy (excluding busy accounts)
    const all = this.cache.get(serviceId) || []
    return all.filter(a => !excludeIds.includes(a.account.id))
  }
  
  hasAnyForService(serviceId: string): boolean {
    return (this.cache.get(serviceId) || []).length > 0
  }

  hasConfiguredMappingForService(serviceId: string): boolean {
    return this.configuredMapping.get(serviceId) === true
  }
}

// ==========================================
// USER-PROVIDER PATH (multi-tenant)
// Resolves runs whose engagement_order_items row uses user_bundle_item_id
// (i.e. the order was placed against the user's own SMM panel key stored in
// user_provider_accounts, not the platform admin's provider_accounts).
// ==========================================
const PROVIDER_KEY_SECRET = Deno.env.get('PROVIDER_KEY_SECRET') || ''
let _upKeyPromise: Promise<CryptoKey> | null = null
async function _getUpKey(): Promise<CryptoKey> {
  if (!_upKeyPromise) {
    _upKeyPromise = (async () => {
      const raw = new TextEncoder().encode(PROVIDER_KEY_SECRET)
      const hash = await crypto.subtle.digest('SHA-256', raw)
      return await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['decrypt'])
    })()
  }
  return _upKeyPromise
}
export async function decryptUserApiKey(payload: string): Promise<string> {
  const key = await _getUpKey()
  const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
  const iv = bytes.slice(0, 12)
  const ct = bytes.slice(12)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(plain)
}

// Cache decrypted keys per invocation to avoid repeated crypto work.
const _userKeyCache = new Map<string, string>()
async function getUserProviderKey(accountId: string, ciphertext: string): Promise<string> {
  const cached = _userKeyCache.get(accountId)
  if (cached) return cached
  const plain = await decryptUserApiKey(ciphertext)
  _userKeyCache.set(accountId, plain)
  return plain
}

class UserMappingCache {
  private cache = new Map<string, ProviderCandidate[]>()
  private configured = new Map<string, boolean>()

  async getForBundleItem(supabase: any, bundleItemId: string, excludeIds: string[]): Promise<ProviderCandidate[]> {
    if (!this.cache.has(bundleItemId)) {
      // Fetch mappings + joined user_provider_accounts (with encrypted key)
      const { data: mappings, error } = await supabase
        .from('user_bundle_item_providers')
        .select(`
          id, priority, enabled, provider_service_id, user_provider_account_id,
          user_provider_account:user_provider_accounts(
            id, user_id, name, api_url, api_key_ciphertext, is_active
          )
        `)
        .eq('user_bundle_item_id', bundleItemId)
        .eq('enabled', true)
        .order('priority', { ascending: true })

      if (error || !mappings || mappings.length === 0) {
        this.configured.set(bundleItemId, false)
        this.cache.set(bundleItemId, [])
      } else {
        this.configured.set(bundleItemId, true)

        // Fetch min_quantity from user_services keyed by (account_id, provider_service_id)
        const accountIds = [...new Set(mappings.map((m: any) => m.user_provider_account_id).filter(Boolean))]
        const providerServiceIds = [...new Set(mappings.map((m: any) => String(m.provider_service_id)).filter(Boolean))]
        const minByKey = new Map<string, number>()
        if (accountIds.length && providerServiceIds.length) {
          const { data: svcRows } = await supabase
            .from('user_services')
            .select('user_provider_account_id, provider_service_id, min_quantity')
            .in('user_provider_account_id', accountIds)
            .in('provider_service_id', providerServiceIds)
          for (const row of (svcRows || []) as any[]) {
            minByKey.set(`${row.user_provider_account_id}:${row.provider_service_id}`, Number(row.min_quantity || 0))
          }
        }

        const accounts: ProviderCandidate[] = []
        for (const m of mappings as any[]) {
          const upa = m.user_provider_account
          if (!upa || !upa.is_active || !isValidHttpUrl(upa.api_url) || !upa.api_key_ciphertext) continue
          let plainKey = ''
          try {
            plainKey = await getUserProviderKey(upa.id, upa.api_key_ciphertext)
          } catch (e) {
            console.error(`Failed to decrypt user key for account ${upa.id}:`, e)
            continue
          }
          const account: ProviderAccount = {
            id: upa.id,
            provider_id: `user:${upa.user_id}`,
            name: upa.name || 'User provider',
            api_key: plainKey,
            api_url: upa.api_url,
            priority: Number(m.priority || 999),
            is_active: true,
            last_used_at: null,
            delivery_multiplier: 1,
            // @ts-ignore custom marker used downstream
            isUserOwned: true,
            // @ts-ignore
            user_id: upa.user_id,
          } as any
          accounts.push({
            account,
            providerServiceId: String(m.provider_service_id),
            minQuantity: minByKey.get(`${upa.id}:${String(m.provider_service_id)}`) || 0,
            sortOrder: Number(m.priority || 999),
          })
        }
        this.cache.set(bundleItemId, accounts)
      }
    }
    const all = this.cache.get(bundleItemId) || []
    return all.filter(a => !excludeIds.includes(a.account.id))
  }

  hasConfigured(bundleItemId: string): boolean {
    return this.configured.get(bundleItemId) === true
  }
}



async function checkProviderBalance(account: ProviderAccount): Promise<{ hasBalance: boolean; balance: number }> {
  if (!isValidHttpUrl(account.api_url)) {
    console.log(`⚠️ Balance check skipped for ${account.name}: invalid api_url`)
    return { hasBalance: false, balance: 0 }
  }

  const cached = balanceCache.get(account.id)
  if (cached && Date.now() - cached.checkedAt < 30000) {
    return { hasBalance: cached.balance > 0, balance: cached.balance }
  }

  try {
    const formData = new URLSearchParams()
    formData.append('key', account.api_key)
    formData.append('action', 'balance')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(account.api_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    const responseText = await response.text()

    let result
    try { result = JSON.parse(responseText) } catch {
      return { hasBalance: true, balance: -1 }
    }

    const balance = parseFloat(result.balance || result.funds || result.amount || '0')
    balanceCache.set(account.id, { balance, checkedAt: Date.now() })
    console.log(`💰 ${account.name} balance: ${balance}`)
    return { hasBalance: balance > 0, balance }
  } catch (error) {
    return { hasBalance: true, balance: -1 }
  }
}

async function updateAccountLastUsed(supabase: any, accountId: string) {
  await supabase
    .from('provider_accounts')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', accountId)
}

async function claimRunLock(params: {
  supabase: any
  runId: string
  expectedStatus: 'pending' | 'failed'
  maxScheduledAt?: string
  updates: Record<string, any>
}) {
  let query = params.supabase
    .from('organic_run_schedule')
    .update(params.updates)
    .eq('id', params.runId)
    .eq('status', params.expectedStatus)

  if (params.maxScheduledAt) {
    query = query.lte('scheduled_at', params.maxScheduledAt)
  }

  const { data, error } = await query
    .select('id, status')
    .maybeSingle()

  return {
    error,
    locked: !!data,
    row: data,
  }
}

function hasUncertainDispatch(row: any) {
  const message = (row?.error_message || '').toLowerCase()
  if (message.includes('[dispatch uncertain]') || message.includes('[awaiting provider confirmation]')) {
    return true
  }

  return Boolean(
    row?.provider_response &&
    typeof row.provider_response === 'object' &&
    row.provider_response.uncertain_dispatch === true,
  )
}

type ProviderStatusCheckResult =
  | { ok: true; data: any; rawText: string }
  | { ok: false; error: string; rawText: string }

async function checkProviderOrderStatusWithRetries(params: {
  apiUrl: string; apiKey: string; providerOrderId: string;
  maxAttempts?: number; attemptDelayMs?: number;
}): Promise<ProviderStatusCheckResult> {
  const maxAttempts = params.maxAttempts ?? 3
  const attemptDelayMs = params.attemptDelayMs ?? 2000

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const formData = new URLSearchParams()
    formData.append('key', params.apiKey)
    formData.append('action', 'status')
    formData.append('order', params.providerOrderId)

    let rawText = ''
    try {
      const response = await fetch(params.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      })
      rawText = await response.text()

      let result: any
      try { result = JSON.parse(rawText) } catch { result = { error: rawText } }

      if (result?.error || result?.status === 'fail') {
        const err = (result?.message || result?.error || 'Provider status error')?.toString()
        const retryableNotFound = err.toLowerCase().includes('not found') ||
          err.toLowerCase().includes('incorrect order') || err.toLowerCase().includes('wrong order')

        if (retryableNotFound && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, attemptDelayMs))
          continue
        }
        return { ok: false, error: err, rawText }
      }
      return { ok: true, data: result, rawText }
    } catch (e: any) {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attemptDelayMs))
        continue
      }
      return { ok: false, error: `Network error: ${e?.message || 'Unknown'}`, rawText }
    }
  }
  return { ok: false, error: 'Unknown provider status error', rawText: '' }
}

const detectPlatformFromLink = (url: string): string | null => {
  const lower = url.toLowerCase()
  if (lower.includes('instagram.com') || lower.includes('instagr.am')) return 'instagram'
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube'
  if (lower.includes('tiktok.com')) return 'tiktok'
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter'
  if (lower.includes('facebook.com') || lower.includes('fb.com')) return 'facebook'
  return null
}

const detectPlatformFromService = (serviceName: string): string | null => {
  const lower = serviceName.toLowerCase()
  if (lower.includes('instagram') || lower.includes('ig ')) return 'instagram'
  if (lower.includes('youtube') || lower.includes('yt ')) return 'youtube'
  if (lower.includes('tiktok') || lower.includes('tt ')) return 'tiktok'
  if (lower.includes('twitter') || lower.includes('x ')) return 'twitter'
  if (lower.includes('facebook') || lower.includes('fb ')) return 'facebook'
  return null
}

const isValidUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

const isValidHttpUrl = (value?: string | null) => {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const normalizeLink = (value?: string | null) => (value || '').toLowerCase().trim().replace(/\/$/, '')

function isZeroDeliveryProviderFailure(run: any) {
  const message = (run?.error_message || '').toLowerCase()
  const status = (run?.provider_status || '').toLowerCase()
  const qty = Number(run?.quantity_to_send || 0)
  const remains = typeof run?.provider_remains === 'number' ? run.provider_remains : Number(run?.provider_remains || 0)
  const startCount = typeof run?.provider_start_count === 'number' ? run.provider_start_count : Number(run?.provider_start_count || 0)

  return Boolean(
    run?.provider_order_id &&
    qty > 0 &&
    (message.includes('0 delivered') || message.includes('auto-retry')) &&
    (status.includes('pending') || status.includes('progress') || status.includes('processing') || status.includes('unknown')) &&
    remains >= qty &&
    startCount <= 0,
  )
}

function providerNameLooksUnhealthy(name?: string | null) {
  const normalized = (name || '').toLowerCase().trim()
  return ['justyoy', 'firgip', 'goup'].includes(normalized)
}

// Strip Instagram/social tracking params (igsh, igshid, utm_*, si, feature, etc.)
// Some SMM providers fail silently or refuse to deliver when the link contains
// share/tracking query strings — sending the clean canonical URL fixes this.
const sanitizeProviderLink = (raw?: string | null): string => {
  const link = (raw || '').trim()
  if (!link) return ''
  try {
    const u = new URL(link)
    const stripKeys = ['igsh', 'igshid', 'si', 'feature', 'fbclid', 'gclid', 'mc_cid', 'mc_eid']
    const keys = Array.from(u.searchParams.keys())
    for (const k of keys) {
      if (stripKeys.includes(k.toLowerCase()) || k.toLowerCase().startsWith('utm_')) {
        u.searchParams.delete(k)
      }
    }
    let out = u.origin + u.pathname.replace(/\/+$/, '/') 
    const qs = u.searchParams.toString()
    if (qs) out += '?' + qs
    return out
  } catch {
    return link
  }
}

const isTerminalProviderStatus = (status?: string | null) => {
  const normalized = (status || '').toLowerCase().trim()
  return ['completed', 'complete', 'partial', 'refunded', 'canceled', 'cancelled', 'error', 'failed', 'success', 'refund', 'canscelled'].includes(normalized)
}

const isActiveProviderStatus = (status?: string | null) => {
  const normalized = (status || '').toLowerCase().trim()
  return ['pending', 'in progress', 'processing', 'processing order', 'inprogress', 'awaiting'].includes(normalized)
}

const isFailedProviderStatus = (status?: string | null) => {
  const normalized = (status || '').toLowerCase().trim()
  return ['refunded', 'canceled', 'cancelled', 'error', 'failed', 'refund', 'canscelled'].includes(normalized)
}

const getNestedEngagementOrderLink = (value: any) => {
  if (Array.isArray(value)) {
    return getNestedEngagementOrderLink(value[0])
  }
  if (value?.engagement_order) {
    return getNestedEngagementOrderLink(value.engagement_order)
  }
  return value?.link || ''
}

const calculateObservedRunDelivery = (run: any) => {
  const providerStatus = (run?.provider_status || '').toString().toLowerCase().trim()

  if (providerStatus === 'completed' || providerStatus === 'complete' || providerStatus === 'success') {
    return Number(run?.quantity_to_send || 0)
  }

  if (run?.provider_remains !== null && run?.provider_remains !== undefined) {
    return Math.max(0, Number(run?.quantity_to_send || 0) - Number(run?.provider_remains || 0))
  }

  return 0
}

// Configurable under-delivery buffer for publicCountDelta.
// Organic (real) viewers can inflate the post's public view count and trick
// the over-delivery guard into stopping orders too early. To absorb that
// genuine growth, we discount publicCountDelta by a buffer = max(MIN, target * PERCENT/100)
// before treating it as "already delivered". Tune via env vars without redeploying logic.
const PUBLIC_DELTA_BUFFER_PERCENT = Math.max(
  0,
  Number(Deno.env.get('PUBLIC_DELTA_BUFFER_PERCENT') ?? '0'),
)
const PUBLIC_DELTA_BUFFER_MIN = Math.max(
  0,
  Number(Deno.env.get('PUBLIC_DELTA_BUFFER_MIN') ?? '0'),
)

const computePublicDeltaBuffer = (targetQty: number) => {
  const pctBuffer = Math.floor((Math.max(0, targetQty) * PUBLIC_DELTA_BUFFER_PERCENT) / 100)
  return Math.max(PUBLIC_DELTA_BUFFER_MIN, pctBuffer)
}

const calculateObservedItemDelivery = (runs: any[], targetQty: number = 0) => {
  const askedSent = (runs || []).reduce((sum: number, run: any) => {
    if (run?.status === 'started' || run?.status === 'completed') {
      return sum + Number(run?.quantity_to_send || 0)
    }
    return sum
  }, 0)

  const observedByRuns = (runs || []).reduce(
    (sum: number, run: any) => sum + calculateObservedRunDelivery(run),
    0,
  )

  const startCounts = (runs || [])
    .map((run: any) => Number(run?.provider_start_count))
    // Ignore 0/null start counts. A zero from a failed/unverified provider status
    // was making public_delta huge and closing orders after only a few runs.
    .filter((value: number) => Number.isFinite(value) && value > 0)

  const publicCountDelta = startCounts.length > 0
    ? Math.max(0, Math.max(...startCounts) - Math.min(...startCounts))
    : 0

  // Discount organic growth: only the portion of publicCountDelta that exceeds
  // the buffer is attributed to provider over-delivery.
  const publicDeltaBuffer = computePublicDeltaBuffer(targetQty)
  const adjustedPublicCountDelta = Math.max(0, publicCountDelta - publicDeltaBuffer)

  return {
    askedSent,
    observedByRuns,
    publicCountDelta,
    publicDeltaBuffer,
    adjustedPublicCountDelta,
    // STRICT MODE: include publicCountDelta so provider over-delivery
    // (e.g. we ask 5k views and the provider pushes 50k to the public post)
    // is treated as already-delivered. This was previously excluded to allow
    // for organic growth from real users, but it caused massive over-delivery
    // complaints (10k ordered → 150k delivered). Better to slightly under-deliver
    // when a post also has organic traffic than to overshoot 10-15×.
    // Organic buffer (PUBLIC_DELTA_BUFFER_PERCENT / PUBLIC_DELTA_BUFFER_MIN) softens
    // the publicCountDelta so genuine organic viewers don't prematurely stop the order.
    // IMPORTANT: do not count `askedSent` as delivered. It only means a quantity was
    // submitted to providers, not that the public target count has been reached.
    delivered: Math.max(observedByRuns, adjustedPublicCountDelta),
    reserved: Math.max(askedSent, observedByRuns, adjustedPublicCountDelta),
  }
}

const getRunObservedCurrentCount = (run: any): number | null => {
  const start = Number(run?.provider_start_count)
  if (!Number.isFinite(start) || start < 0) return null

  const qty = Number(run?.quantity_to_send || 0)
  const status = (run?.provider_status || run?.status || '').toString().toLowerCase().trim()
  const remainsKnown = run?.provider_remains !== null && run?.provider_remains !== undefined

  if (remainsKnown) {
    const remains = Number(run.provider_remains)
    if (Number.isFinite(remains)) {
      return start + Math.max(0, qty - Math.max(0, remains))
    }
  }

  if (status === 'completed' || status === 'complete' || status === 'success') {
    return start + qty
  }

  return start
}

async function syncEngagementItemTracking(supabase: SupabaseClient, itemId?: string | null) {
  if (!itemId) return null

  const { data: item } = await supabase
    .from('engagement_order_items')
    .select('id, engagement_order_id, quantity, status, start_count, current_count, target_count, completion_locked_at')
    .eq('id', itemId)
    .maybeSingle()

  if (!item || item.status === 'cancelled' || item.status === 'paused') return null

  const orderedQty = Number(item.quantity || 0)
  if (orderedQty <= 0) return null

  const { data: runs } = await supabase
    .from('organic_run_schedule')
    .select('id, run_number, quantity_to_send, status, provider_start_count, provider_remains, provider_status, started_at')
    .eq('engagement_order_item_id', itemId)
    .order('run_number', { ascending: true })

  // Filter: only trust runs whose provider ACTUALLY returned a start_count.
  // Using `Number()` coerces null→0 so `Number.isFinite(Number(null))===true`,
  // which historically dragged the baseline to 0 for services (likes/comments/
  // shares/subscribers) where providers omit start_count. Use explicit null check.
  const validRuns = (runs || []).filter((run: any) => {
    const raw = run?.provider_start_count
    if (raw === null || raw === undefined) return false
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0
  })

  const existingStart = item.start_count !== null && item.start_count !== undefined
    ? Number(item.start_count)
    : null
  const firstProviderStart = validRuns.length > 0 ? Number(validRuns[0].provider_start_count) : null

  // Baseline preference:
  //   1) existing non-zero start_count on the item (stable across syncs)
  //   2) real provider baseline captured on the first run
  //   3) fall back to 0 when no provider ever exposed a public counter
  // NEVER overwrite a real existing baseline with 0.
  let baseline: number
  if (existingStart !== null && Number.isFinite(existingStart) && existingStart > 0) {
    baseline = existingStart
  } else if (firstProviderStart !== null && Number.isFinite(firstProviderStart) && firstProviderStart > 0) {
    baseline = firstProviderStart
  } else if (existingStart !== null && Number.isFinite(existingStart) && existingStart >= 0) {
    baseline = existingStart
  } else {
    baseline = 0
  }

  // Delivery-based progress: SUM of delivered across ALL runs (not MAX).
  // For each run: qty_to_send - max(0, provider_remains); if provider says the
  // run finished (completed/success), count the whole qty; else 0.
  const totalDeliveredByRuns = (runs || []).reduce((sum: number, run: any) => {
    const qty = Number(run?.quantity_to_send || 0)
    if (qty <= 0) return sum
    const rawStatus = (run?.provider_status || run?.status || '').toString().toLowerCase().trim()
    const remainsRaw = run?.provider_remains
    if (remainsRaw !== null && remainsRaw !== undefined) {
      const remains = Number(remainsRaw)
      if (Number.isFinite(remains)) {
        return sum + Math.max(0, qty - Math.max(0, remains))
      }
    }
    if (rawStatus === 'completed' || rawStatus === 'complete' || rawStatus === 'success') {
      return sum + qty
    }
    return sum
  }, 0)

  const deliveredCapped = Math.min(orderedQty, totalDeliveredByRuns)
  const publicObservedCounts = validRuns
    .map((run: any) => getRunObservedCurrentCount(run))
    .filter((value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0)

  const current = Math.max(
    baseline + deliveredCapped,
    Number(item.current_count || baseline),
    ...(publicObservedCounts.length ? publicObservedCounts : [baseline]),
  )
  const target = baseline + orderedQty
  const remaining = Math.max(0, target - current)
  // Delivery-based completion (source of truth for services without public counters).
  const targetReached = deliveredCapped >= orderedQty || current >= target

  const itemUpdate: any = {
    start_count: baseline,
    current_count: current,
    last_synced_at: new Date().toISOString(),
  }

  if (targetReached) {
    itemUpdate.status = 'completed'
    await supabase.from('organic_run_schedule').update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      error_message: `Target count reached (${current}/${target}) — cancelling remaining runs`,
      last_status_check: new Date().toISOString(),
    }).eq('engagement_order_item_id', itemId).eq('status', 'pending')
  }
  // NOTE: no longer force back to 'processing' when target not reached — that
  // decision is made downstream in updateEngagementOrderStatus based on the
  // ACTUAL run outcomes, so items don't get stuck when providers never expose
  // a public counter.

  await supabase.from('engagement_order_items').update(itemUpdate).eq('id', itemId)

  return { baseline, current, target, remaining, targetReached, engagementOrderId: item.engagement_order_id }
}

async function batchPostponeEngagementRunsForLink(
  supabase: SupabaseClient,
  normalizedLink: string,
  engagementType: string,
  reason: string,
) {
  if (!normalizedLink) return 0

  const { data: dueRuns, error: dueRunsError } = await supabase
    .from('organic_run_schedule')
    .select('id, engagement_order_item:engagement_order_items!inner(engagement_type, engagement_order:engagement_orders!inner(link))')
    .eq('status', 'pending')
    .not('engagement_order_item_id', 'is', null)
    .lte('scheduled_at', new Date().toISOString())
    .limit(1000)

  if (dueRunsError || !dueRuns?.length) {
    if (dueRunsError) console.error('Failed to load due runs for batch postpone:', dueRunsError)
    return 0
  }

  // Only postpone runs with matching link AND engagement type
  const matchingIds = dueRuns
    .filter((dueRun: any) => {
      const runLink = normalizeLink(dueRun.engagement_order_item?.engagement_order?.link)
      const runType = (dueRun.engagement_order_item?.engagement_type || '').toLowerCase()
      return runLink === normalizedLink && runType === engagementType.toLowerCase()
    })
    .map((dueRun: any) => dueRun.id)

  if (matchingIds.length === 0) return 0

  const { data: updatedRuns, error: updateError } = await supabase
    .from('organic_run_schedule')
    .update({
      error_message: reason,
      last_status_check: new Date().toISOString(),
    })
    .in('id', matchingIds)
    .select('id')

  if (updateError) {
    console.error('Failed to batch postpone matching runs:', updateError)
    return 0
  }

  return updatedRuns?.length || 0
}

async function updateEngagementOrderStatus(supabase: SupabaseClient, engagementOrderId: string, itemId: string) {
  if (!engagementOrderId) return

  const tracking = await syncEngagementItemTracking(supabase, itemId)

  const { data: parentOrder } = await supabase
    .from('engagement_orders')
    .select('status')
    .eq('id', engagementOrderId)
    .maybeSingle()

  if (parentOrder?.status === 'cancelled') return

  if (itemId) {
    const { data: currentItem } = await supabase
      .from('engagement_order_items')
      .select('status')
      .eq('id', itemId)
      .maybeSingle()

    if (currentItem?.status !== 'cancelled') {
      const { data: itemRuns } = await supabase
        .from('organic_run_schedule')
        .select('status')
        .eq('engagement_order_item_id', itemId)

      if (itemRuns && itemRuns.length > 0) {
        const completedCount = itemRuns.filter((r: any) => r.status === 'completed').length
        const failedCount = itemRuns.filter((r: any) => r.status === 'failed').length
        const cancelledCount = itemRuns.filter((r: any) => r.status === 'cancelled').length
        const activeCount = itemRuns.filter((r: any) => r.status === 'pending' || r.status === 'started').length
        const totalRuns = itemRuns.length

        let itemStatus = 'processing'
        if (activeCount > 0) itemStatus = currentItem?.status === 'paused' ? 'paused' : 'processing'
        else if (completedCount === totalRuns) itemStatus = 'completed'
        else if (completedCount > 0 && completedCount + failedCount + cancelledCount === totalRuns) itemStatus = 'partial'
        else if (failedCount + cancelledCount === totalRuns) itemStatus = 'failed'

        // If tracking exists AND has a REAL public baseline but delivery hasn't
        // reached the target yet, downgrade a runs-based 'completed' to 'partial'
        // (all runs done but public target not met). For items without a public
        // baseline (start_count = 0), trust the runs-based decision so items
        // don't get stuck perpetually in 'processing'.
        if (
          itemStatus === 'completed'
          && tracking
          && !tracking.targetReached
          && tracking.baseline > 0
        ) {
          itemStatus = 'partial'
        }
        await supabase.from('engagement_order_items').update({ status: itemStatus }).eq('id', itemId)
      }
    }
  }

  const { data: allItems } = await supabase
    .from('engagement_order_items')
    .select('status')
    .eq('engagement_order_id', engagementOrderId)

  if (!allItems || allItems.length === 0) return

  const completedItems = allItems.filter((i: any) => i.status === 'completed').length
  const partialItems = allItems.filter((i: any) => i.status === 'partial').length
  const failedItems = allItems.filter((i: any) => i.status === 'failed').length
  const cancelledItems = allItems.filter((i: any) => i.status === 'cancelled').length
  const activeItems = allItems.filter((i: any) => i.status === 'processing' || i.status === 'pending').length
  const totalItems = allItems.length

  let orderStatus = 'processing'
  if (completedItems === totalItems) orderStatus = 'completed'
  else if (failedItems === totalItems) orderStatus = 'failed'
  else if (activeItems === 0 && completedItems + partialItems + failedItems + cancelledItems === totalItems) orderStatus = completedItems > 0 ? 'partial' : failedItems > 0 ? 'failed' : 'cancelled'
  else if (parentOrder?.status === 'paused') orderStatus = 'paused'

  await supabase.from('engagement_orders').update({ status: orderStatus }).eq('id', engagementOrderId).neq('status', 'cancelled')
}

const MAX_CHAIN_DEPTH = 2

async function triggerContinuation(executionId: string, reason: string, nextDepth = 1) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceKey) {
      console.error(`⚠️ Cannot continue [${executionId}] - missing backend env vars`)
      return false
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/execute-all-runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        // Provider panels (Cloudflare) block the default ap-south-1 egress IPs.
        'x-region': 'us-east-1',
      },
      body: JSON.stringify({ continued_from: executionId, reason, chain_depth: nextDepth }),
    })

    if (!response.ok) {
      const responseText = await response.text()
      console.error(`⚠️ Continuation trigger failed [${executionId}]: ${response.status} ${responseText}`)
      return false
    }

    console.log(`🔁 Continuation queued for [${executionId}] (${reason})`)
    return true
  } catch (error) {
    console.error(`⚠️ Continuation request error [${executionId}]:`, error)
    return false
  }
}

// Declare EdgeRuntime for waitUntil support
declare const EdgeRuntime: { waitUntil(promise: Promise<any>): void }

serve(async (req) => {
  const startTime = Date.now()
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Auth: service-role (cron) OR a verified user JWT. Reject anon and unsigned tokens.
    // Service-role tokens do not contain a user `sub`, so Supabase Auth claims checks
    // reject them. Accept them by role claim after the Edge gateway has verified JWT.
    const authHeader = req.headers.get('Authorization')
    const supabase = supabaseModule
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    {
      const token = authHeader.replace('Bearer ', '').trim()
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
      const payload = decodeJwtPayload(token)
      const isServiceRoleToken = token === serviceKey || (cronSecret && token === cronSecret) || payload?.role === 'service_role'
      if (!isServiceRoleToken) {
        const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token)
        if (claimsErr || !claims?.claims?.sub) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
      }
    }

    const executionId = crypto.randomUUID().slice(0, 8)

    // Continuation chain depth — hard-capped so the function cannot self-invoke
    // forever and melt the database with repeated heavy scans.
    let chainDepth = 0
    try {
      const reqBody = await req.clone().json()
      chainDepth = Number(reqBody?.chain_depth) || 0
    } catch { /* no body */ }

    console.log(`=== EXECUTE ALL ORGANIC RUNS [${executionId}] depth=${chainDepth} ===`)

    // Return 202 immediately, process in background to avoid context-canceled
    const backgroundWork = processAllRuns(supabase, executionId, startTime, chainDepth)
    
    try {
      EdgeRuntime.waitUntil(backgroundWork)
    } catch {
      // Fallback: if EdgeRuntime not available, await directly
      await backgroundWork
    }

    return new Response(JSON.stringify({
      success: true, execution_id: executionId,
      message: 'Processing started in background'
    }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('Execution error:', error)
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

async function processAllRuns(supabase: any, executionId: string, startTime: number, chainDepth = 0) {
  try {
    let processed = 0
    let skipped = 0
    let failed = 0
    let retried = 0
    let shouldContinue = false
    let continuationReason: string | null = null
    const results: any[] = []

    // ==========================================
    // OPTIMIZATION: Single mapping cache for entire invocation
    // ==========================================
    const mappingCache = new MappingCache()
    const userMappingCache = new UserMappingCache()


    // ==========================================
    // PRE-FETCH ALL DATA IN PARALLEL (batch queries)
    // ==========================================
    const nowWithBuffer = new Date(Date.now() + 2000).toISOString()
    const busyRetryCooldownBefore = new Date(Date.now() - ACTIVE_ORDER_RETRY_MS).toISOString()
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    const [
      { data: activeRuns },
      { data: globalStuckRuns },
      { data: pendingEngagementRuns, error: engagementRunsError },
      { data: failedEngagementRuns },
      { data: recentlyBusyRuns },
      { data: recentPendingEngagementRuns },
    ] = await Promise.all([
      // 1. Active runs for conflict detection
      supabase
        .from('organic_run_schedule')
        .select('*, engagement_order_item:engagement_order_items(engagement_type, service_id, engagement_order:engagement_orders(link))')
        .eq('status', 'started'),
      // 2. Stuck runs for cleanup
      supabase
        .from('organic_run_schedule')
        .select('id, run_number, started_at, provider_account_id, provider_account_name, user_provider_account_id, user_provider_account_name, provider_status, provider_order_id, provider_remains, provider_start_count, quantity_to_send, retry_count')
        .eq('status', 'started')
        .or(`started_at.lt.${tenMinAgo},started_at.is.null`),
      // 3. Pending engagement runs
      supabase
        .from('organic_run_schedule')
        .select(`*, engagement_order_item:engagement_order_items!organic_run_schedule_engagement_order_item_id_fkey!inner(*, service:services(*), engagement_order:engagement_orders!inner(*))`)
        .eq('status', 'pending')
        .not('engagement_order_item_id', 'is', null)
        .lte('scheduled_at', nowWithBuffer)
        .not('engagement_order_item.status', 'in', '("paused","cancelled","completed")')
        .not('engagement_order_item.engagement_order.status', 'in', '("paused","cancelled","completed")')
        .or(`last_status_check.is.null,last_status_check.lt.${busyRetryCooldownBefore}`)
        .order('last_status_check', { ascending: true, nullsFirst: true })
        .order('scheduled_at', { ascending: true })
        .limit(600),
      // 4. Failed engagement runs for retry
      supabase
        .from('organic_run_schedule')
        .select(`*, engagement_order_item:engagement_order_items!organic_run_schedule_engagement_order_item_id_fkey(*, service:services(*), engagement_order:engagement_orders(*))`)
        .eq('status', 'failed')
        .lt('retry_count', 99)
        .not('engagement_order_item_id', 'is', null)
        .not('engagement_order_item.status', 'in', '("paused","cancelled","completed")')
        .not('engagement_order_item.engagement_order.status', 'in', '("paused","cancelled","completed")')
        .order('completed_at', { ascending: true })
        .limit(150),
      // 5. Recently busy runs (for cooldown)
      supabase
        .from('organic_run_schedule')
        .select(`provider_account_id, user_provider_account_id, error_message, engagement_order_item:engagement_order_items(engagement_type, engagement_order:engagement_orders(link))`)
        .eq('status', 'pending')
        .gte('last_status_check', fifteenMinAgo),
      // 6. Newest due pending engagement runs so old backlog cannot starve fresh user orders
      supabase
        .from('organic_run_schedule')
        .select(`*, engagement_order_item:engagement_order_items!organic_run_schedule_engagement_order_item_id_fkey!inner(*, service:services(*), engagement_order:engagement_orders!inner(*))`)
        .eq('status', 'pending')
        .not('engagement_order_item_id', 'is', null)
        .lte('scheduled_at', nowWithBuffer)
        .not('engagement_order_item.status', 'in', '("paused","cancelled","completed")')
        .not('engagement_order_item.engagement_order.status', 'in', '("paused","cancelled","completed")')
        .or(`last_status_check.is.null,last_status_check.lt.${busyRetryCooldownBefore}`)
        .order('scheduled_at', { ascending: false })
        .limit(400),
    ])

    // ==========================================
    // STEP 0: GLOBAL CLEANUP (stuck runs)
    // ==========================================
    if (globalStuckRuns && globalStuckRuns.length > 0) {
      console.log(`🧹 Cleaning ${globalStuckRuns.length} stuck runs`)
      // Batch cleanup in parallel
      const cleanupPromises = globalStuckRuns.map((stuck: any) => {
        const startedTime = stuck.started_at ? new Date(stuck.started_at).getTime() : Date.now() - 11 * 60 * 1000
        const ageMin = Math.round((Date.now() - startedTime) / 60000)
        
        if (!stuck.provider_order_id) {
          return supabase.from('organic_run_schedule').update({
            status: 'pending', started_at: null, provider_account_id: null, user_provider_account_id: null,
            provider_account_name: null, user_provider_account_name: null,
            error_message: `Ghost run reverted after ${ageMin}min`,
            rotation_lock_key: null,
          }).eq('id', stuck.id)
        } else {
          // SCAM GUARD: if provider didn't deliver anything (remains == full qty, or start_count null & remains == qty),
          // mark as failed so the scheduler retries on a backup provider instead of silently "completing" a fake order.
          const qty = stuck.quantity_to_send || 0
          const remains = typeof stuck.provider_remains === 'number' ? stuck.provider_remains : null
          const startCount = typeof stuck.provider_start_count === 'number' ? stuck.provider_start_count : null
          const deliveredZero = remains !== null && qty > 0 && remains >= qty && (startCount === null || startCount === 0)
          const isTerminal = isTerminalProviderStatus(stuck.provider_status)
          const isActive = isActiveProviderStatus(stuck.provider_status)
          const retryCount = stuck.retry_count || 0

          // Never fail a run from STALE provider data. If we haven't polled the
          // provider recently, the "0 delivered" snapshot may be hours old while
          // the provider has already delivered/completed. Let check-order-status
          // refresh it instead of killing a healthy order.
          const lastCheckMs = stuck.last_status_check ? new Date(stuck.last_status_check).getTime() : 0
          const checkAgeMin = lastCheckMs ? Math.round((Date.now() - lastCheckMs) / 60000) : 9999
          const providerDataFresh = checkAgeMin <= 20

          if (deliveredZero && isActive && (ageMin < 120 || !providerDataFresh)) {
            return supabase.from('organic_run_schedule').update({
              error_message: `Waiting for provider delivery (${ageMin}min, status: ${stuck.provider_status || 'unknown'})`,
            }).eq('id', stuck.id)
          }

          if (deliveredZero && !isTerminal && providerDataFresh && retryCount < 15) {
            return supabase.from('organic_run_schedule').update({
              status: 'failed', completed_at: new Date().toISOString(),
              error_message: `Auto-retry after ${ageMin}min: provider returned ${stuck.provider_status || 'unknown'} with 0 delivered (remains=${remains}/${qty})`,
              rotation_lock_key: null,
            }).eq('id', stuck.id)
          }


          if (!isTerminal && isActive) {
            return null
          }

          return supabase.from('organic_run_schedule').update({
            last_status_check: new Date().toISOString(),
            error_message: `Still waiting for provider completion after ${ageMin}min (status: ${stuck.provider_status || 'unknown'})`,
          }).eq('id', stuck.id)
        }
      })
      await Promise.all(cleanupPromises.filter(Boolean))
      console.log(`✅ Cleaned ${globalStuckRuns.length} stuck runs`)
    }

    // ==========================================
    // STEP 1: Process ENGAGEMENT ORDER runs
    // ==========================================
    console.log(`\n--- Processing Engagement Order Runs ---`)

    if (engagementRunsError) {
      console.error('Error fetching engagement runs:', engagementRunsError)
    }
    const pendingById = new Map<string, any>()
    for (const pendingRun of [...(pendingEngagementRuns || []), ...(recentPendingEngagementRuns || [])]) {
      if (pendingRun?.id && !pendingById.has(pendingRun.id)) pendingById.set(pendingRun.id, pendingRun)
    }
    const mergedPendingEngagementRuns = [...pendingById.values()]

    console.log(`📥 Fetched ${mergedPendingEngagementRuns.length} raw pending engagement runs from DB (${pendingEngagementRuns?.length || 0} oldest + ${recentPendingEngagementRuns?.length || 0} newest)`)

    // PRE-FILTER: Remove paused/cancelled/completed
    const activeEngagementRuns = mergedPendingEngagementRuns.filter((run: any) => {
      const orderStatus = run.engagement_order_item?.engagement_order?.status
      const itemStatus = run.engagement_order_item?.status
      if (orderStatus === 'paused' || orderStatus === 'cancelled' || orderStatus === 'completed') return false
      if (itemStatus === 'paused' || itemStatus === 'cancelled' || itemStatus === 'completed') return false
      return true
    })

    // Fairness: give each item multiple due runs per invocation. The per-provider
    // link/type lock below still guarantees max parallelism = mapped providers,
    // but this lets a 5-provider bundle fill all 5 slots in one cron tick instead
    // of slowly sending only one scheduled run per minute.
    const itemRunCount = new Map<string, number>()
    const executionProviderMap = new Map<string, Set<string>>()
    // Track stuck runs already handled in THIS invocation so we don't re-poll or re-complete
    // the same provider status hundreds of times (was starving fresh dispatch).
    const handledStuckRunIds = new Set<string>()
    const inlineRefreshCache = new Map<string, any>()

    const pendingRunsLimitedPerItem = activeEngagementRuns.filter((run: any) => {
      const itemId = run.engagement_order_item_id
      const count = itemRunCount.get(itemId) || 0
      if (count < MAX_RUNS_PER_ITEM_PER_INVOCATION) {
        itemRunCount.set(itemId, count + 1)
        return true
      }
      return false
    })

    // PRE-FILTER failed runs
    const activeFailedRuns = (failedEngagementRuns || []).filter((run: any) => {
      const orderStatus = run.engagement_order_item?.engagement_order?.status
      const itemStatus = run.engagement_order_item?.status
      if (orderStatus === 'cancelled' || orderStatus === 'paused' || orderStatus === 'completed') return false
      if (itemStatus === 'cancelled' || itemStatus === 'paused' || itemStatus === 'completed') return false
      return true
    })

    const retryableFailedRuns = activeFailedRuns.filter((run: any) => {
      // Hard stop: once a provider order id exists, never place that same run again.
      // A retry here can create duplicate external orders for one scheduled run.
      // Exception: provider accepted the order but delivered 0 for 45+ min. Treat it
      // as a dead provider slot and place the same scheduled chunk on another provider.
      if (run.provider_order_id && !isZeroDeliveryProviderFailure(run)) return false
      return true
    })

    const retryRunsLimitedPerItem = retryableFailedRuns.filter((run: any) => {
      const itemId = run.engagement_order_item_id
      const count = itemRunCount.get(itemId) || 0
      if (count < MAX_RUNS_PER_ITEM_PER_INVOCATION) {
        itemRunCount.set(itemId, count + 1)
        return true
      }
      return false
    })

    const isDeprioritizedBusyRun = (run: any) => {
      const message = (run.error_message || '').toLowerCase()
      return message.includes('[postponed] all providers busy') ||
        message.includes('[queued] all providers busy') ||
        message.includes('[batch postponed]') ||
        message.includes('[batch queued]') ||
        message.includes('[waiting for merge]') ||
        message.includes('active order on link')
    }

    const allEngagementRuns = [...pendingRunsLimitedPerItem, ...retryRunsLimitedPerItem].sort((a: any, b: any) => {
        const aBusy = isDeprioritizedBusyRun(a) ? 0 : 0
        const bBusy = isDeprioritizedBusyRun(b) ? 0 : 0
      if (aBusy !== bBusy) return aBusy - bBusy

      // Fresh runs (never checked) should not wait behind a huge old backlog.
      const aAlreadyChecked = a.last_status_check ? 1 : 0
      const bAlreadyChecked = b.last_status_check ? 1 : 0
      if (aAlreadyChecked !== bAlreadyChecked) return aAlreadyChecked - bAlreadyChecked

      if (aAlreadyChecked === 0 && bAlreadyChecked === 0) {
        const aOrderCreated = new Date(a.engagement_order_item?.engagement_order?.created_at || 0).getTime()
        const bOrderCreated = new Date(b.engagement_order_item?.engagement_order?.created_at || 0).getTime()
        if (aOrderCreated !== bOrderCreated) return bOrderCreated - aOrderCreated
      }

      const aTime = new Date(a.scheduled_at || 0).getTime()
      const bTime = new Date(b.scheduled_at || 0).getTime()
      return aTime - bTime
    })
    console.log(`Processing ${allEngagementRuns.length} runs (${pendingRunsLimitedPerItem.length} pending + ${retryRunsLimitedPerItem.length} retry), total overdue in DB: check query`)

    // PRE-BUILD busy account lookup for recently busy runs (link → Set<accountId>)
    const recentlyBusyByLinkType = new Map<string, Set<string>>()
    if (recentlyBusyRuns && recentlyBusyRuns.length > 0) {
      for (const rbr of recentlyBusyRuns) {
        const rbrAccountId = getRunProviderAccountId(rbr)
        if (!rbrAccountId) continue
        if (isActiveOrderErrorMsg(rbr.error_message)) {
          const rbrLink = normalizeLink(getNestedEngagementOrderLink(rbr.engagement_order_item))
          const rbrType = (rbr.engagement_order_item?.engagement_type || '').toLowerCase().trim()
          const busyKey = `${rbrLink}|${rbrType}`
          if (!recentlyBusyByLinkType.has(busyKey)) recentlyBusyByLinkType.set(busyKey, new Set())
          recentlyBusyByLinkType.get(busyKey)!.add(rbrAccountId)
        }
      }
    }

    // Process each engagement run
    for (const run of allEngagementRuns) {
      // Timeout guard: if we've been running for 50s, stop to avoid edge function timeout
      if (Date.now() - startTime > DISPATCH_TIME_BUDGET_MS) {
        shouldContinue = true
        continuationReason = 'engagement-time-slice-exhausted'
        console.log(`⏰ Approaching timeout (${Date.now() - startTime}ms), stopping processing. Remaining runs will be picked up next cycle.`)
        break
      }

      const { data: freshRunState } = await supabase
        .from('organic_run_schedule')
        .select('id, status, scheduled_at')
        .eq('id', run.id)
        .maybeSingle()

      if (!freshRunState || freshRunState.status !== run.status || new Date(freshRunState.scheduled_at).getTime() > new Date(nowWithBuffer).getTime()) {
        skipped++
        console.log(`⏭️ Run #${run.run_number} skipped because it was manually changed after this scheduler cycle loaded it`)
        continue
      }

      const runLink = normalizeLink(run.engagement_order_item?.engagement_order?.link)
      const runType = (run.engagement_order_item?.engagement_type || '').toLowerCase()
      const linkTypeKey = `${runLink}|${runType}`

      const isRetry = run.status === 'failed'
      const item = run.engagement_order_item
      if (!item) {
        await supabase.from('organic_run_schedule').update({
          status: 'failed', error_message: 'Missing engagement order item',
        }).eq('id', run.id)
        failed++
        continue
      }

      const currentType = item.engagement_type?.toLowerCase()
      const engagementOrderStatus = item.engagement_order?.status
      const itemStatus = item.status
      
      // CANCELLED = PERMANENT
      if (engagementOrderStatus === 'cancelled') {
        await supabase.from('organic_run_schedule').update({
          status: 'cancelled', error_message: 'Order cancelled by user',
          completed_at: new Date().toISOString(),
          rotation_lock_key: null,
        }).eq('id', run.id)
        skipped++
        continue
      }
      if (itemStatus === 'cancelled') {
        await supabase.from('organic_run_schedule').update({
          status: 'cancelled', error_message: 'Item cancelled by user',
          completed_at: new Date().toISOString(),
          rotation_lock_key: null,
        }).eq('id', run.id)
        skipped++
        continue
      }
      
      // PAUSED = TEMPORARY
      if (engagementOrderStatus === 'paused' || itemStatus === 'paused') {
        skipped++
        continue
      }

      // 🛡️ OVER-DELIVERY GUARD: Ensure cumulative sent quantity never exceeds item.quantity.
      // Some providers over-deliver on the public post even when our scheduled qty is lower,
      // so we must stop future runs based on observed public delivery too.
      try {
        const knownTarget = Number(item.target_count || 0)
        const knownCurrent = Number(item.current_count || 0)
        if (knownTarget > 0 && knownCurrent >= knownTarget) {
          await supabase.from('engagement_order_items').update({
            status: 'completed',
            updated_at: new Date().toISOString(),
          }).eq('id', item.id).neq('status', 'completed')
          await supabase.from('organic_run_schedule').update({
            status: 'cancelled',
            completed_at: new Date().toISOString(),
            error_message: `Target count reached (${knownCurrent}/${knownTarget}) — cancelling remaining runs`,
            last_status_check: new Date().toISOString(),
            rotation_lock_key: null,
          }).eq('engagement_order_item_id', item.id).eq('status', 'pending')
          await updateEngagementOrderStatus(supabase, item.engagement_order_id, item.id)
          skipped++
          console.log(`🎯 Item ${item.id} already at target (${knownCurrent}/${knownTarget}); pending runs cancelled and item completed.`)
          continue
        }

        // PERFORMANCE: Skip live tracking sync in the hot dispatch path — it does 3+ DB
        // queries per candidate and starves fresh orders. The check-order-status cron
        // maintains current_count/target_count. The DB-values check above already
        // handles the "target already reached" case.
        const tracking: any = null

        const orderedQty = Number(item.quantity || 0)
        if (orderedQty > 0) {
          const { data: sentRows } = await supabase
            .from('organic_run_schedule')
            .select('quantity_to_send,status,provider_start_count,provider_remains,provider_status,run_number')
            .eq('engagement_order_item_id', item.id)
            .in('status', ['completed', 'started', 'failed'])

          const observed = calculateObservedItemDelivery(sentRows || [], orderedQty)
          const actualDelivered = observed.delivered
          const reservedOrDelivered = observed.reserved
          const remaining = orderedQty - reservedOrDelivered
          if (remaining <= 0) {
            // Enough quantity is already at providers, but live public count has not
            // reached target yet. Hold future runs instead of completing early.
            const holdUntil = new Date(Date.now() + ACTIVE_ORDER_RETRY_MS).toISOString()
            // Only push scheduled_at forward — never override a user's manual future reschedule.
            await supabase.from('organic_run_schedule').update({
              scheduled_at: holdUntil,
              error_message: `Delivery reserved (asked=${observed.askedSent}, observed=${observed.observedByRuns}, public_delta=${observed.publicCountDelta}, public_delta_adj=${observed.adjustedPublicCountDelta}, buffer=${observed.publicDeltaBuffer}, target=${orderedQty}) — awaiting live target count`,
              last_status_check: new Date().toISOString(),
            }).eq('engagement_order_item_id', item.id).eq('status', 'pending').lt('scheduled_at', holdUntil)
            if (actualDelivered >= orderedQty) {
              const finalTracking = await syncEngagementItemTracking(supabase, item.id)
              if (finalTracking?.targetReached) {
                await supabase.from('engagement_order_items').update({
                  status: 'completed', updated_at: new Date().toISOString(),
                }).eq('id', item.id).neq('status', 'completed')
              } else {
                await supabase.from('engagement_order_items').update({
                  status: 'processing', updated_at: new Date().toISOString(),
                }).eq('id', item.id).not('status', 'in', '("cancelled","paused","completed")')
              }
            } else {
              await supabase.from('engagement_order_items').update({
                status: 'processing', updated_at: new Date().toISOString(),
              }).eq('id', item.id).not('status', 'in', '("cancelled","paused","completed")')
            }
            skipped++
            console.log(`🛡️ Item ${item.id} delivery reserved — asked=${observed.askedSent}, observed=${observed.observedByRuns}, public_delta=${observed.publicCountDelta}, public_delta_adj=${observed.adjustedPublicCountDelta}, buffer=${observed.publicDeltaBuffer}, target=${orderedQty}. Awaiting live public target.`)
            continue
          }
          const liveRemaining = tracking ? Math.max(1, tracking.remaining) : remaining
          const safeRemaining = Math.max(1, Math.min(remaining, liveRemaining))
          if (run.quantity_to_send > safeRemaining) {
            console.log(`🛡️ Capping run #${run.run_number} qty ${run.quantity_to_send} → ${safeRemaining} (live_remaining=${tracking?.remaining ?? 'n/a'}, asked=${observed.askedSent}, observed=${observed.observedByRuns}, public_delta=${observed.publicCountDelta}, public_delta_adj=${observed.adjustedPublicCountDelta}, buffer=${observed.publicDeltaBuffer}, target=${orderedQty})`)
            await supabase.from('organic_run_schedule').update({
              quantity_to_send: safeRemaining,
            }).eq('id', run.id)
            run.quantity_to_send = safeRemaining
          }
        }
      } catch (capErr) {
        console.error('Over-delivery guard error:', capErr)
      }

      // ==========================================
      // USER-BUNDLE PATH: order items placed against user's own SMM panel
      // (user_bundle_item_id set) skip the admin services table entirely.
      // Provide a synthetic service so downstream code passes null-checks.
      // ==========================================
      const isUserBundleItem = !!(item as any).user_bundle_item_id
      if (isUserBundleItem && !item.service) {
        item.service = {
          id: `user:${(item as any).user_bundle_item_id}`,
          name: item.engagement_type,
        } as any
      }

      if (!item.service) {

        // FALLBACK: Try bundle
        const bundleId = item.engagement_order?.bundle_id
        if (bundleId) {
          const { data: bundleItem } = await supabase
            .from('bundle_items')
            .select('service_id, service:services(*)')
            .eq('bundle_id', bundleId)
            .eq('engagement_type', item.engagement_type)
            .not('service_id', 'is', null)
            .limit(1).single()
          
          if (bundleItem?.service) {
            item.service = bundleItem.service
            await supabase.from('engagement_order_items')
              .update({ service_id: bundleItem.service_id })
              .eq('id', item.id)
          }
        }
        
        if (!item.service) {
          const retryCount = (run.retry_count || 0) + 1
          if (retryCount >= MAX_RUN_RETRIES) {
            await supabase.from('organic_run_schedule').update({
              status: 'failed', error_message: `Service not found after ${MAX_RUN_RETRIES} retries`,
              retry_count: 99,
            }).eq('id', run.id)
            failed++
          } else {
            await supabase.from('organic_run_schedule').update({
              status: 'failed', error_message: 'Service not found - will retry',
              retry_count: retryCount,
            }).eq('id', run.id)
            skipped++
          }
          continue
        }
      }

      // Platform mismatch detection
      const orderLink = item.engagement_order?.link || ''
      const linkPlatform = detectPlatformFromLink(orderLink)
      const servicePlatform = detectPlatformFromService(item.service.name || '')
      
      if (linkPlatform && servicePlatform && linkPlatform !== servicePlatform) {
        await supabase.from('organic_run_schedule').update({
          status: 'failed',
          error_message: `BLOCKED: Platform mismatch - ${linkPlatform} link cannot use ${servicePlatform} service`,
          completed_at: new Date().toISOString(), retry_count: 99,
        }).eq('id', run.id)
        failed++
        continue
      }

      const sameLink = normalizeLink(orderLink)
      const currentServiceId = item.service?.id
      const sameLinkNormalized = sameLink
      const currentTypeNormalized = (currentType || '').toLowerCase().trim()
      const localExecutionKey = `${sameLinkNormalized}|${currentTypeNormalized}`
      
      // Build busy account list
      const busyAccountIds: string[] = []
      
      // From execution-level tracking
      const usedProvidersForKey = executionProviderMap.get(localExecutionKey) || new Set<string>()
      for (const usedId of usedProvidersForKey) {
        if (!busyAccountIds.includes(usedId)) busyAccountIds.push(usedId)
      }
      
      // From pre-fetched recently busy runs
      const busyForLinkType = recentlyBusyByLinkType.get(localExecutionKey)
      if (busyForLinkType) {
        for (const accId of busyForLinkType) {
          if (!busyAccountIds.includes(accId)) busyAccountIds.push(accId)
        }
      }

      // FALLBACK: If this run already failed/cancelled on a provider, exclude it on retry
      // so the system tries a backup provider instead of repeating the same one.
      if (isRetry && getRunProviderAccountId(run)) {
        const previousAccountId = getRunProviderAccountId(run)
        if (previousAccountId && !busyAccountIds.includes(previousAccountId)) {
          busyAccountIds.push(previousAccountId)
          console.log(`🔁 Retry run #${run.run_number}: excluding previous provider ${getRunProviderAccountName(run) || previousAccountId} (failed/cancelled), will try backup`)
        }
      }

      // FALLBACK: Exclude providers already attempted for this run only after a
      // hard failure. Soft queue states (active-order / provider busy / temp
      // error) must NOT permanently blacklist providers; otherwise a run can
      // stay queued forever even after the earlier provider becomes free.
      const triedProviders: string[] = Array.isArray(run.provider_response?.tried_providers)
        ? run.provider_response.tried_providers : []
      const currentRunMessage = (run.error_message || '').toLowerCase()
      const softQueuedRun =
        isActiveOrderErrorMsg(currentRunMessage) ||
        currentRunMessage.includes('[queued') ||
        currentRunMessage.includes('[batch queued') ||
        currentRunMessage.includes('all providers busy') ||
        currentRunMessage.includes('temporary provider error')
      const shouldExcludeTriedProviders = isRetry && !softQueuedRun
      if (shouldExcludeTriedProviders) {
        for (const tp of triedProviders) {
          if (tp && !busyAccountIds.includes(tp)) busyAccountIds.push(tp)
        }
      }

      // FALLBACK: Also exclude any provider_account_id that already failed/cancelled
      // for this SAME engagement_order_item (prevents same-provider repeat across retries).
      try {
        const { data: priorFailedForItem } = await supabase
          .from('organic_run_schedule')
          .select('id, provider_account_id, user_provider_account_id, error_message, provider_status, status')
          .eq('engagement_order_item_id', item.id)
          .in('status', ['failed', 'cancelled'])
          .limit(200)
        if (priorFailedForItem) {
          for (const pr of priorFailedForItem as any[]) {
            // Exclude only providers that CANCELLED/REFUNDED previously on this item.
            // Successful providers (priority #1) can keep handling future runs.
            const ps = (pr.provider_status || '').toLowerCase()
            const em = (pr.error_message || '').toLowerCase()
            const wasCancelled =
              ps.includes('cancel') || ps.includes('refund') ||
              em.includes('cancel') || em.includes('refund')
            const priorAccountId = getRunProviderAccountId(pr)
            if (wasCancelled && pr.id !== run.id && priorAccountId && !busyAccountIds.includes(priorAccountId)) {
              busyAccountIds.push(priorAccountId)
            }
          }
        }
      } catch (_e) { /* non-fatal */ }

      // IMPORTANT: Do not block a provider for this item just because a different
      // engagement type in the same order had a cancelled/refunded run earlier.
      // Shares/Saves often have only one mapped provider, and cross-type exclusions
      // can incorrectly leave zero accounts to try, causing endless postpones.
      
      // From active (started) runs for same link+type
      const startedRunsForLink = (activeRuns || []).filter((r: any) => {
        if (handledStuckRunIds.has(r.id)) return false
        const runLink = normalizeLink(r.engagement_order_item?.engagement_order?.link)
        const runType = (r.engagement_order_item?.engagement_type || '').toLowerCase()
        return runLink === sameLink && runType === currentTypeNormalized
      })
      
      if (startedRunsForLink && startedRunsForLink.length > 0) {
        for (let stuckRun of startedRunsForLink) {
          // INLINE STATUS REFRESH: cache per-invocation so we don't re-poll the same
          // provider order for every candidate that shares the same link+type.
          const cached = inlineRefreshCache.get(stuckRun.id)
          if (cached) {
            stuckRun = cached
          } else {
            stuckRun = await inlineRefreshRunStatus(supabase, stuckRun)
            inlineRefreshCache.set(stuckRun.id, stuckRun)
          }
          const terminalStatuses = ['Completed', 'Complete', 'Partial', 'Refunded', 'Canceled', 'Cancelled', 'Error', 'Failed', 'Success', 'Refund', 'Canscelled']
          const isTerminal = stuckRun.provider_status && terminalStatuses.includes(stuckRun.provider_status)
          const hasNoRemains = typeof stuckRun.provider_remains === 'number' && stuckRun.provider_remains <= 0 && !!stuckRun.provider_order_id
          
          const startedAt = new Date(stuckRun.started_at || 0)
          const runAge = Math.round((Date.now() - startedAt.getTime()) / 1000)
          
          if (isTerminal || hasNoRemains) {
            // SCAM GUARD: terminal status but 0 actually delivered → retry instead of complete
            const qty = stuckRun.quantity_to_send || 0
            const remains = typeof stuckRun.provider_remains === 'number' ? stuckRun.provider_remains : null
            const startCount = typeof stuckRun.provider_start_count === 'number' ? stuckRun.provider_start_count : null
            const deliveredZero = !hasNoRemains && remains !== null && qty > 0 && remains >= qty && (startCount === null || startCount === 0)
            const retryCount = stuckRun.retry_count || 0
            if (deliveredZero && retryCount < 15) {
              console.log(`⚠️ Auto-retry run #${stuckRun.run_number}: provider ${stuckRun.provider_status} with 0 delivered`)
              await supabase.from('organic_run_schedule').update({
                status: 'failed', completed_at: new Date().toISOString(),
                error_message: `Auto-retry: provider ${stuckRun.provider_status} with 0 delivered (remains=${remains}/${qty})`,
              }).eq('id', stuckRun.id)
              handledStuckRunIds.add(stuckRun.id)
            } else {
              console.log(`🔄 Auto-completing run #${stuckRun.run_number} (${hasNoRemains ? 'no remains left' : `terminal: ${stuckRun.provider_status}`})`)
              await supabase.from('organic_run_schedule').update({
                status: 'completed', completed_at: new Date().toISOString(),
                error_message: hasNoRemains
                  ? `Auto-completed (provider remains reached 0)`
                  : `Auto-completed (status: ${stuckRun.provider_status})`,
              }).eq('id', stuckRun.id)
              handledStuckRunIds.add(stuckRun.id)
            }
          } else if (getRunProviderAccountId(stuckRun)) {
            const stuckAccountId = getRunProviderAccountId(stuckRun)!
            if (hasUncertainDispatch(stuckRun)) {
              console.log(`🛑 Holding run #${stuckRun.run_number}: provider dispatch uncertain, skipping resend until manual/provider confirmation`)
              skipped++
              continue
            }

            if (!stuckRun.provider_order_id && runAge > 60) {
              await supabase.from('organic_run_schedule').update({
                status: 'pending', started_at: null, provider_account_id: null,
                error_message: `Ghost run reverted (no provider order after ${runAge}s)`,
              }).eq('id', stuckRun.id)
              continue
            }
            
            if (!stuckRun.provider_order_id && runAge <= 60) {
              if (!busyAccountIds.includes(stuckAccountId)) {
                busyAccountIds.push(stuckAccountId)
              }
              continue
            }
            
            if (!busyAccountIds.includes(stuckAccountId)) {
              busyAccountIds.push(stuckAccountId)
            }
          }
        }
      }

      // ==========================================
      // OPTIMIZED: Use cached mapping lookup
      // User-bundle items route to user's OWN provider accounts (per-tenant),
      // admin/services items route through service_provider_mapping.
      // ==========================================
      const availableAccounts = isUserBundleItem
        ? await userMappingCache.getForBundleItem(
            supabase, (item as any).user_bundle_item_id, busyAccountIds
          )
        : await mappingCache.getForService(
            supabase, item.service.id, busyAccountIds, executionId
          )

      
      // STRICT MAPPING MODE — no automatic default-provider fallback.
      // Only providers explicitly mapped via service_provider_mapping for this
      // service are eligible. If admin hasn't mapped any, the run is postponed
      // until a mapping is configured (prevents accidental routing to a service's
      // legacy default provider_id).
      
      const zeroDeliveryRetry = isRetry && isZeroDeliveryProviderFailure(run)
      const accountsToTry: ProviderCandidate[] = [...availableAccounts]

      // ==========================================
      // STRICT PRIORITY ORDER — no round-robin.
      // Providers that are currently BUSY on the same link+type are already
      // filtered out of `availableAccounts` (via busyAccountIds). So here we
      // simply sort by user-configured priority: #1 first, then #2, #3...
      // If #1 is free → use #1. If #1 is busy → try #2. If both busy → #3.
      // If ALL busy → the run stays queued and picks up as soon as anyone
      // finishes on the next cron tick (handled below).
      // STRICT: priority ASC only. No health-score / recency / min-qty reorder.
      // The try-loop below skips providers whose min > effectiveQty, so priority
      // is preserved (#1 free → #1, else #2, etc.).
      // ==========================================
      accountsToTry.sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999))
      void zeroDeliveryRetry


      
      if (accountsToTry.length === 0) {
        if (isUserBundleItem
              ? userMappingCache.hasConfigured((item as any).user_bundle_item_id)
              : mappingCache.hasConfiguredMappingForService(item.service.id)) {

          // QUEUE: All mapped providers are busy for this link/type.
          // Keep scheduled_at unchanged so admin/user sees the run as queued, not auto-rescheduled.
          await supabase.from('organic_run_schedule').update({
            error_message: `[Queued] All providers busy for this link`,
            last_status_check: new Date().toISOString(),
          }).eq('id', run.id)
          skipped++
          console.log(`⏸️ Run #${run.run_number} queued (all providers pre-filtered as busy)`)
          results.push({ run_id: run.id, run_number: run.run_number, type: item.engagement_type,
            success: false, skipped: true, reason: `All providers busy - queued` })
        } else {
          // No mapping configured for this service — postpone (don't fail) so that
          // as soon as admin maps a provider in Service → Provider Mapping, the
          // run picks up automatically on the next cron tick.
          const postponeMs = 5 * 60 * 1000
          const newScheduledAt = new Date(Date.now() + postponeMs).toISOString()
          const waitMsg = isUserBundleItem
            ? '[Waiting] No provider mapped in your bundle — add a mapping in My Bundles'
            : '[Waiting] No provider mapped for this service — add a mapping in Admin → Service Provider Mapping'
          await supabase.from('organic_run_schedule').update({
            scheduled_at: newScheduledAt,
            error_message: waitMsg,
            last_status_check: new Date().toISOString(),
          }).eq('id', run.id).lt('scheduled_at', newScheduledAt)

          skipped++
          console.log(`⏸️ Run #${run.run_number} waiting — no provider mapping configured for service ${item.service.id}`)
          results.push({ run_id: run.id, run_number: run.run_number, type: item.engagement_type,
            success: false, skipped: true, reason: 'No provider mapping configured' })
        }
        continue
      }

      // Quantity handling — pick the LOWEST-min provider first so small runs aren't rejected.
      // If every provider minimum is still above the scheduled qty, merge with future
      // pending runs of the same item so shares/saves do not get stuck forever.
      const originalQty = run.quantity_to_send
      let effectiveQty = originalQty
      // STRICT PRIORITY: do NOT re-sort by minQuantity. Try-loop below skips
      // providers whose min exceeds effectiveQty, so #1 stays #1.

      const smallestAccountMin = accountsToTry.reduce((min, entry) => {
        const candidateMin = Number(entry.minQuantity || 0)
        if (candidateMin <= 0) return min
        if (min <= 0) return candidateMin
        return Math.min(min, candidateMin)
      }, 0)
      let quantityToSend = effectiveQty

      if (smallestAccountMin > 0 && effectiveQty < smallestAccountMin) {
        const { data: futurePendingRuns } = await supabase
          .from('organic_run_schedule')
          .select('id, run_number, quantity_to_send')
          .eq('engagement_order_item_id', item.id)
          .eq('status', 'pending')
          .gt('run_number', run.run_number)
          .order('run_number', { ascending: true })

        let combinedQty = effectiveQty
        const runsToMerge: string[] = []
        for (const pendingRun of futurePendingRuns || []) {
          combinedQty += Number(pendingRun.quantity_to_send || 0)
          runsToMerge.push(pendingRun.id)
          if (combinedQty >= smallestAccountMin) break
        }

        if (combinedQty >= smallestAccountMin && runsToMerge.length > 0) {
          await supabase.from('organic_run_schedule').update({
            quantity_to_send: combinedQty,
            base_quantity: combinedQty,
            error_message: `Merged ${runsToMerge.length + 1} runs to meet provider min ${smallestAccountMin}`,
            last_status_check: new Date().toISOString(),
          }).eq('id', run.id)

          await supabase.from('organic_run_schedule').update({
            status: 'cancelled',
            completed_at: new Date().toISOString(),
            error_message: `Merged into run #${run.run_number} to meet provider min ${smallestAccountMin}`,
            last_status_check: new Date().toISOString(),
          }).in('id', runsToMerge)

          effectiveQty = combinedQty
          quantityToSend = combinedQty
          run.quantity_to_send = combinedQty
          run.base_quantity = combinedQty
          // Keep strict priority order after merge — no re-sort.

          console.log(`🧩 Run #${run.run_number} merged to ${combinedQty} for ${item.engagement_type} to satisfy provider min ${smallestAccountMin}`)
        } else {
          const postponeUntil = new Date(Date.now() + ACTIVE_ORDER_RETRY_MS).toISOString()
          await supabase.from('organic_run_schedule').update({
            status: 'pending',
            scheduled_at: postponeUntil,
            error_message: `[Waiting for merge] Scheduled ${originalQty} below provider min ${smallestAccountMin}`,
            last_status_check: new Date().toISOString(),
          }).eq('id', run.id).lt('scheduled_at', postponeUntil)
          skipped++
          console.log(`⏳ Run #${run.run_number} postponed: ${originalQty} below provider min ${smallestAccountMin} and no mergeable future runs yet`)
          continue
        }
      }

      console.log(`🔄 Run #${run.run_number}: ${effectiveQty} ${item.engagement_type}, trying ${accountsToTry.length} accounts`)

      const currentStatus = isRetry ? 'failed' : 'pending'
      let runClaimed = false
      const triedProviderIds: string[] = []

      // Try each account
      let success = false
      let lastError: string | null = null
      let providerOrderId: string | null = null
      let providerResult: any = null
      let successAccount: ProviderAccount | null = null
      let verifiedStatus: string | null = null
      let verifiedRemains: number | null = null
      let verifiedStartCount: number | null = null
      let verifiedCharge: number | null = null
      let verifiedLastStatusCheck: string | null = null
      
      for (const { account: selectedAccount, providerServiceId, minQuantity: accountMinQty } of accountsToTry) {
        // NEVER boost quantity above what was scheduled — that causes over-delivery
        // (e.g. scheduled 112 views but provider min is 500 → user sees 500+ delivered).
        // Instead, skip providers whose min exceeds the scheduled qty and try the next one.
        if (accountMinQty && accountMinQty > effectiveQty) {
          lastError = `Provider ${selectedAccount.name} min ${accountMinQty} > scheduled ${effectiveQty}, skipping to avoid over-delivery`
          console.log(`⏭️ ${lastError}`)
          continue
        }
        quantityToSend = effectiveQty
        // PRE-CHECK: Cancel check
        {
          const { data: freshItem } = await supabase
            .from('engagement_order_items')
            .select('status, engagement_order:engagement_orders(status)')
            .eq('id', item.id).maybeSingle()
          
          const freshOrderStatus = (freshItem as any)?.engagement_order?.status
          const freshItemStatus = freshItem?.status
          
          if (freshOrderStatus === 'cancelled' || freshItemStatus === 'cancelled') {
            await supabase.from('organic_run_schedule').update({
              status: 'cancelled', error_message: 'Cancelled before provider send',
              completed_at: new Date().toISOString(),
            }).eq('id', run.id)
            skipped++
            break
          }
        }

        // Balance check
        const { hasBalance, balance: providerBalance } = await checkProviderBalance(selectedAccount)
        if (!hasBalance) {
          lastError = `Provider ${selectedAccount.name} has no balance`
          continue
        }
        const estimatedCost = quantityToSend * 0.0001
        if (providerBalance >= 0 && providerBalance < estimatedCost) {
          lastError = `Provider ${selectedAccount.name} balance too low (${providerBalance})`
          continue
        }

        if (!isValidHttpUrl(selectedAccount.api_url)) {
          lastError = `Provider ${selectedAccount.name} has invalid API URL`
          continue
        }
        
        triedProviderIds.push(selectedAccount.id)

        // ==========================================
        // STRICT GUARD (per-provider): The SAME provider account cannot have
        // two active orders on the same (link + engagement type). Other
        // providers are free to take this run — rotation continues normally.
        // Only when the currently-selected provider already has an active
        // order for this link+type (status='started' without terminal
        // provider status, OR provider_status is Pending / In progress /
        // Processing) do we skip THIS provider and try the next one.
        // ==========================================
        {
          const lookbackIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
          const { data: priorRuns } = await supabase
            .from('organic_run_schedule')
            .select('id, status, provider_status, provider_order_id, provider_account_id, provider_account_name, user_provider_account_id, user_provider_account_name, started_at, engagement_order_item:engagement_order_items(engagement_type, engagement_order:engagement_orders(link))')
            .or(`provider_account_id.eq.${selectedAccount.id},user_provider_account_id.eq.${selectedAccount.id}`)
            .gte('started_at', lookbackIso)
            .order('started_at', { ascending: false })
            .limit(100)

          const conflictingRun = (priorRuns || []).find((pr: any) => {
            if (pr.id === run.id) return false
            if (getRunProviderAccountId(pr) !== selectedAccount.id) return false
            const prLink = normalizeLink(getNestedEngagementOrderLink(pr.engagement_order_item))
            const prType = (pr.engagement_order_item?.engagement_type || '').toLowerCase().trim()
            if (prLink !== sameLink || prType !== currentTypeNormalized) return false
            if (pr.status === 'started' && !isTerminalProviderStatus(pr.provider_status)) return true
            if (isActiveProviderStatus(pr.provider_status)) return true
            return false
          })

          if (conflictingRun) {
            // Mark this provider as busy for this run and try the next provider.
            if (!busyAccountIds.includes(selectedAccount.id)) {
              busyAccountIds.push(selectedAccount.id)
            }
            lastError = `${selectedAccount.name} already has an active order on this link+${currentTypeNormalized} — trying next provider`
            console.log(`↪️ Run #${run.run_number}: ${selectedAccount.name} busy on same link+type, rotating to next provider`)
            continue
          }
        }

        if (!runClaimed) {
          const { error: claimError, locked: lockAcquired } = await claimRunLock({
            supabase,
            runId: run.id,
            expectedStatus: currentStatus,
            maxScheduledAt: nowWithBuffer,
            updates: {
              status: 'started',
              started_at: new Date().toISOString(),
              completed_at: null,
              error_message: `Trying ${selectedAccount.name}...`,
              retry_count: (run.retry_count || 0) + (isRetry ? 1 : 0),
              provider_order_id: null,
              provider_status: null,
              provider_response: null,
              provider_account_id: (selectedAccount as any).isUserOwned ? null : selectedAccount.id,
              provider_account_name: selectedAccount.name,
              user_provider_account_id: (selectedAccount as any).isUserOwned ? selectedAccount.id : null,
              user_provider_account_name: (selectedAccount as any).isUserOwned ? selectedAccount.name : null,
              rotation_lock_key: `${sameLinkNormalized}|${currentTypeNormalized}|${selectedAccount.id}`,
              last_status_check: new Date().toISOString(),

            },
          })

          if (claimError) {
            console.error(`❌ Failed to claim run lock for ${run.id}:`, claimError)
            lastError = `Run claim failed: ${claimError.message || 'unknown error'}`
            break
          }

          if (!lockAcquired) {
            console.log(`⏭️ Run #${run.run_number} already claimed by another execution, skipping duplicate send`)
            skipped++
            lastError = null
            break
          }

          runClaimed = true
        } else {
          await supabase.from('organic_run_schedule').update({
            error_message: `Trying ${selectedAccount.name}...`,
            provider_account_id: (selectedAccount as any).isUserOwned ? null : selectedAccount.id,
            provider_account_name: selectedAccount.name,
            user_provider_account_id: (selectedAccount as any).isUserOwned ? selectedAccount.id : null,
            user_provider_account_name: (selectedAccount as any).isUserOwned ? selectedAccount.name : null,
            rotation_lock_key: `${sameLinkNormalized}|${currentTypeNormalized}|${selectedAccount.id}`,
            provider_order_id: null,

            provider_status: null,
            provider_response: null,
            last_status_check: new Date().toISOString(),
          }).eq('id', run.id).eq('status', 'started')
        }

        // RACE GUARD: another cron invocation may have claimed a different run
        // for this same provider/link/type between our pre-check and this claim.
        // Re-check AFTER this run is locked as started, before sending to provider.
        // If busy, keep this run claimed only long enough to rotate to the next
        // provider in this loop; if no provider works, the final retry update below
        // returns it to queued/pending without creating a duplicate external order.
        {
          const lookbackIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
          const { data: postClaimRuns } = await supabase
            .from('organic_run_schedule')
            .select('id, status, provider_status, provider_order_id, provider_account_id, user_provider_account_id, started_at, engagement_order_item:engagement_order_items(engagement_type, engagement_order:engagement_orders(link))')
            .or(`provider_account_id.eq.${selectedAccount.id},user_provider_account_id.eq.${selectedAccount.id}`)
            .gte('started_at', lookbackIso)
            .order('started_at', { ascending: false })
            .limit(100)

          const postClaimConflict = (postClaimRuns || []).find((pr: any) => {
            if (pr.id === run.id) return false
            if (getRunProviderAccountId(pr) !== selectedAccount.id) return false
            const prLink = normalizeLink(getNestedEngagementOrderLink(pr.engagement_order_item))
            const prType = (pr.engagement_order_item?.engagement_type || '').toLowerCase().trim()
            if (prLink !== sameLink || prType !== currentTypeNormalized) return false
            if (pr.status === 'started' && !isTerminalProviderStatus(pr.provider_status)) return true
            if (isActiveProviderStatus(pr.provider_status)) return true
            return false
          })

          if (postClaimConflict) {
            if (!busyAccountIds.includes(selectedAccount.id)) busyAccountIds.push(selectedAccount.id)
            lastError = `${selectedAccount.name} already has an active order on this link+${currentTypeNormalized} — trying next provider`
            console.log(`🔒 Race guard: run #${run.run_number} will not send to ${selectedAccount.name}; provider already busy on same link+type`)
            await supabase.from('organic_run_schedule').update({
              error_message: `[Queued] ${selectedAccount.name} busy on this link+${currentTypeNormalized}, trying next provider`,
              last_status_check: new Date().toISOString(),
            }).eq('id', run.id).eq('status', 'started')
            continue
          }
        }

        try {
          const formData = new URLSearchParams()
          formData.append('key', selectedAccount.api_key)
          formData.append('action', 'add')
          formData.append('service', providerServiceId)
          formData.append('link', sanitizeProviderLink(item.engagement_order.link))
          // OVER-DELIVERY GUARD: if admin configured this provider to over-deliver (e.g. 2.0 = sends 2x),
          // divide the scheduled qty so the user's video ultimately receives the correct amount.
          const deliveryMultiplier = Math.max(Number(selectedAccount.delivery_multiplier || 1), 0.5)
          let adjustedQty = quantityToSend
          if (deliveryMultiplier > 1) {
            adjustedQty = Math.max(1, Math.round(quantityToSend / deliveryMultiplier))
            console.log(`📉 Over-delivery guard: ${selectedAccount.name} multiplier=${deliveryMultiplier}, sending ${adjustedQty} instead of ${quantityToSend}`)
          }
          // Respect provider min even after dividing
          if (accountMinQty && adjustedQty < accountMinQty) {
            adjustedQty = accountMinQty
          }
          formData.append('quantity', adjustedQty.toString())

          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 30000)

          const response = await fetch(selectedAccount.api_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString(),
            signal: controller.signal,
          })

          clearTimeout(timeoutId)
          const responseText = await response.text()
          console.log(`Provider response from ${selectedAccount.name}: ${responseText}`)

          let result
          try { result = JSON.parse(responseText) } catch { result = { error: responseText } }

          if (result.status === 'fail' || result.error) {
            lastError = result.message || result.error
            if (lastError === null || lastError === undefined) lastError = 'Unknown provider error'
            if (typeof lastError !== 'string') lastError = JSON.stringify(lastError)
            providerResult = result
            
            const isActiveOrderError = isActiveOrderErrorMsg(lastError)
            if (isActiveOrderError) {
              await new Promise(resolve => setTimeout(resolve, 200))
              continue
            }
            
            const isTemporaryError = TEMPORARY_ERRORS.some(err => lastError!.toLowerCase().includes(err.toLowerCase()))
            if (isTemporaryError) {
              await new Promise(resolve => setTimeout(resolve, 200))
              continue
            }
            
            const isAccountSpecificError = ACCOUNT_SPECIFIC_ERRORS.some(err => lastError!.toLowerCase().includes(err.toLowerCase()))
            if (isAccountSpecificError) {
              await new Promise(resolve => setTimeout(resolve, 200))
              continue
            }
            
            const isTryNextProviderError = TRY_NEXT_PROVIDER_ERRORS.some(err => lastError!.toLowerCase().includes(err.toLowerCase()))
            if (isTryNextProviderError) {
              await new Promise(resolve => setTimeout(resolve, 200))
              continue
            }
            
            break
          } else {
            providerOrderId = result.order?.toString() || result.id?.toString() || null

            if (!providerOrderId) {
              lastError = 'Provider returned success but no order id'
              providerResult = result
              continue
            }

            // Immediate live-count verification: capture provider start/remains as soon
            // as the run is created so target = first_start_count + ordered_quantity
            // is enforced before the next scheduled run is allowed through.
            verifiedStatus = 'Pending'
            providerResult = { add: result }
            try {
              const statusForm = new URLSearchParams()
              statusForm.append('key', selectedAccount.api_key)
              statusForm.append('action', 'status')
              statusForm.append('order', providerOrderId)
              const statusCtrl = new AbortController()
              const statusTimer = setTimeout(() => statusCtrl.abort(), 8000)
              const statusResponse = await fetch(selectedAccount.api_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: statusForm.toString(),
                signal: statusCtrl.signal,
              })
              clearTimeout(statusTimer)
              const statusText = await statusResponse.text()
              let statusResult: any = {}
              try { statusResult = JSON.parse(statusText) } catch { statusResult = { error: statusText } }
              if (!statusResult.error) {
                verifiedStatus = statusResult.status || verifiedStatus
                const remainsValue = statusResult.remains !== undefined && statusResult.remains !== null
                  ? Number(statusResult.remains)
                  : null
                const startValue = statusResult.start_count !== undefined && statusResult.start_count !== null
                  ? Number(statusResult.start_count)
                  : null
                const chargeValue = statusResult.charge !== undefined && statusResult.charge !== null
                  ? Number(statusResult.charge)
                  : null
                verifiedRemains = Number.isFinite(remainsValue) ? remainsValue : null
                verifiedStartCount = Number.isFinite(startValue) ? startValue : null
                verifiedCharge = Number.isFinite(chargeValue) ? chargeValue : null
                verifiedLastStatusCheck = new Date().toISOString()
                providerResult = { add: result, initial_status: statusResult }
              } else {
                providerResult = { add: result, initial_status_error: statusResult.error }
              }
            } catch (statusError) {
              providerResult = { add: result, initial_status_error: (statusError as Error).message || 'Status check failed' }
            }
            successAccount = selectedAccount
            success = true
            await updateAccountLastUsed(supabase, selectedAccount.id)
            console.log(`✅ Run #${run.run_number} placed via ${selectedAccount.name}! Order ID: ${providerOrderId} (initial live count checked)`)
            break
          }
        } catch (fetchError: any) {
          const uncertainDispatchAt = new Date().toISOString()
          const uncertainMessage = `Network error after provider request. [Dispatch uncertain] Verify provider before retrying: ${fetchError.message || 'Unknown'}`

          await supabase.from('organic_run_schedule').update({
            status: 'started',
            started_at: run.started_at || uncertainDispatchAt,
            completed_at: null,
            error_message: uncertainMessage,
            provider_response: {
              uncertain_dispatch: true,
              stage: 'provider_add_request',
              fetch_error: fetchError.message || 'Unknown',
              happened_at: uncertainDispatchAt,
            },
            last_status_check: uncertainDispatchAt,
          }).eq('id', run.id).eq('status', 'started')

          lastError = null
          console.error(`🚨 Dispatch uncertain for run #${run.run_number}; resend blocked to avoid duplicate provider order`, fetchError)
          skipped++
          break
        }
      }

      // Update run based on result
      if (success && providerOrderId && successAccount) {
        const { data: freshItemPostSend } = await supabase
          .from('engagement_order_items')
          .select('status, engagement_order:engagement_orders(status)')
          .eq('id', item.id).maybeSingle()
        
        const postSendOrderStatus = (freshItemPostSend as any)?.engagement_order?.status
        const postSendItemStatus = freshItemPostSend?.status
        
        if (postSendOrderStatus === 'cancelled' || postSendItemStatus === 'cancelled') {
          await supabase.from('organic_run_schedule').update({
            status: 'cancelled', provider_order_id: providerOrderId,
            provider_response: providerResult,
            provider_account_id: (successAccount as any).isUserOwned ? null : successAccount.id,
            provider_account_name: successAccount.name,
            user_provider_account_id: (successAccount as any).isUserOwned ? successAccount.id : null,
            user_provider_account_name: (successAccount as any).isUserOwned ? successAccount.name : null,
            rotation_lock_key: null,
            provider_status: verifiedStatus,
            error_message: `Order cancelled during send — provider order ${providerOrderId} may need manual cancellation`,
            completed_at: new Date().toISOString(), last_status_check: new Date().toISOString(),
          }).eq('id', run.id)

          skipped++
          continue
        }
        
        // Update run + item + order in parallel
        const providerDeliveredAll = verifiedRemains === 0 && !isFailedProviderStatus(verifiedStatus)
        const providerIsTerminal = isTerminalProviderStatus(verifiedStatus) || providerDeliveredAll

        const updatePromises = [
          supabase.from('organic_run_schedule').update({
            provider_order_id: providerOrderId, provider_response: providerResult,
            error_message: null,
            provider_account_id: (successAccount as any).isUserOwned ? null : successAccount.id,
            provider_account_name: successAccount.name,
            user_provider_account_id: (successAccount as any).isUserOwned ? successAccount.id : null,
            user_provider_account_name: (successAccount as any).isUserOwned ? successAccount.name : null,
            rotation_lock_key: providerIsTerminal ? null : `${sameLinkNormalized}|${currentTypeNormalized}|${successAccount.id}`,
            provider_status: verifiedStatus,
            provider_start_count: verifiedStartCount, provider_remains: verifiedRemains,
            provider_charge: verifiedCharge,

            ...(providerIsTerminal
              ? {
                  status: 'completed',
                  completed_at: new Date().toISOString(),
                  ...(providerDeliveredAll && !isTerminalProviderStatus(verifiedStatus)
                    ? { error_message: 'Auto-completed (provider remains reached 0)' }
                    : {}),
                }
              : {}),
            last_status_check: verifiedLastStatusCheck || new Date().toISOString(),
          }).eq('id', run.id).eq('status', 'started'),
          supabase.from('engagement_order_items').update({ status: 'processing' })
            .eq('id', item.id).not('status', 'in', '("cancelled","paused")'),
          supabase.from('engagement_orders').update({ status: 'processing' })
            .eq('id', item.engagement_order_id).not('status', 'in', '("cancelled","paused")'),
        ]
        
        const [runUpdateResult] = await Promise.all(updatePromises)
        
        if (!runUpdateResult.data || runUpdateResult.data.length === 0) {
          skipped++
          continue
        }

        if (!executionProviderMap.has(localExecutionKey)) {
          executionProviderMap.set(localExecutionKey, new Set())
        }
        executionProviderMap.get(localExecutionKey)!.add(successAccount.id)

        processed++
        results.push({ 
          run_id: run.id, type: item.engagement_type, run_number: run.run_number,
          success: true, provider_order_id: providerOrderId,
          account_used: successAccount.name, accounts_tried: accountsToTry.length,
          status: providerIsTerminal ? 'completed' : 'started',
        })

        await syncEngagementItemTracking(supabase, item.id)
        await updateEngagementOrderStatus(supabase, item.engagement_order_id, item.id)
      } else if (lastError !== null) {
        const retryCount = (run.retry_count || 0) + 1
        const lastErr = (lastError || '').toLowerCase()
        const isActiveOrderError = isActiveOrderErrorMsg(lastErr)

        const retryUpdate: any = {
          status: 'pending', started_at: null, completed_at: null,
          error_message: isActiveOrderError
            ? `[Queued #${retryCount}] All ${accountsToTry.length} accounts busy for this link: ${lastError}`
            : `[Auto-retry #${retryCount}] Temporary provider error: ${lastError}`,
          provider_response: {
            ...(providerResult || {}),
            tried_providers: triedProviderIds,
          },
          provider_account_id: null,
          provider_account_name: null,
          user_provider_account_id: null,
          user_provider_account_name: null,
          rotation_lock_key: null,

          provider_order_id: null,
          provider_status: null,
          retry_count: retryCount, last_status_check: new Date().toISOString(),
        }

        let postponeMs = 0
        postponeMs = isActiveOrderError ? ACTIVE_ORDER_RETRY_MS : TEMPORARY_RETRY_MS

        // Provider-busy / active-order is a queue state, not a real reschedule.
        // Keep the user's/manual scheduled_at exactly as-is (including past dates)
        // so order history does not jump from "15 days ago" to "in 1 minute".
        // last_status_check + the fetch cooldown above prevents hammering providers.
        if (!isActiveOrderError) {
          retryUpdate.scheduled_at = new Date(Date.now() + postponeMs).toISOString()
        }

        let retryQuery = supabase.from('organic_run_schedule')
          .update(retryUpdate)
          .eq('id', run.id)

        if (retryUpdate.scheduled_at) {
          retryQuery = retryQuery.lt('scheduled_at', retryUpdate.scheduled_at)
        }

        await retryQuery
        skipped++

        // Do not batch-queue the whole link/type when one provider says "active order".
        // Only the current run waits briefly; the next run can still try other free
        // priority providers in the same cron tick.
        results.push({ run_id: run.id, type: item.engagement_type, run_number: run.run_number, 
          success: false, error: lastError, will_retry: true, retry_attempt: retryCount, postponed_min: postponeMs / 60000 })
      }

      // No artificial delay between runs — max throughput at scale.
    }

    // ==========================================
    // STEP 2: Process LEGACY ORDER runs
    // ==========================================
    console.log(`\n--- Processing Legacy Order Runs ---`)
    
    const { data: legacyRuns } = await supabase
      .from('organic_run_schedule')
      .select(`*, order:orders(*, service:services(*))`)
      .eq('status', 'pending')
      .lte('scheduled_at', nowWithBuffer)
      .not('order_id', 'is', null)
      .is('engagement_order_item_id', null)
      .order('scheduled_at', { ascending: true })
      .limit(10)

    console.log(`Found ${legacyRuns?.length || 0} pending legacy runs`)

    for (const run of legacyRuns || []) {
      if (Date.now() - startTime > 55000) {
        shouldContinue = true
        continuationReason = continuationReason || 'legacy-time-slice-exhausted'
        console.log(`⏰ Approaching timeout, stopping legacy processing.`)
        break
      }

      const order = run.order
      if (!order || !order.service) continue

      if (order.status === 'cancelled') {
        await supabase.from('organic_run_schedule').update({
          status: 'cancelled', error_message: 'Order cancelled by user',
          completed_at: new Date().toISOString(),
        }).eq('id', run.id)
        skipped++
        continue
      }
      
      if (order.status === 'paused') { skipped++; continue }

      const startedRunsForOrder = (activeRuns || []).filter((r: any) => r.order_id === order.id)

      if (startedRunsForOrder && startedRunsForOrder.length > 0) {
        const stuckRun = startedRunsForOrder[0]
        const terminalStatuses = ['Completed', 'Partial', 'Refunded', 'Canceled', 'Cancelled', 'Error', 'Failed']
        const isTerminal = stuckRun.provider_status && terminalStatuses.includes(stuckRun.provider_status)
        const startedAt = new Date(stuckRun.started_at || 0)
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)
        const isStuckWithoutStatus = startedAt < twoMinutesAgo && !stuckRun.provider_status
        const isInProgressTooLong = startedAt < twoMinutesAgo && stuckRun.provider_status === 'In progress'
        const isPendingTooLong = startedAt < twoMinutesAgo && stuckRun.provider_status === 'Pending'
        
        if (isTerminal || isStuckWithoutStatus || isInProgressTooLong || isPendingTooLong) {
          // SCAM GUARD: detect 0-delivered fake completions and retry instead
          const qty = stuckRun.quantity_to_send || 0
          const remains = typeof stuckRun.provider_remains === 'number' ? stuckRun.provider_remains : null
          const startCount = typeof stuckRun.provider_start_count === 'number' ? stuckRun.provider_start_count : null
          const deliveredZero = remains !== null && qty > 0 && remains >= qty && (startCount === null || startCount === 0)
          const retryCount = stuckRun.retry_count || 0
          if (deliveredZero && !isTerminal && retryCount < 15) {
            await supabase.from('organic_run_schedule').update({
              status: 'failed', completed_at: new Date().toISOString(),
              error_message: `Auto-retry: provider ${stuckRun.provider_status || 'unknown'} with 0 delivered (remains=${remains}/${qty})`,
            }).eq('id', stuckRun.id)
          } else {
            await supabase.from('organic_run_schedule').update({
              status: 'completed', completed_at: new Date().toISOString(),
              error_message: `Auto-completed (status: ${stuckRun.provider_status || 'unknown'})`,
            }).eq('id', stuckRun.id)
          }
        } else {
          if (hasUncertainDispatch(stuckRun)) {
            skipped++
            continue
          }

          const runAge = Math.round((Date.now() - startedAt.getTime()) / 1000)
          if (runAge < 60) { skipped++; continue }
        }
      }

      // STRICT MAPPING — legacy orders must also respect service_provider_mapping
      // when configured. If no mapping is configured, postpone (so admin can add one).
      const mappedAccountsLegacy = await mappingCache.getForService(
        supabase, order.service.id, [], executionId
      )
      const hasLegacyMapping = mappingCache.hasConfiguredMappingForService(order.service.id)

      let provider: any = null
      let providerServiceIdOverride: string | null = null

      if (hasLegacyMapping) {
        if (mappedAccountsLegacy.length === 0) {
          await supabase.from('organic_run_schedule').update({
            error_message: '[Queued] All mapped providers busy for this link',
            last_status_check: new Date().toISOString(),
          }).eq('id', run.id)
          skipped++
          continue
        }
        const chosen = mappedAccountsLegacy[0]
        provider = {
          id: chosen.account.id,
          provider_id: chosen.account.provider_id,
          name: chosen.account.name,
          api_key: chosen.account.api_key,
          api_url: chosen.account.api_url,
        }
        providerServiceIdOverride = chosen.providerServiceId || null
      } else {
        // No mapping configured — wait until admin maps a provider in
        // Admin → Service Provider Mapping. Do NOT fall back to service.provider_id.
        const postponeMs = 5 * 60 * 1000
        const postponeUntil = new Date(Date.now() + postponeMs).toISOString()
        await supabase.from('organic_run_schedule').update({
          scheduled_at: postponeUntil,
          error_message: '[Waiting] No provider mapped for this service — add a mapping in Admin → Service Provider Mapping',
          last_status_check: new Date().toISOString(),
        }).eq('id', run.id).lt('scheduled_at', postponeUntil)
        skipped++
        continue
      }

      if (!provider || !isValidHttpUrl(provider.api_url)) {
        await supabase.from('organic_run_schedule').update({
          status: 'failed', error_message: 'Mapped provider has invalid API URL',
        }).eq('id', run.id)
        failed++
        continue
      }

      const { error: updateError, locked: lockAcquired } = await claimRunLock({
        supabase,
        runId: run.id,
        expectedStatus: 'pending',
        updates: { status: 'started', started_at: new Date().toISOString() },
      })

      if (updateError) continue
      if (!lockAcquired) {
        skipped++
        continue
      }

      let lastError: string | null = null
      let providerOrderId: string | null = null

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const formData = new URLSearchParams()
          formData.append('key', provider.api_key)
          formData.append('action', 'add')
          formData.append('service', providerServiceIdOverride || order.service.provider_service_id)
          formData.append('link', sanitizeProviderLink(order.link))
          formData.append('quantity', run.quantity_to_send.toString())

          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 30000)
          const response = await fetch(provider.api_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString(), signal: controller.signal,
          })
          clearTimeout(timeoutId)
          const result = await response.json().catch(() => ({ error: 'Invalid response' }))

          if (result.status === 'fail' || result.error) {
            lastError = result.message || result.error
            if (typeof lastError !== 'string') lastError = JSON.stringify(lastError)
            const isTemporaryError = TEMPORARY_ERRORS.some(err => lastError!.toLowerCase().includes(err.toLowerCase()))
            if (isTemporaryError) { lastError = `TEMP_ERROR: ${lastError}`; break }
            if (attempt < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt))
              retried++; continue
            }
          } else {
            providerOrderId = result.order?.toString() || result.id?.toString()
            break
          }
        } catch (fetchError: any) {
          const uncertainDispatchAt = new Date().toISOString()
          await supabase.from('organic_run_schedule').update({
            status: 'started',
            started_at: run.started_at || uncertainDispatchAt,
            completed_at: null,
            error_message: `Network error after provider request. [Dispatch uncertain] Verify provider before retrying: ${fetchError.message || 'Unknown'}`,
            provider_response: {
              uncertain_dispatch: true,
              stage: 'provider_add_request',
              fetch_error: fetchError.message || 'Unknown',
              happened_at: uncertainDispatchAt,
            },
          }).eq('id', run.id).eq('status', 'started')

          lastError = null
          skipped++
          break
        }
      }

      if (providerOrderId) {
        await supabase.from('organic_run_schedule').update({ provider_order_id: providerOrderId }).eq('id', run.id)
        await supabase.from('orders').update({ status: 'processing' }).eq('id', order.id)
        processed++
      } else {
        const isTemporaryError = lastError?.startsWith('TEMP_ERROR:')
        if (isTemporaryError) {
          const cleanError = lastError?.replace('TEMP_ERROR: ', '') || ''
          const isActiveOrder = isActiveOrderErrorMsg(cleanError)
          const retryUpdate: any = {
            status: 'pending', started_at: null,
            error_message: isActiveOrder ? `[Queued] ${cleanError}` : `[Will retry] ${cleanError}`,
          }
          if (!isActiveOrder) {
            retryUpdate.scheduled_at = new Date(Date.now() + TEMPORARY_RETRY_MS).toISOString()
          }
          let retryQuery = supabase.from('organic_run_schedule').update(retryUpdate).eq('id', run.id)
          if (retryUpdate.scheduled_at) {
            retryQuery = retryQuery.lt('scheduled_at', retryUpdate.scheduled_at)
          }
          await retryQuery
          skipped++
        } else {
          await supabase.from('organic_run_schedule').update({
            status: 'failed', error_message: lastError || 'Failed after retries',
          }).eq('id', run.id)
          failed++
        }
      }
    }

    const totalTime = Date.now() - startTime

    if (shouldContinue && chainDepth < MAX_CHAIN_DEPTH) {
      await triggerContinuation(executionId, continuationReason || 'time-slice-exhausted', chainDepth + 1)
    } else if (shouldContinue) {
      console.log(`⛔ Continuation chain capped at depth ${chainDepth}; next cron tick will resume.`)
    }

    console.log(`\n=== EXECUTION COMPLETE [${executionId}] in ${totalTime}ms ===`)
    console.log(`Processed: ${processed}, Skipped: ${skipped}, Failed: ${failed}, Retried: ${retried}`)

    // Send admin alert if failures
    if (failed > 10) {
      try {
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-admin-alert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}` },
          body: JSON.stringify({
            job_name: 'execute-all-runs', execution_id: executionId,
            failed_count: failed, processed_count: processed, skipped_count: skipped,
            error_details: results.filter(r => !r.success).slice(0, 10).map(r => ({
              run_id: r.run_id, run_number: r.run_number, type: r.type, error: r.error
            }))
          })
        })
      } catch (alertError) {
        console.error('Failed to send admin alert:', alertError)
      }
    }

    console.log(`✅ Background execution [${executionId}] complete: ${processed} processed, ${skipped} skipped, ${failed} failed`)

  } catch (error: any) {
    console.error(`❌ Background execution error:`, error)
  }
}
