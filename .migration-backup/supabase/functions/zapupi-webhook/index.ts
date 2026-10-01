import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const ZAPUPI_KEY = Deno.env.get('ZAPUPI_ZAP_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // 🩺 HEALTH CHECK — GET /zapupi-webhook?health=1
  // Returns the canonical URL that ZapUPI dashboard must be configured with,
  // plus recent webhook receipt stats so admin can confirm inbound traffic.
  const url = new URL(req.url)
  if (req.method === 'GET' && (url.searchParams.get('health') === '1' || url.pathname.endsWith('/health'))) {
    const canonicalUrl = `${SUPABASE_URL}/functions/v1/zapupi-webhook`
    try {
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const [{ count: total24h }, { count: total1h }, { data: latest }] = await Promise.all([
        admin.from('zapupi_webhook_events').select('id', { count: 'exact', head: true }).eq('source', 'webhook').gte('created_at', since24h),
        admin.from('zapupi_webhook_events').select('id', { count: 'exact', head: true }).eq('source', 'webhook').gte('created_at', since1h),
        admin.from('zapupi_webhook_events').select('created_at, order_id, status, source_ip, user_agent, processed, amount_match').eq('source', 'webhook').order('created_at', { ascending: false }).limit(5),
      ])
      const lastAt = latest?.[0]?.created_at ?? null
      const lastAgeMinutes = lastAt ? Math.round((Date.now() - new Date(lastAt).getTime()) / 60000) : null
      const healthy = (total24h ?? 0) > 0
      return json({
        ok: true,
        healthy,
        canonical_webhook_url: canonicalUrl,
        instructions: `Set this exact URL in ZapUPI dashboard → Webhook. Method: POST. No auth headers required.`,
        stats: {
          webhooks_last_1h: total1h ?? 0,
          webhooks_last_24h: total24h ?? 0,
          last_received_at: lastAt,
          last_received_minutes_ago: lastAgeMinutes,
        },
        recent: latest ?? [],
        server_time: new Date().toISOString(),
      })
    } catch (e) {
      return json({ ok: false, canonical_webhook_url: canonicalUrl, error: String((e as Error).message || e) })
    }
  }

  // Always respond 200 to gateway to prevent retries storm; log errors internally.
  try {
    let payload: any = {}
    const rawBodyText = await req.clone().text().catch(() => '')
    const sourceIp = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null
    const userAgent = req.headers.get('user-agent') || null
    const httpMethod = req.method
    const headersObj: Record<string, string> = {}
    for (const [k, v] of req.headers.entries()) {
      if (/authorization|cookie|api-key|secret/i.test(k)) continue
      headersObj[k] = v
    }
    const ct = req.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      payload = await req.json().catch(() => ({}))
    } else {
      const text = await req.text()
      try { payload = JSON.parse(text) } catch {
        const params = new URLSearchParams(text)
        payload = Object.fromEntries(params.entries())
      }
    }

    const orderId: string | undefined =
      payload?.order_id || payload?.orderId || payload?.data?.order_id
    if (!orderId) {
      return json({ ok: true, note: 'no order_id' })
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // 🛡️ REPLAY PROTECTION: reject duplicate webhook callbacks at the DB level.
    // The event_key fingerprints this specific callback (order + txn/utr + status + payload hash).
    const wTxn = payload?.txn_id || payload?.data?.txn_id || ''
    const wUtr = payload?.utr || payload?.data?.utr || ''
    const wStatus = String(payload?.status || payload?.data?.status || '').toLowerCase()
    const payloadHash = await sha256Hex(JSON.stringify(payload || {}))
    const eventKey = `webhook:${orderId}:${wTxn}:${wUtr}:${wStatus}:${payloadHash}`
    const claimed = await claimEvent(admin, {
      event_key: eventKey, order_id: orderId, txn_id: wTxn || null, utr: wUtr || null,
      status: wStatus || null, source: 'webhook', payload,
      http_method: httpMethod, headers: headersObj, source_ip: sourceIp,
      user_agent: userAgent,
      raw_body: rawBodyText.length > 20000 ? rawBodyText.slice(0, 20000) + '…[truncated]' : rawBodyText,
    })
    if (!claimed) return json({ ok: true, replay: true })

    // ── Subscription payment routing (order_id starts with 'SUB_ZAPUPI_') ──
    if (orderId.startsWith('SUB_ZAPUPI_')) {
      const { data: subPay } = await admin.from('subscription_payments')
        .select('id, user_id, plan_type, activated').eq('order_id', orderId).maybeSingle()
      if (!subPay) return json({ ok: true, note: 'unknown sub order' })
      // Verify via ZapUPI order-status (server-side truth)
      const verify = await verifyOrder(orderId)
      let subResult: any = null
      if (verify.success && !subPay.activated) {
        await admin.from('subscription_payments').update({
          status: 'paid', raw_payload: { webhook: payload, verify: verify.raw },
        }).eq('order_id', orderId)
        const { data, error } = await admin.rpc('activate_subscription_from_payment', { p_order_id: orderId })
        subResult = error ? { error: error.message } : data
      }
      await admin.from('zapupi_webhook_events').update({
        processed: true, credit_result: { subscription: subResult, order_id: orderId },
      }).eq('event_key', eventKey)
      return json({ ok: true, subscription: subResult })
    }

    // Load the expected deposit (server-side amount of record)
    const { data: dep } = await admin
      .from('zapupi_deposits')
      .select('user_id, amount_inr, credited, status')
      .eq('order_id', orderId)
      .maybeSingle()
    if (!dep) return json({ ok: true, note: 'unknown order' })
    if (dep.credited) return json({ ok: true, duplicate: true })

    // Double-confirm via order-status (NEVER trust webhook payload)
    const verify = await verifyOrder(orderId)
    if (!verify.success) {
      await admin.from('zapupi_deposits').update({
        gateway_response: { webhook: payload, verify: verify.raw },
      }).eq('order_id', orderId)
      return json({ ok: true, verified: false })
    }

    // 🔒 Amount-match guard: gateway-reported paid_amount MUST equal stored amount_inr
    const expected = Number(dep.amount_inr)
    const paid = Number((verify as any).paid_amount)
    const matchOk = Number.isFinite(paid) && Math.abs(paid - expected) <= 0.01
    await admin.from('zapupi_webhook_events').update({
      expected_amount: expected,
      received_amount: Number.isFinite(paid) ? paid : null,
      amount_match: matchOk,
      verification_notes: JSON.stringify({
        verify_success: (verify as any).success,
        environment: (verify as any).environment,
        txn_id: (verify as any).txn_id,
        utr: (verify as any).utr,
      }),
    }).eq('event_key', eventKey)
    if (!Number.isFinite(paid) || Math.abs(paid - expected) > 0.01) {
      await admin.from('zapupi_deposits').update({
        status: 'mismatch',
        gateway_response: { webhook: payload, verify: verify.raw, expected_inr: expected, paid_inr: paid },
      }).eq('order_id', orderId)
      await recordFraudAndMaybeBan(admin, dep.user_id, 'amount_mismatch', {
        order_id: orderId, expected_inr: expected, paid_inr: paid, source: 'webhook',
      })
      await notifyUserAdmin(dep.user_id, orderId, 'failed', dep.amount_inr, `amount_mismatch (expected ₹${expected}, paid ₹${paid})`).catch(() => {})
      return json({ ok: true, mismatch: true })
    }

    const { data, error } = await admin.rpc('credit_wallet_zapupi', {
      p_order_id: orderId,
      p_txn_id: verify.txn_id ?? null,
      p_utr: verify.utr ?? null,
      p_gateway_response: { webhook: payload, verify: verify.raw, paid_inr: paid },
    })
    if (error) {
      console.error('credit_wallet_zapupi error', error)
      await admin.from('zapupi_webhook_events').update({
        processed: true, credit_result: { error: error.message },
      }).eq('event_key', eventKey)
      return json({ ok: true, credit_error: error.message })
    }
    await admin.from('zapupi_webhook_events').update({
      processed: true, credit_result: data as any,
    }).eq('event_key', eventKey)
    await notifyTelegram(admin, orderId, data, 'webhook').catch((e) => console.error('tg notify', e))
    if ((data as any)?.credited && !(data as any)?.duplicate) {
      await notifyUserAdmin(dep.user_id, orderId, 'success', dep.amount_inr).catch(() => {})
    }
    return json({ ok: true, result: data })
  } catch (e) {
    console.error('webhook error', e)
    return json({ ok: true, error: String((e as Error).message || e) })
  }
})

