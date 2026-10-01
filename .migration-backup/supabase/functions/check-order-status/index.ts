import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// Module-level client - reused across invocations for connection pooling
const supabase = createClient(
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

// Wrap fetch with a hard per-request timeout so one slow provider can't stall
// the whole cron invocation. Aborted requests throw and are caught by the
// existing try/catch that increments `stillProcessing`.
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// AES-GCM decryption for user_provider_accounts.api_key_ciphertext
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
const _decryptCache = new Map<string, string>()
async function decryptUserApiKey(accountId: string, payload: string): Promise<string> {
  const cached = _decryptCache.get(accountId)
  if (cached) return cached
  const key = await _getUpKey()
  const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
  const iv = bytes.slice(0, 12)
  const ct = bytes.slice(12)
  const plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct))
  _decryptCache.set(accountId, plain)
  return plain
}


// Wall-clock budget so we always return under the edge-function limit and let
// the cron job pick up the remaining runs on the next tick instead of 504-ing.
const CHECK_STATUS_BUDGET_MS = 110_000
const CHECK_STATUS_BATCH_LIMIT = 150

// Stop future runs when public delivery already reached the target, even if a provider over-delivers.
function calculateObservedRunDelivery(run: any): number {
  const providerStatus = (run?.provider_status || '').toString().toLowerCase().trim()

  if (providerStatus === 'completed' || providerStatus === 'complete' || providerStatus === 'success') {
    return Number(run?.quantity_to_send || 0)
  }

  if (run?.provider_remains !== null && run?.provider_remains !== undefined) {
    return Math.max(0, Number(run?.quantity_to_send || 0) - Number(run?.provider_remains || 0))
  }

  return 0
}

async function syncObservedOverdeliveryGuard(supabase: any, itemId?: string | null) {
  if (!itemId) return

  const tracking = await syncEngagementItemTracking(supabase, itemId)
  if (tracking?.targetReached) return

  const { data: item } = await supabase
    .from('engagement_order_items')
    .select('id, quantity, status')
    .eq('id', itemId)
    .maybeSingle()

  if (!item || item.status === 'cancelled') return

  const orderedQty = Number(item.quantity || 0)
  if (orderedQty <= 0) return

  const { data: runs } = await supabase
    .from('organic_run_schedule')
    .select('id, quantity_to_send, status, provider_start_count, provider_remains, provider_status')
    .eq('engagement_order_item_id', itemId)
    .in('status', ['pending', 'started', 'completed', 'failed'])

  if (!runs?.length) return

  const askedSent = runs.reduce((sum: number, run: any) => {
    if (run.status === 'started' || run.status === 'completed') {
      return sum + Number(run.quantity_to_send || 0)
    }
    return sum
  }, 0)

  const observedByRuns = runs.reduce(
    (sum: number, run: any) => sum + calculateObservedRunDelivery(run),
    0,
  )

  const startCounts = runs
    .map((run: any) => Number(run.provider_start_count))
    .filter((value: number) => Number.isFinite(value) && value > 0)

  const publicCountDelta = startCounts.length > 0
    ? Math.max(0, Math.max(...startCounts) - Math.min(...startCounts))
    : 0

  // Actual delivery must come from provider remains/status or reliable public count delta.
  // `askedSent` only means sent to provider, so it can stop pending runs but must not
  // mark the item completed before the target is visible/reported.
  const actualDelivered = Math.max(observedByRuns, publicCountDelta)
  const reservedOrDelivered = Math.max(askedSent, actualDelivered)
  if (reservedOrDelivered < orderedQty) return

  // Do not move pending schedules here. This function only checks provider
  // status; changing scheduled_at makes manually back-dated runs jump to
  // "in 5 minutes" in order history. The dispatch scheduler uses
  // last_status_check/error_message for cooldown/visibility.
  await supabase.from('organic_run_schedule').update({
    error_message: `Delivery reserved (asked=${askedSent}, observed=${observedByRuns}, public_delta=${publicCountDelta}, target=${orderedQty}) — awaiting live target count`,
    last_status_check: new Date().toISOString(),
  }).eq('engagement_order_item_id', itemId).eq('status', 'pending')

  if (actualDelivered >= orderedQty) {
    const finalTracking = await syncEngagementItemTracking(supabase, itemId)
    if (finalTracking?.targetReached) {
      await supabase.from('engagement_order_items').update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      }).eq('id', itemId).neq('status', 'completed')
    } else {
      await supabase.from('engagement_order_items').update({
        status: 'processing',
        updated_at: new Date().toISOString(),
      }).eq('id', itemId).not('status', 'in', '("cancelled","paused","completed")')
    }
  } else {
    await supabase.from('engagement_order_items').update({
      status: 'processing',
      updated_at: new Date().toISOString(),
    }).eq('id', itemId).not('status', 'in', '("cancelled","paused","completed")')
  }
}

