import { createClient } from 'npm:@supabase/supabase-js@2'

const OXAPAY_KEY = Deno.env.get('OXAPAY_MERCHANT_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  // Always respond 200 to prevent OxaPay from retrying storms; log everything.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
  const sourceIp = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null
  const userAgent = req.headers.get('user-agent') || null
  const httpMethod = req.method
  const headersObj: Record<string, string> = {}
  for (const [k, v] of req.headers.entries()) {
    // Redact anything token-ish in logs
    if (/authorization|cookie|api-key|secret/i.test(k)) continue
    headersObj[k] = v
  }
  let rawBody = ''
  try {
    rawBody = await req.text()
  } catch {
    return new Response('ok', { status: 200 })
  }

  const eventHash = await sha256(rawBody)
  const receivedSig = req.headers.get('hmac') || req.headers.get('HMAC') || ''
  const expectedSig = await hmacSha512Hex(OXAPAY_KEY, rawBody)
  const signatureValid = !!receivedSig && timingSafeEqual(receivedSig.toLowerCase(), expectedSig.toLowerCase())

  let payload: any = {}
  try { payload = JSON.parse(rawBody) } catch { payload = { raw: rawBody } }

  const orderId: string | null = payload?.order_id || payload?.orderId || null
  const trackId: string | null = payload?.track_id ? String(payload.track_id) : (payload?.trackId ? String(payload.trackId) : null)
  const status: string | null = String(payload?.status || payload?.type || '').toLowerCase() || null
  const txHash: string | null =
    payload?.tx_hash || payload?.txHash || payload?.txid ||
    (Array.isArray(payload?.txids) ? payload.txids[0] : null) ||
    payload?.transaction_id || null
  const payCurrency: string | null = payload?.pay_currency || payload?.currency || null
  const receivedAmountRaw = payload?.pay_amount ?? payload?.received_amount ?? payload?.amount
  const receivedAmount = receivedAmountRaw != null && !Number.isNaN(Number(receivedAmountRaw))
    ? Number(receivedAmountRaw) : null

  // Idempotency insert (unique event_hash)
  const { error: insertErr } = await admin.from('oxapay_webhook_events').insert({
    event_hash: eventHash,
    order_id: orderId,
    track_id: trackId,
    status,
    signature_valid: signatureValid,
    source_ip: sourceIp,
    payload,
    notes: signatureValid ? null : 'signature_invalid',
    tx_hash: txHash,
    pay_currency: payCurrency,
    received_amount: receivedAmount,
    http_method: httpMethod,
    headers: headersObj,
    user_agent: userAgent,
    signature_expected: expectedSig,
    signature_received: receivedSig || null,
    raw_body: rawBody.length > 20000 ? rawBody.slice(0, 20000) + '…[truncated]' : rawBody,
  })

  // Duplicate event → return early
  if (insertErr && String(insertErr.message).toLowerCase().includes('duplicate')) {
    return new Response('ok', { status: 200 })
  }

  if (!signatureValid) {
    await admin.from('oxapay_webhook_events').update({ processed: true }).eq('event_hash', eventHash)
    return new Response('ok', { status: 200 })
  }

  if (!orderId) {
    await admin.from('oxapay_webhook_events').update({ processed: true, notes: 'missing_order_id' }).eq('event_hash', eventHash)
    return new Response('ok', { status: 200 })
  }

  // ── Subscription payment routing (order_id starts with 'SUB_OXP_') ──
  if (orderId && orderId.startsWith('SUB_OXP_')) {
    const { data: subPay } = await admin.from('subscription_payments')
      .select('id, user_id, plan_type, activated').eq('order_id', orderId).maybeSingle()
    if (!subPay) {
      await admin.from('oxapay_webhook_events').update({ processed: true, notes: 'unknown_sub_order' }).eq('event_hash', eventHash)
      return new Response('ok', { status: 200 })
    }
    const isPaidSub = status && ['paid', 'confirmed', 'completed', 'success'].includes(status)
    await admin.from('subscription_payments').update({
      raw_payload: payload,
      status: isPaidSub ? 'paid' : (status || 'pending'),
    }).eq('order_id', orderId)
    let subResult: any = null
    if (isPaidSub && !subPay.activated) {
      const { data, error } = await admin.rpc('activate_subscription_from_payment', { p_order_id: orderId })
      subResult = error ? { error: error.message } : data
    }
    await admin.from('oxapay_webhook_events').update({
      processed: true, credit_result: { subscription: subResult, order_id: orderId },
    }).eq('event_hash', eventHash)
    return new Response('ok', { status: 200 })
  }

  // ── Ownership check: order_id MUST exist in THIS project's oxapay_deposits ──
  // Prevents cross-project webhook confusion: even if another site's OxaPay merchant
  // (same API key) somehow POSTs here, we only credit orders we ourselves created.
  const { data: ownDep, error: ownErr } = await admin
    .from('oxapay_deposits')
    .select('id, user_id, amount_inr, amount_usd')
    .eq('order_id', orderId)
    .maybeSingle()
  if (ownErr || !ownDep) {
    await admin.from('oxapay_webhook_events').update({
      processed: true,
      notes: 'foreign_order_id_rejected',
    }).eq('event_hash', eventHash)
    return new Response('ok', { status: 200 })
  }

  // Amount-match log (informational; USD-side compare with 1% tolerance)
  const expectedUsd = Number(ownDep.amount_usd) || null
  const amountMatch = expectedUsd != null && receivedAmount != null
    ? Math.abs(receivedAmount - expectedUsd) <= Math.max(0.01, expectedUsd * 0.01)
    : null
  await admin.from('oxapay_webhook_events').update({
    expected_amount: expectedUsd,
    amount_match: amountMatch,
  }).eq('event_hash', eventHash)

  // Mirror status onto deposit (via service_role — trigger allows it)
  const isPaid = status && ['paid', 'confirmed', 'completed', 'success'].includes(status)
  const updatePatch: Record<string, unknown> = {
    raw_payload: payload,
    status: status || 'waiting',
  }
  if (payload?.pay_currency) updatePatch.pay_currency = payload.pay_currency
  if (payload?.currency && !payload?.pay_currency) updatePatch.pay_currency = payload.currency
  if (trackId) updatePatch.track_id = trackId

  await admin.from('oxapay_deposits').update(updatePatch).eq('order_id', orderId)

  let creditResult: any = null
  if (isPaid) {
    const { data, error } = await admin.rpc('credit_wallet_oxapay', { p_order_id: orderId })
    creditResult = error ? { error: error.message } : data
  }

  await admin.from('oxapay_webhook_events').update({
    processed: true,
    credit_result: creditResult,
  }).eq('event_hash', eventHash)

  // ── Notify user + admin on Telegram (fire-and-forget) ──
  try {
    const { data: dep } = await admin
      .from('oxapay_deposits')
      .select('user_id, amount_inr, amount_usd')
      .eq('order_id', orderId)
      .maybeSingle()
    const isFailed = !isPaid && status && ['failed','expired','cancelled','canceled','underpaid'].includes(status)
    if (dep?.user_id && (creditResult?.credited || isFailed)) {
      await fetch(`${SUPABASE_URL}/functions/v1/notify-deposit-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({
          user_id: dep.user_id,
          order_id: orderId,
          method: 'OxaPay',
          status: creditResult?.credited ? 'success' : 'failed',
          amount_inr: dep.amount_inr,
          amount_usd: dep.amount_usd,
          reason: isFailed ? status : undefined,
        }),
      }).catch(() => {})
    }
  } catch (_) { /* ignore notify errors */ }

  return new Response('ok', { status: 200 })
})

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSha512Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}