export async function verifyOrder(orderId: string): Promise<{ success: boolean; txn_id?: string; utr?: string; environment?: string; raw: any }> {
  const r = await fetch('https://pay.zapupi.com/api/order-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ zap_key: ZAPUPI_KEY, order_id: orderId }),
  })
  const text = await r.text()
  let data: any = {}
  try { data = JSON.parse(text) } catch { data = { raw: text } }

  // Per ZapUPI spec, the order-status payload is nested under `data`.
  const d = data?.data ?? data
  const orderStatusStr = String(d?.status ?? data?.status ?? '').toLowerCase()
  const success = orderStatusStr === 'success' || orderStatusStr === 'completed' || orderStatusStr === 'paid'
  const txn_id = d?.txn_id || data?.txn_id
  const utr = d?.utr || data?.utr
  const environment = d?.environment || data?.environment
  const paidRaw = d?.paid_amount ?? d?.amount ?? d?.amount_paid ?? data?.paid_amount ?? data?.amount
  const paid_amount = paidRaw != null ? Number(String(paidRaw).replace(/[^0-9.]/g, '')) : NaN
  return { success, txn_id, utr, environment, paid_amount, raw: data } as any
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Insert a webhook-event row keyed by `event_key`. Returns false if it was
// already processed (unique violation = replay).
export async function claimEvent(admin: any, row: {
  event_key: string; order_id: string; txn_id: string | null; utr: string | null;
  status: string | null; source: 'webhook' | 'sync'; payload: unknown;
  http_method?: string; headers?: Record<string, string>; source_ip?: string | null;
  user_agent?: string | null; raw_body?: string;
}): Promise<boolean> {
  const { error } = await admin.from('zapupi_webhook_events').insert(row)
  if (!error) return true
  // 23505 = unique_violation → genuine replay; treat any insert failure as "not claimed".
  if ((error as any)?.code === '23505') return false
  console.error('claimEvent insert error', error)
  return false
}