function getRunObservedCurrentCount(run: any): number | null {
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

async function syncEngagementItemTracking(supabase: any, itemId?: string | null) {
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

  // Filter: only runs where provider ACTUALLY returned a start_count. Explicit
  // null check — Number(null)===0 was previously dragging baseline to 0.
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

  // Delivery-based progress: SUM across all runs (not MAX of individual runs).
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
  // Do NOT force back to 'processing' when target not reached — downstream
  // updateEngagementOrderStatus decides based on ACTUAL run outcomes so items
  // whose providers don't expose a public counter don't get stuck.

  await supabase.from('engagement_order_items').update(itemUpdate).eq('id', itemId)

  return { baseline, current, target, remaining, targetReached, engagementOrderId: item.engagement_order_id }
}

function isProviderStatusLookupMiss(errorMsg: string): boolean {
  const lower = errorMsg.toLowerCase()
  return lower.includes('incorrect order') || lower.includes('wrong order') || lower.includes('order not found') || lower.includes('not found')
}

function isProviderCredentialError(errorMsg: string): boolean {
  const lower = errorMsg.toLowerCase()
  return (
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key') ||
    lower.includes('wrong api key') ||
    lower.includes('api key invalid') ||
    lower.includes('bad api key') ||
    lower.includes('invalid key') ||
    lower.includes('incorrect key') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication failed') ||
    lower.includes('auth failed')
  )
}

function getRunAgeMinutes(run: any): number {
  const startedAt = new Date(run?.started_at || run?.scheduled_at || Date.now()).getTime()
  return Math.max(0, Math.round((Date.now() - startedAt) / 60000))
}

// This function checks provider order status and marks runs as complete
// Supports BOTH legacy orders AND new engagement orders
// Stores real-time provider data (start_count, remains, status) for live tracking
// Should be called by cron job every 2 minutes OR on-demand for instant updates
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Auth check - this is a cron/internal function.
    // Service-role tokens have no user `sub`, so accept them by verified role claim.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const token = authHeader.replace('Bearer ', '').trim()
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
    const payload = decodeJwtPayload(token)
    const isSystemCall = !!token && (token === serviceKey || (cronSecret && token === cronSecret) || payload?.role === 'service_role')
    if (!isSystemCall) {
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token)
      if (claimsError || !claimsData?.claims?.sub) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // Check if specific run ID was passed (for on-demand check)
    let targetRunId: string | null = null
    try {
      const body = await req.json()
      targetRunId = body?.runId || null
    } catch {
      // No body or invalid JSON - check all
    }

    console.log(`=== CHECK PROVIDER ORDER STATUS ===`)
    console.log(`Time: ${new Date().toISOString()}`)
    console.log(`Target Run: ${targetRunId || 'ALL STARTED RUNS'}`)

    const invocationStart = Date.now()
    let budgetExceeded = false
    const overBudget = () => (Date.now() - invocationStart) > CHECK_STATUS_BUDGET_MS

    // Heavy per-item/order rollups are deduped and flushed once after the loop
    // instead of running for every single run (that was blowing the CPU budget
    // and killing the invocation before the batch finished).
    const pendingRollups = new Map<string, string | null>()
    const queueRollup = (itemId?: string | null, orderId?: string | null) => {
      if (!itemId) return
      pendingRollups.set(itemId, orderId || pendingRollups.get(itemId) || null)
    }
    const ROLLUP_LIMIT = 25
    const flushRollups = async () => {
      const entries = Array.from(pendingRollups.entries())
      pendingRollups.clear()
      let done = 0
      for (const [itemId, orderId] of entries) {
        // Item/order completion is also enforced by DB triggers
        // (auto_complete_engagement_order_item / auto_complete_engagement_order),
        // so cap this expensive extra sync and never blow the invocation budget.
        if (done >= ROLLUP_LIMIT || overBudget()) break
        done++
        try {
          await syncObservedOverdeliveryGuard(supabase, itemId)
          if (orderId) await updateEngagementOrderStatus(supabase, orderId, itemId)
        } catch (e) {
          console.error(`Rollup failed for item ${itemId}:`, e)
        }
      }
    }

    let completed = 0
    let stillProcessing = 0
    let failed = 0
    let skippedOverBudget = 0
    const results: any[] = []

    // ============================================
    // STEP 1: Check ENGAGEMENT ORDER runs (via engagement_order_item)
    // ============================================
    console.log(`\n--- Checking Engagement Order Runs ---`)
    
    let engagementQuery = supabase
      .from('organic_run_schedule')
      .select(`
        *,
        retry_count,
        provider_account:provider_accounts(id, name, api_key, api_url),
        user_provider_account:user_provider_accounts(id, name, api_key_ciphertext, api_url),

        engagement_order_item:engagement_order_items(
          id,
          status,
          engagement_type,
          engagement_order_id,
          service:services(provider_id),
          engagement_order:engagement_orders(id, status)
        )
      `)
      // Check ALL of these:
      // 1) started runs (normal — actively waiting for provider)
      // 2) "auto-completed" runs still pending/in-progress at provider
      // 3) completed runs whose provider_status is NOT terminal — keep syncing delivery data
      .or(
        'status.eq.started,' +
        'and(status.eq.completed,error_message.ilike.%Auto-completed%,provider_status.in.(Pending,In progress,Processing,Inprogress,Awaiting)),' +
        'and(status.eq.completed,provider_status.not.in.(Completed,Complete,Partial,Refunded,Canceled,Cancelled,Error,Failed,Success,Refund,Canscelled)),' +
        'and(status.eq.failed,provider_status.in.(Pending,In progress,Processing,Inprogress,Awaiting))'
      )
      .not('provider_order_id', 'is', null)
      .not('engagement_order_item_id', 'is', null)

    if (targetRunId) {
      engagementQuery = engagementQuery.eq('id', targetRunId)
    } else {
      // Process oldest-checked runs first and cap the batch so one invocation
      // finishes inside the edge-function time budget. Remaining runs are
      // picked up on the next cron tick.
      // Skip runs already checked in the last 2 minutes so every tick rotates to
      // the older backlog instead of re-polling the same freshly checked runs.
      engagementQuery = engagementQuery
        .or(`last_status_check.is.null,last_status_check.lt.${new Date(Date.now() - 120_000).toISOString()}`)
        .order('last_status_check', { ascending: true, nullsFirst: true })
        .limit(CHECK_STATUS_BATCH_LIMIT)
    }

    const { data: engagementRuns, error: engagementError } = await engagementQuery

    if (engagementError) {
      console.error('Error fetching engagement runs:', engagementError)
    }

    console.log(`Found ${engagementRuns?.length || 0} engagement runs waiting for completion`)

    // Bulk provider-status cache (filled via action=multistatus, see below)
    const multiStatusCache = new Map<string, any>()
    const multiStatusTried = new Set<string>()


    // Process each run individually using its ACTUAL provider account
    // (Not grouped by service provider_id - that was the bug!)
    for (const run of engagementRuns || []) {
      if (!targetRunId && overBudget()) {
        budgetExceeded = true
        skippedOverBudget++
        continue
      }
      try {
        const orderStatus = run.engagement_order_item?.engagement_order?.status
        const itemStatus = run.engagement_order_item?.status

        if (orderStatus === 'cancelled' || itemStatus === 'cancelled') {
          console.log(`🚫 Skipping status sync for cancelled engagement run #${run.run_number}`)
          await supabase.from('organic_run_schedule').update({
            status: 'cancelled',
            error_message: run.error_message || 'Order cancelled by user',
            completed_at: run.completed_at || new Date().toISOString(),
            last_status_check: new Date().toISOString(),
          }).eq('id', run.id)
          continue
        }
        // Use the provider_account that was used to place the order
        // Fallback to default provider if no account recorded
        let apiKey: string
        let apiUrl: string
        let providerName: string

        if (run.user_provider_account) {
          // User-owned SMM panel key (multi-tenant path)
          try {
            apiKey = await decryptUserApiKey(run.user_provider_account.id, run.user_provider_account.api_key_ciphertext)
          } catch (e) {
            console.error(`Failed to decrypt user provider key for run ${run.id}:`, e)
            continue
          }
          apiUrl = run.user_provider_account.api_url
          providerName = run.user_provider_account.name
        } else if (run.provider_account) {
          // Admin-side provider account
          apiKey = run.provider_account.api_key
          apiUrl = run.provider_account.api_url
          providerName = run.provider_account.name
        } else {
          // Fallback to default provider (legacy runs without provider_account_id)
          const providerId = run.engagement_order_item?.service?.provider_id
          if (!providerId) {
            console.error(`Run ${run.id} has no provider_account and no service provider_id`)
            continue
          }

          const { data: provider } = await supabase
            .from('providers')
            .select('*')
            .eq('id', providerId)
            .single()

          if (!provider) {
            console.error(`Provider ${providerId} not found for run ${run.id}`)
            continue
          }

          apiKey = provider.api_key
          apiUrl = provider.api_url
          providerName = provider.name
        }


        console.log(`Checking ${run.engagement_order_item?.engagement_type} order ${run.provider_order_id} on ${providerName}`)

        // ---- BULK PREFETCH (multistatus) ----------------------------------
        // Polling each run one-by-one could not keep up with 1000+ active runs,
        // so live progress went stale. Standard SMM APIs support
        // `action=multistatus&orders=id1,id2,...` (max 100 per call), so the
        // first run of a provider warms the cache for every other run of the
        // same provider in this batch.
        const providerKey = `${apiUrl}||${run.user_provider_account_id || run.provider_account_id || 'default'}`
        const cacheKey = `${providerKey}||${run.provider_order_id}`

        if (!multiStatusCache.has(cacheKey) && !multiStatusTried.has(providerKey)) {
          multiStatusTried.add(providerKey)
          const siblingIds = Array.from(new Set(
            (engagementRuns || [])
              .filter((r: any) =>
                r.provider_order_id &&
                `${(r.user_provider_account?.api_url || r.provider_account?.api_url || apiUrl)}||${r.user_provider_account_id || r.provider_account_id || 'default'}` === providerKey
              )
              .map((r: any) => String(r.provider_order_id))
          ))
          for (let i = 0; i < siblingIds.length; i += 100) {
            const chunk = siblingIds.slice(i, i + 100)
            if (chunk.length < 2) break
            let cachedAny = false
            // Panels differ: some expose action=multistatus, others action=status
            // with an `orders` list. Try both before giving up.
            for (const action of ['multistatus', 'status']) {
              try {
                const multiForm = new URLSearchParams()
                multiForm.append('key', apiKey)
                multiForm.append('action', action)
                multiForm.append('orders', chunk.join(','))
                const multiRes = await fetchWithTimeout(apiUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: multiForm.toString()
                })
                const multiText = await multiRes.text()
                const multiJson = JSON.parse(multiText)
                let hits = 0
                if (multiJson && typeof multiJson === 'object' && !multiJson.error) {
                  for (const [oid, val] of Object.entries(multiJson)) {
                    if (val && typeof val === 'object' && !(val as any).error) {
                      multiStatusCache.set(`${providerKey}||${oid}`, val)
                      hits++
                    }
                  }
                }
                if (hits > 0) {
                  console.log(`BULK ${action} on ${providerName}: cached ${hits}/${chunk.length} orders`)
                  cachedAny = true
                  break
                }
                console.log(`BULK ${action} on ${providerName} returned no usable data: ${multiText.slice(0, 200)}`)
              } catch (e) {
                console.log(`BULK ${action} failed on ${providerName}: ${e}`)
              }
            }
            if (!cachedAny) break
          }

        }

        let result: any = multiStatusCache.get(cacheKey)

        if (!result) {
          const formData = new URLSearchParams()
          formData.append('key', apiKey)
          formData.append('action', 'status')
          formData.append('order', run.provider_order_id)

          const response = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
          })

          const responseText = await response.text()
          console.log(`Status for ${run.engagement_order_item?.engagement_type} order ${run.provider_order_id}: ${responseText}`)

          try {
            result = JSON.parse(responseText)
          } catch {
            result = { error: responseText }
          }
        } else {
          console.log(`Status (cached) for order ${run.provider_order_id}: ${JSON.stringify(result)}`)
        }


        if (result.error) {
          console.error(`Status check failed for ${run.provider_order_id}:`, result.error)
          const providerError = String(result.error || '')
          const providerErrorLower = providerError.toLowerCase()
          
          if (isProviderStatusLookupMiss(providerError)) {
            const orderStatus = run.engagement_order_item?.engagement_order?.status
            const itemStatus = run.engagement_order_item?.status
            const ageMinutes = getRunAgeMinutes(run)

            if ((orderStatus === 'cancelled' || itemStatus === 'cancelled') && !run.provider_order_id) {
              await supabase.from('organic_run_schedule').update({
                status: 'cancelled',
                error_message: 'Order cancelled by user',
                completed_at: new Date().toISOString(),
                provider_status: 'cancelled',
                last_status_check: new Date().toISOString(),
              }).eq('id', run.id)
            } else if (ageMinutes < 180) {
              // Some providers create the order first but their status endpoint starts
              // recognizing that ID later. Do not mark it failed immediately, and do
              // not retry/place a duplicate external order.
              await supabase.from('organic_run_schedule').update({
                status: 'started',
                error_message: `[Awaiting provider confirmation] ${providerError}`,
                provider_status: 'Pending',
                last_status_check: new Date().toISOString(),
                provider_response: {
                  ...(run.provider_response || {}),
                  last_status_error: providerError,
                  status_lookup_pending: true,
                  status_lookup_age_min: ageMinutes,
                },
              }).eq('id', run.id)
              stillProcessing++
            } else {
              // Provider order already exists for this run.
              // Never recycle it into the placement queue, otherwise one scheduled run can create multiple external orders.
              await supabase.from('organic_run_schedule').update({
                status: 'completed',
                error_message: `Auto-completed after provider lookup miss (${providerError}) — provider order exists, duplicate retry blocked`,
                completed_at: run.completed_at || new Date().toISOString(),
                provider_status: 'Completed',
                last_status_check: new Date().toISOString(),
                retry_count: 99,
                provider_response: {
                  ...(run.provider_response || {}),
                  last_status_error: providerError,
                  status_lookup_missed: true,
                  duplicate_retry_blocked: true,
                },
              }).eq('id', run.id)
              completed++
              queueRollup(run.engagement_order_item?.id, run.engagement_order_item?.engagement_order_id)
            }
          } else if (isProviderCredentialError(providerError)) {
            await supabase.from('organic_run_schedule').update({
              status: 'failed',
              error_message: `Provider credential error on ${providerName}: ${providerError}`,
              completed_at: new Date().toISOString(),
              provider_status: 'error',
              last_status_check: new Date().toISOString(),
              retry_count: 99,
              provider_response: {
                ...(run.provider_response || {}),
                last_status_error: providerError,
                provider_credential_error: true,
                provider_name: providerName,
              },
            }).eq('id', run.id)
            failed++
            queueRollup(run.engagement_order_item?.id, run.engagement_order_item?.engagement_order_id)
          } else if (providerErrorLower.includes('cancelled')) {
            const orderStatus = run.engagement_order_item?.engagement_order?.status
            const itemStatus = run.engagement_order_item?.status

            if (orderStatus === 'cancelled' || itemStatus === 'cancelled') {
              await supabase.from('organic_run_schedule').update({
                status: 'cancelled',
                error_message: 'Order cancelled by user',
                completed_at: new Date().toISOString(),
                provider_status: 'cancelled',
                last_status_check: new Date().toISOString(),
              }).eq('id', run.id)
            } else {
              await supabase.from('organic_run_schedule').update({
                status: 'failed',
                error_message: `Repeat blocked after provider order creation: ${providerError}`,
                completed_at: new Date().toISOString(),
                provider_status: 'error',
                last_status_check: new Date().toISOString(),
                retry_count: 99,
                provider_response: {
                  ...(run.provider_response || {}),
                  last_status_error: providerError,
                  repeat_retry_blocked: true,
                },
              }).eq('id', run.id)
              failed++
              queueRollup(run.engagement_order_item?.id, run.engagement_order_item?.engagement_order_id)
            }
          } else {
            // Update last check time even for errors
            await supabase.from('organic_run_schedule').update({
              last_status_check: new Date().toISOString(),
              provider_response: {
                ...(run.provider_response || {}),
                last_status_error: providerError,
              }
            }).eq('id', run.id)
            stillProcessing++
          }
          continue
        }

        const providerStatus = (result.status || '').toLowerCase()
        const startCount = parseInt(result.start_count) || null
        const remainsRaw = result.remains
        const remainsProvided = remainsRaw !== undefined && remainsRaw !== null && String(remainsRaw).trim() !== ''
        const remains = remainsProvided ? (parseInt(String(remainsRaw)) || 0) : 0
        const charge = parseFloat(result.charge) || null
        
        // Calculate delivery progress
        const delivered = startCount !== null ? (run.quantity_to_send - remains) : null
        const progressPercent = run.quantity_to_send > 0 ? ((run.quantity_to_send - remains) / run.quantity_to_send * 100).toFixed(1) : 0

        console.log(`Provider status: ${providerStatus}, Start: ${startCount}, Remains: ${remains}, Delivered: ${delivered} (${progressPercent}%)`)
        
        const startedAt = new Date(run.started_at || run.scheduled_at)
        const ageMinutes = Math.round((Date.now() - startedAt.getTime()) / 60000)

        // Comprehensive check for stuck runs:
        // 1. If provider returns a terminal status, always complete
        // 2. If stuck in a non-terminal status for 10+ minutes, auto-complete to unblock
        // 3. If "started" for 10+ minutes but NO provider status at all, auto-complete
        // Always update provider tracking data
        const trackingUpdate: any = {
          provider_status: result.status,
          provider_start_count: startCount,
          provider_remains: remains,
          provider_charge: charge,
          provider_response: result,
          last_status_check: new Date().toISOString()
        }

        // STRICT: only treat as "fully delivered" when provider explicitly returned remains=0
        // AND we have evidence a real delivery happened (start_count > 0).
        // Otherwise providers that omit `remains` while still "In progress" would
        // be falsely auto-completed (parseInt(undefined)||0 === 0).
        const deliveredAll = remainsProvided
          && remains === 0
          && startCount !== null
          && startCount > 0
          && !['cancelled', 'canceled', 'refunded', 'refund', 'failed', 'error', 'canscelled'].includes(providerStatus)

        if (providerStatus === 'completed' || providerStatus === 'complete' || providerStatus === 'success' || deliveredAll) {
          const orderStatus = run.engagement_order_item?.engagement_order?.status
          const itemStatus = run.engagement_order_item?.status

          if (orderStatus === 'cancelled' || itemStatus === 'cancelled') {
            await supabase.from('organic_run_schedule').update({
              ...trackingUpdate,
              status: 'cancelled',
              completed_at: new Date().toISOString(),
              error_message: 'Order cancelled by user'
            }).eq('id', run.id)
            continue
          }

          const { error: completionUpdateError } = await supabase.from('organic_run_schedule').update({
            ...trackingUpdate,
            status: 'completed',
            completed_at: new Date().toISOString(),
            error_message: deliveredAll
              ? 'Auto-completed (provider remains reached 0)'
              : run.error_message?.includes('Auto-completed') ? null : run.error_message,
          }).eq('id', run.id)

          if (completionUpdateError) {
            throw new Error(`Failed to persist completed run ${run.id}: ${completionUpdateError.message}`)
          }

          completed++
          results.push({
            run_id: run.id,
            run_number: run.run_number,
            type: run.engagement_order_item?.engagement_type,
            status: 'completed',
            provider_order_id: run.provider_order_id,
            delivered: run.quantity_to_send,
            remains: 0
          })

          queueRollup(run.engagement_order_item?.id, run.engagement_order_item?.engagement_order_id)

        } else if (providerStatus === 'partial') {
          // SCAM GUARD: if provider says "Partial" but delivered 0 (remains == full qty),
          // treat as a failed delivery and retry on a backup provider instead of
          // silently marking it complete.
          const deliveredQty = run.quantity_to_send - remains
          if (deliveredQty <= 0) {
            const orderStatus = run.engagement_order_item?.engagement_order?.status
            const itemStatus = run.engagement_order_item?.status
            if (orderStatus === 'cancelled' || itemStatus === 'cancelled') {
              await supabase.from('organic_run_schedule').update({
                ...trackingUpdate,
                status: 'cancelled',
                completed_at: new Date().toISOString(),
                error_message: 'Order cancelled by user'
              }).eq('id', run.id)
              continue
            }
            const currentRetryCount = run.retry_count || 0
            if (currentRetryCount < 15) {
              const triedSet = new Set<string>(
                Array.isArray(run.provider_response?.tried_providers) ? run.provider_response.tried_providers : []
              )
              if (run.provider_account_id) triedSet.add(run.provider_account_id)
              const mergedResp = { ...(trackingUpdate.provider_response || {}), tried_providers: Array.from(triedSet) }
              await supabase.from('organic_run_schedule').update({
                ...trackingUpdate,
                provider_response: mergedResp,
                status: 'failed',
                completed_at: new Date().toISOString(),
                error_message: `Auto-retry: provider returned Partial with 0 delivered (remains=${remains}/${run.quantity_to_send})`
              }).eq('id', run.id)
              failed++
              continue
            }
            // fall through to mark partial-completed if max retries exceeded
          }
          const { error: partialUpdateError } = await supabase.from('organic_run_schedule').update({
            ...trackingUpdate,
            status: 'completed',
            completed_at: new Date().toISOString(),
            error_message: `Partial: ${remains} remaining`
          }).eq('id', run.id)

          if (partialUpdateError) {
            throw new Error(`Failed to persist partial run ${run.id}: ${partialUpdateError.message}`)
          }

          completed++
          results.push({
            run_id: run.id,
            run_number: run.run_number,
            type: run.engagement_order_item?.engagement_type,
            status: 'partial',
            delivered: run.quantity_to_send - remains,
            remains: remains
          })
          queueRollup(run.engagement_order_item?.id, run.engagement_order_item?.engagement_order_id)

        } else if (providerStatus === 'cancelled' || providerStatus === 'canceled' || providerStatus === 'refunded' || providerStatus === 'refund' || providerStatus === 'canscelled') {
          const orderStatus = run.engagement_order_item?.engagement_order?.status
          const itemStatus = run.engagement_order_item?.status

          if (orderStatus === 'cancelled' || itemStatus === 'cancelled') {
            await supabase.from('organic_run_schedule').update({
              ...trackingUpdate,
              status: 'cancelled',
              completed_at: new Date().toISOString(),
              error_message: 'Order cancelled by user'
            }).eq('id', run.id)
          } else {
            // Provider explicitly cancelled/refunded this existing provider order.
            // Keep this run terminal instead of recycling it into retry placement.
            await supabase.from('organic_run_schedule').update({
              ...trackingUpdate,
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: `Repeat blocked after provider ${providerStatus}`,
              retry_count: 99
            }).eq('id', run.id)
            failed++
            queueRollup(run.engagement_order_item?.id, run.engagement_order_item?.engagement_order_id)
          }
        } else if (deliveredAll) {
          const { error: deliveredUpdateError } = await supabase.from('organic_run_schedule').update({
            ...trackingUpdate,
            status: 'completed',
            completed_at: new Date().toISOString(),
            error_message: 'Auto-completed (provider remains reached 0)'
          }).eq('id', run.id)

          if (deliveredUpdateError) {
            throw new Error(`Failed to persist delivered run ${run.id}: ${deliveredUpdateError.message}`)
          }

          completed++
          results.push({
            run_id: run.id,
            run_number: run.run_number,
            type: run.engagement_order_item?.engagement_type,
            status: 'completed',
            provider_order_id: run.provider_order_id,
            delivered: run.quantity_to_send,
            remains: 0
          })
          queueRollup(run.engagement_order_item?.id, run.engagement_order_item?.engagement_order_id)
        } else {
          await supabase.from('organic_run_schedule').update(trackingUpdate).eq('id', run.id)

          stillProcessing++
          results.push({
            run_id: run.id,
            run_number: run.run_number,
            type: run.engagement_order_item?.engagement_type,
            status: 'processing',
            provider_status: result.status,
            start_count: startCount,
            remains: remains,
            delivered: delivered,
            progress_percent: progressPercent
          })
        }

      } catch (fetchError) {
        console.error(`Network error checking ${run.provider_order_id}:`, fetchError)
        stillProcessing++
      }

    }

    await flushRollups()

    // ============================================
    // STEP 2: Check LEGACY ORDER runs (via order_id)
    // ============================================
    console.log(`\n--- Checking Legacy Order Runs ---`)
    
    let legacyQuery = supabase
      .from('organic_run_schedule')
      .select('*, order:orders(*, service:services(provider_id))')
      // Check started + auto-completed + completed but non-terminal at provider
      .or(
        'status.eq.started,' +
        'and(status.eq.completed,error_message.ilike.%Auto-completed%,provider_status.in.(Pending,In progress,Processing,Inprogress,Awaiting)),' +
        'and(status.eq.completed,provider_status.not.in.(Completed,Complete,Partial,Refunded,Canceled,Cancelled,Error,Failed,Success,Refund,Canscelled)),' +
        'and(status.eq.failed,provider_status.in.(Pending,In progress,Processing,Inprogress,Awaiting))'
      )
      .not('provider_order_id', 'is', null)
      .not('order_id', 'is', null)
      .is('engagement_order_item_id', null)

    if (targetRunId) {
      legacyQuery = legacyQuery.eq('id', targetRunId)
    } else {
      legacyQuery = legacyQuery
        .order('last_status_check', { ascending: true, nullsFirst: true })
        .limit(CHECK_STATUS_BATCH_LIMIT)
    }

    const { data: legacyRuns, error: legacyError } = await legacyQuery

    if (legacyError) {
      console.error('Error fetching legacy runs:', legacyError)
    }

    console.log(`Found ${legacyRuns?.length || 0} legacy runs waiting for completion`)

    // Group by provider
    const legacyByProvider: { [key: string]: typeof legacyRuns } = {}
    
    for (const run of legacyRuns || []) {
      const providerId = run.order?.service?.provider_id
      if (providerId) {
        if (!legacyByProvider[providerId]) {
          legacyByProvider[providerId] = []
        }
        legacyByProvider[providerId].push(run)
      }
    }

    for (const [providerId, runs] of Object.entries(legacyByProvider)) {
      const { data: provider } = await supabase
        .from('providers')
        .select('*')
        .eq('id', providerId)
        .single()

      if (!provider) {
        console.error('Legacy provider not found:', providerId)
        continue
      }

      console.log(`Checking ${runs!.length} legacy orders on ${provider.name}`)

      for (const run of runs!) {
        if (!targetRunId && overBudget()) {
          budgetExceeded = true
          skippedOverBudget++
          continue
        }
        try {
          const formData = new URLSearchParams()
          formData.append('key', provider.api_key)
          formData.append('action', 'status')
          formData.append('order', run.provider_order_id)

          const response = await fetchWithTimeout(provider.api_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
          })

          const responseText = await response.text()
          console.log(`Legacy status for order ${run.provider_order_id}: ${responseText}`)

          let result
          try {
            result = JSON.parse(responseText)
          } catch {
            result = { error: responseText }
          }

          if (result.error) {
            const providerError = String(result.error || '')
            if (isProviderCredentialError(providerError)) {
              await supabase.from('organic_run_schedule').update({
                status: 'failed',
                error_message: `Provider credential error on ${provider.name}: ${providerError}`,
                completed_at: new Date().toISOString(),
                provider_status: 'error',
                last_status_check: new Date().toISOString(),
                retry_count: 99,
                provider_response: {
                  ...(run.provider_response || {}),
                  last_status_error: providerError,
                  provider_credential_error: true,
                  provider_name: provider.name,
                },
              }).eq('id', run.id)
              failed++
              await updateLegacyOrderStatus(supabase, run.order_id)
            } else if (providerError.toLowerCase().includes('not found') || providerError.toLowerCase().includes('cancelled')) {
              await supabase.from('organic_run_schedule').update({
                status: 'failed',
                error_message: providerError,
                completed_at: new Date().toISOString(),
                provider_status: 'error',
                last_status_check: new Date().toISOString()
              }).eq('id', run.id)
              failed++
              await updateLegacyOrderStatus(supabase, run.order_id)
            } else {
              await supabase.from('organic_run_schedule').update({
                last_status_check: new Date().toISOString()
              }).eq('id', run.id)
              stillProcessing++
            }
            continue
          }

          const providerStatus = (result.status || '').toLowerCase()
          const startCount = parseInt(result.start_count) || null
          const remainsRaw = result.remains
          const remainsProvided = remainsRaw !== undefined && remainsRaw !== null && String(remainsRaw).trim() !== ''
          const remains = remainsProvided ? (parseInt(String(remainsRaw)) || 0) : 0
          const charge = parseFloat(result.charge) || null

          // Always update tracking data
          const trackingUpdate: any = {
            provider_status: result.status,
            provider_start_count: startCount,
            provider_remains: remains,
            provider_charge: charge,
            provider_response: result,
            last_status_check: new Date().toISOString()
          }

          const deliveredAll = remainsProvided
            && remains === 0
            && startCount !== null
            && startCount > 0
            && !['cancelled', 'canceled', 'refunded', 'refund', 'failed', 'error', 'canscelled'].includes(providerStatus)

          if (providerStatus === 'completed' || providerStatus === 'complete' || providerStatus === 'success' || deliveredAll) {
            await supabase.from('organic_run_schedule').update({
              ...trackingUpdate,
              status: 'completed',
              completed_at: new Date().toISOString(),
              error_message: deliveredAll
                ? 'Auto-completed (provider remains reached 0)'
                : run.error_message?.includes('Auto-completed') ? null : run.error_message,
            }).eq('id', run.id)

            completed++
            await updateLegacyOrderStatus(supabase, run.order_id)

          } else if (providerStatus === 'partial') {
            await supabase.from('organic_run_schedule').update({
              ...trackingUpdate,
              status: 'completed',
              completed_at: new Date().toISOString(),
              error_message: `Partial: ${remains} remaining`
            }).eq('id', run.id)

            completed++
            await updateLegacyOrderStatus(supabase, run.order_id)

          } else if (providerStatus === 'cancelled' || providerStatus === 'canceled' || providerStatus === 'refunded' || providerStatus === 'refund' || providerStatus === 'canscelled') {
            await supabase.from('organic_run_schedule').update({
              ...trackingUpdate,
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: 'Cancelled by provider'
            }).eq('id', run.id)

            failed++
            await updateLegacyOrderStatus(supabase, run.order_id)

          } else {
            // Update tracking for live view
            await supabase.from('organic_run_schedule').update(trackingUpdate).eq('id', run.id)
            stillProcessing++
          }

        } catch (fetchError) {
          console.error(`Network error checking legacy ${run.provider_order_id}:`, fetchError)
          stillProcessing++
        }

      }
    }

    console.log(`\n=== STATUS CHECK COMPLETE ===`)
    console.log(`Completed: ${completed}, Still Processing: ${stillProcessing}, Failed: ${failed}`)

    // ============================================
    // STEP 3: Sync NON-ORGANIC direct orders (orders sent straight to provider)
    // Updates orders.current_count from provider's live count.
    // Completion is gated by the DB trigger — only flips to 'completed' when
    // current_count >= start_count + quantity.
    // ============================================
    console.log(`\n--- Syncing Non-Organic Direct Orders ---`)
    let directQuery = supabase
      .from('orders')
      .select('id, quantity, start_count, current_count, provider_order_id, status, service:services(provider_id)')
      .in('status', ['pending', 'processing'])
      .eq('is_organic_mode', false)
      .not('provider_order_id', 'is', null)
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(CHECK_STATUS_BATCH_LIMIT)
    const { data: directOrders } = await directQuery
    console.log(`Found ${directOrders?.length || 0} direct orders to sync`)

    for (const ord of directOrders || []) {
      if (overBudget()) {
        budgetExceeded = true
        skippedOverBudget++
        continue
      }
      try {
        const providerId = (ord as any).service?.provider_id
        if (!providerId) continue
        const { data: prov } = await supabase.from('providers').select('*').eq('id', providerId).single()
        if (!prov) continue

        const fd = new URLSearchParams()
        fd.append('key', prov.api_key)
        fd.append('action', 'status')
        fd.append('order', ord.provider_order_id!)
        const r = await fetchWithTimeout(prov.api_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: fd.toString(),
        })
        const txt = await r.text()
        let js: any = {}
        try { js = JSON.parse(txt) } catch { js = { error: txt } }

        const upd: any = { last_synced_at: new Date().toISOString() }

        if (js.error) {
          const errStr = String(js.error).toLowerCase()
          if (isProviderCredentialError(String(js.error))) {
            upd.status = 'failed'
            upd.error_message = `Provider credential error: ${js.error}`
          } else if (errStr.includes('cancel') || errStr.includes('refund')) {
            upd.status = 'failed'
            upd.error_message = `Provider cancelled: ${js.error}`
          }
          await supabase.from('orders').update(upd).eq('id', ord.id)
          continue
        }

        const pStatus = String(js.status || '').toLowerCase()
        const sc = js.start_count !== undefined && js.start_count !== null
          ? (parseInt(String(js.start_count)) || 0) : null
        const remRaw = js.remains
        const remProvided = remRaw !== undefined && remRaw !== null && String(remRaw).trim() !== ''
        const rem = remProvided ? (parseInt(String(remRaw)) || 0) : null

        // Establish starting_count if missing
        const baselineStart = ord.start_count ?? sc ?? 0
        if (ord.start_count === null && sc !== null) {
          upd.start_count = sc
        }

        // Compute current_count = start + (ordered - remains)
        let cur: number | null = null
        if (rem !== null) {
          const delivered = Math.max(0, (ord.quantity || 0) - rem)
          cur = baselineStart + delivered
          upd.remains = rem
        }
        if (cur !== null) upd.current_count = cur

        // Only mark completed if counts actually reached target (trigger will re-check anyway)
        const target = baselineStart + (ord.quantity || 0)
        if (
          (pStatus === 'completed' || pStatus === 'complete' || pStatus === 'success')
          && cur !== null && cur >= target
        ) {
          upd.status = 'completed'
        } else if (pStatus === 'partial' && cur !== null && cur > baselineStart) {
          // Only partial-complete if some real delivery happened
          upd.status = 'completed'
          upd.error_message = `Partial delivery: ${rem} remaining`
        } else if (['cancelled','canceled','refunded','refund','canscelled'].includes(pStatus)) {
          upd.status = 'failed'
          upd.error_message = 'Provider cancelled/refunded'
        } else if (ord.status === 'pending') {
          upd.status = 'processing'
        }

        await supabase.from('orders').update(upd).eq('id', ord.id)
      } catch (e) {
        console.log(`Direct sync error for ${ord.id}: ${(e as Error).message}`)
      }
      await new Promise(res => setTimeout(res, 150))
    }

    // Send admin alert if there were failures
    if (failed > 0) {
      try {
        const executionId = crypto.randomUUID().slice(0, 8)
        const alertPayload = {
          job_name: 'check-order-status',
          execution_id: executionId,
          failed_count: failed,
          completed_count: completed,
          still_processing_count: stillProcessing,
          error_details: results.filter(r => r.status === 'failed' || r.status === 'error').map(r => ({
            run_id: r.run_id,
            run_number: r.run_number,
            type: r.type,
            error: r.error || 'Provider error'
          }))
        }

        console.log('Sending failure alert to admins...')
        const alertResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-admin-alert`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
            },
            body: JSON.stringify(alertPayload)
          }
        )
        const alertResult = await alertResponse.json()
        console.log('Alert response:', alertResult)
      } catch (alertError) {
        console.error('Failed to send admin alert:', alertError)
      }
    }

    // Self-chain: if there is still a backlog, immediately trigger another
    // invocation instead of waiting for the next cron tick. This is what makes
    // provider "Completed" reflect on the panel without pressing Check Now.
    if (!targetRunId && (budgetExceeded || skippedOverBudget > 0 || (completed + stillProcessing + failed) >= CHECK_STATUS_BATCH_LIMIT)) {
      try {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/check-order-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'x-region': 'us-east-1',
          },
          body: JSON.stringify({ chained: true }),
        }).catch(() => {})
      } catch (_e) { /* best effort */ }
    }

    return new Response(JSON.stringify({
      success: true,
      completed,
      stillProcessing,
      failed,
      skipped_over_budget: skippedOverBudget,
      budget_exceeded: budgetExceeded,
      duration_ms: Date.now() - invocationStart,
      results,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Status check error:', error)
    return new Response(JSON.stringify({ 
      error: (error as Error).message || 'Internal server error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Helper function to update engagement order and item status
async function updateEngagementOrderStatus(supabase: any, engagementOrderId: string, itemId: string) {
  if (!engagementOrderId) return

  const tracking = await syncEngagementItemTracking(supabase, itemId)

  const { data: parentOrder } = await supabase
    .from('engagement_orders')
    .select('status')
    .eq('id', engagementOrderId)
    .maybeSingle()

  if (parentOrder?.status === 'cancelled') {
    console.log(`🚫 Skipping parent engagement order status update for cancelled order ${engagementOrderId}`)
    return
  }

  // Update item status
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
        if (activeCount > 0) {
          itemStatus = currentItem?.status === 'paused' ? 'paused' : 'processing'
        } else if (completedCount === totalRuns) {
          itemStatus = 'completed'
        } else if (completedCount > 0 && completedCount + failedCount + cancelledCount === totalRuns) {
          itemStatus = 'partial'
        } else if (failedCount + cancelledCount === totalRuns) {
          itemStatus = 'failed'
        }

        // Only downgrade 'completed' to 'partial' when we truly have a public
        // baseline to check against and it hasn't been reached. Items without
        // a public baseline (start_count = 0) must not be blocked from
        // completing — that was the "stuck on processing" bug.
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

  // Update order status based on all items
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

  console.log(`Engagement Order ${engagementOrderId} progress: ${completedItems}/${totalItems} items completed`)

  let orderStatus = 'processing'
  if (completedItems === totalItems) {
    orderStatus = 'completed'
  } else if (failedItems === totalItems) {
    orderStatus = 'failed'
  } else if (activeItems === 0 && completedItems + partialItems + failedItems + cancelledItems === totalItems) {
    orderStatus = completedItems > 0 ? 'partial' : failedItems > 0 ? 'failed' : 'cancelled'
  } else if (parentOrder?.status === 'paused') {
    orderStatus = 'paused'
  }

  await supabase.from('engagement_orders').update({ status: orderStatus }).eq('id', engagementOrderId).neq('status', 'cancelled')
}

// Helper function to update legacy order status
async function updateLegacyOrderStatus(supabase: any, orderId: string) {
  if (!orderId) return

  const { data: allRuns } = await supabase
    .from('organic_run_schedule')
    .select('status')
    .eq('order_id', orderId)

  if (!allRuns || allRuns.length === 0) return

  const completedCount = allRuns.filter((r: any) => r.status === 'completed').length
  const failedCount = allRuns.filter((r: any) => r.status === 'failed').length
  const pendingCount = allRuns.filter((r: any) => r.status === 'pending').length
  const startedCount = allRuns.filter((r: any) => r.status === 'started').length
  const totalRuns = allRuns.length

  console.log(`Legacy Order ${orderId} progress: ${completedCount}/${totalRuns} completed`)

  let orderStatus = 'processing'
  
  if (completedCount === totalRuns) {
    orderStatus = 'completed'
  } else if (completedCount + failedCount === totalRuns) {
    orderStatus = failedCount > 0 ? 'partial' : 'completed'
  } else if (pendingCount === 0 && startedCount === 0 && failedCount === totalRuns) {
    orderStatus = 'failed'
  }

  await supabase.from('orders').update({ status: orderStatus }).eq('id', orderId)
}