// 🚨 Auto-ban + audit-log helper. Counts recent fraud strikes for the user across
// zapupi_deposits (mismatch or failed) and bans on the 2nd strike within 24h.
export async function recordFraudAndMaybeBan(
  admin: any,
  userId: string | null,
  reasonCode: 'amount_mismatch' | 'repeated_failures',
  meta: Record<string, unknown>,
) {
  if (!userId) return
  try {
    // Audit log every strike
    await admin.from('admin_audit_log').insert({
      actor_id: null,
      actor_email: 'system:zapupi-guard',
      target_user_id: userId,
      action: `fraud_strike:${reasonCode}`,
      notes: JSON.stringify(meta),
      metadata: meta,
    })

    // Count fraud signals in last 24h: mismatches + failed attempts on this user
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: mismatchCount } = await admin
      .from('zapupi_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'mismatch')
      .gte('created_at', sinceIso)
    const { count: failedCount } = await admin
      .from('zapupi_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'failed')
      .gte('created_at', sinceIso)
    const mm = mismatchCount ?? 0
    const ff = failedCount ?? 0

    // Ban rule:
    //  - ANY mismatch in last 24h AND total strikes >= 2  → ban
    //  - OR 5+ failed deposits in 24h with zero successes → ban
    let shouldBan = false
    let banReason = ''
    if (reasonCode === 'amount_mismatch' && mm >= 1) {
      shouldBan = true
      banReason = `Auto-ban: ZapUPI amount-mismatch detected (${mm} in 24h). Latest: expected ₹${meta.expected_inr}, paid ₹${meta.paid_inr}, order ${meta.order_id}.`
    } else if (ff >= 5) {
      const { count: succCount } = await admin
        .from('zapupi_deposits')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('credited', true)
        .gte('created_at', sinceIso)
      if ((succCount ?? 0) === 0) {
        shouldBan = true
        banReason = `Auto-ban: ${ff} failed ZapUPI deposits in 24h with zero successes (likely fraud probe).`
      }
    }

    // Check current profile state
    const { data: prof } = await admin
      .from('profiles')
      .select('email, is_banned')
      .eq('user_id', userId)
      .maybeSingle()

    if (shouldBan && prof && !prof.is_banned) {
      await admin.from('profiles').update({
        is_banned: true,
        banned_reason: banReason,
        banned_at: new Date().toISOString(),
      }).eq('user_id', userId)

      await admin.from('admin_audit_log').insert({
        actor_id: null,
        actor_email: 'system:zapupi-guard',
        target_user_id: userId,
        target_email: prof.email ?? null,
        action: 'auto_ban',
        notes: banReason,
        metadata: { reasonCode, mismatch_24h: mm, failed_24h: ff, ...meta },
      })
    }

    // Telegram alert (always, with ban status)
    const tag = shouldBan ? '⛔ AUTO-BANNED' : '🚨 FRAUD STRIKE'
    const msg = [
      `${tag} <b>(ZapUPI)</b>`,
      ``,
      `👤 <b>User:</b> ${prof?.email ?? userId}`,
      `📛 <b>Reason:</b> ${reasonCode}`,
      `📊 <b>24h:</b> ${mm} mismatch / ${ff} failed`,
      meta.order_id ? `🆔 <b>Order:</b> <code>${meta.order_id}</code>` : '',
      meta.expected_inr != null ? `💵 <b>Expected:</b> ₹${meta.expected_inr}` : '',
      meta.paid_inr != null ? `💸 <b>Paid:</b> ₹${meta.paid_inr}` : '',
      shouldBan ? `\n🔒 Wallet frozen. Manual unban required.` : '',
    ].filter(Boolean).join('\n')

    await fetch(`${SUPABASE_URL}/functions/v1/send-telegram-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ message: msg, parse_mode: 'HTML' }),
    }).catch(() => {})
  } catch (e) {
    console.error('recordFraudAndMaybeBan error', e)
  }
}

async function notifyTelegram(admin: any, orderId: string, creditResult: any, source: 'webhook' | 'sync') {
  if (!creditResult?.credited || creditResult?.duplicate) return
  const { data: dep } = await admin
    .from('zapupi_deposits')
    .select('user_id, amount_inr, txn_id, utr')
    .eq('order_id', orderId)
    .maybeSingle()
  if (!dep) return
  const { data: prof } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('user_id', dep.user_id)
    .maybeSingle()
  const { data: wal } = await admin
    .from('wallets')
    .select('balance')
    .eq('user_id', dep.user_id)
    .maybeSingle()
  const rate = 90
  const balInr = wal?.balance ? (Number(wal.balance) * rate).toFixed(2) : '?'
  const msg = [
    `💰 <b>Auto Fund Added (ZapUPI)</b>`,
    ``,
    `👤 <b>User:</b> ${prof?.email ?? dep.user_id}`,
    `💵 <b>Amount:</b> ₹${Number(dep.amount_inr).toFixed(2)}`,
    `🏦 <b>New Balance:</b> ₹${balInr}`,
    `🆔 <b>Order:</b> <code>${orderId}</code>`,
    dep.utr ? `🔁 <b>UTR:</b> <code>${dep.utr}</code>` : '',
    dep.txn_id ? `🧾 <b>Txn:</b> <code>${dep.txn_id}</code>` : '',
    `📡 <b>Source:</b> ${source}`,
  ].filter(Boolean).join('\n')
  await fetch(`${SUPABASE_URL}/functions/v1/send-telegram-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify({ message: msg, parse_mode: 'HTML' }),
  })
}
async function notifyUserAdmin(userId: string | null, orderId: string, status: 'success'|'failed', amountInr: number | null, reason?: string) {
  if (!userId) return
  await fetch(`${SUPABASE_URL}/functions/v1/notify-deposit-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
    body: JSON.stringify({
      user_id: userId, order_id: orderId, method: 'ZapUPI',
      status, amount_inr: amountInr, reason,
    }),
  }).catch(() => {})
}
