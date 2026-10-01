import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const ZAPUPI_KEY = Deno.env.get('ZAPUPI_ZAP_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const token = authHeader.replace('Bearer ', '')
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token)
    if (claimsErr || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401)
    const userId = claims.claims.sub as string

    const body = await req.json().catch(() => ({}))
    const orderId: string | undefined = body?.order_id
    if (!orderId) return json({ error: 'order_id required' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const { data: dep, error: depErr } = await admin
      .from('zapupi_deposits')
      .select('id,user_id,credited,status,amount_inr')
      .eq('order_id', orderId)
      .maybeSingle()
    if (depErr || !dep) return json({ error: 'Order not found' }, 404)
    if (dep.user_id !== userId) return json({ error: 'Forbidden' }, 403)
    if (dep.credited) return json({ credited: true, already: true })

    const verify = await verifyOrder(orderId)
    if (!verify.success) {
      await admin.from('zapupi_deposits').update({
        gateway_response: { sync_verify: verify.raw },
      }).eq('order_id', orderId)
      return json({ credited: false, status: verify.statusStr || 'pending' })
    }

    // 🛡️ REPLAY PROTECTION: fingerprint this confirmed gateway response so the
    // same payment can never be processed twice across webhook + sync paths.
    const eventKey = `sync:${orderId}:${verify.txn_id ?? ''}:${verify.utr ?? ''}:${verify.statusStr}`
    const claimed = await claimEvent(admin, {
      event_key: eventKey, order_id: orderId,
      txn_id: verify.txn_id ?? null, utr: verify.utr ?? null,
      status: verify.statusStr ?? null, source: 'sync', payload: verify.raw,
    })
    if (!claimed) {
      // Already processed by webhook or an earlier sync call.
      const { data: depNow } = await admin
        .from('zapupi_deposits').select('credited').eq('order_id', orderId).maybeSingle()
      return json({ credited: !!depNow?.credited, replay: true })
    }

    // 🔒 Amount-match guard
    const expected = Number(dep.amount_inr)
    const paid = Number((verify as any).paid_amount)
    if (!Number.isFinite(paid) || Math.abs(paid - expected) > 0.01) {
      await admin.from('zapupi_deposits').update({
        status: 'mismatch',
        gateway_response: { sync_verify: verify.raw, expected_inr: expected, paid_inr: paid },
      }).eq('order_id', orderId)
      await recordFraudAndMaybeBan(admin, userId, 'amount_mismatch', {
        order_id: orderId, expected_inr: expected, paid_inr: paid, source: 'sync',
      })
      return json({ credited: false, mismatch: true }, 400)
    }

    const { data, error } = await admin.rpc('credit_wallet_zapupi', {
      p_order_id: orderId,
      p_txn_id: verify.txn_id ?? null,
      p_utr: verify.utr ?? null,
      p_gateway_response: { sync_verify: verify.raw, paid_inr: paid },
    })
    if (error) return json({ error: error.message }, 500)
    if ((data as any)?.credited && !(data as any)?.duplicate) {
      notifyTelegram(admin, orderId).catch((e) => console.error('tg notify', e))
    }
    return json({ credited: true, result: data })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})

async function verifyOrder(orderId: string) {
  const r = await fetch('https://pay.zapupi.com/api/order-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ zap_key: ZAPUPI_KEY, order_id: orderId }),
  })
  const text = await r.text()
  let data: any = {}
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  const d = data?.data ?? data
  const statusStr = String(d?.status ?? data?.status ?? '').toLowerCase()
  const success = statusStr === 'success' || statusStr === 'completed' || statusStr === 'paid'
  const paidRaw = d?.paid_amount ?? d?.amount ?? d?.amount_paid ?? data?.paid_amount ?? data?.amount
  const paid_amount = paidRaw != null ? Number(String(paidRaw).replace(/[^0-9.]/g, '')) : NaN
  return {
    success,
    statusStr,
    txn_id: d?.txn_id || data?.txn_id,
    utr: d?.utr || data?.utr,
    paid_amount,
    raw: data,
  }
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

async function claimEvent(admin: any, row: {
  event_key: string; order_id: string; txn_id: string | null; utr: string | null;
  status: string | null; source: 'webhook' | 'sync'; payload: unknown;
}): Promise<boolean> {
  const { error } = await admin.from('zapupi_webhook_events').insert(row)
  if (!error) return true
  if ((error as any)?.code === '23505') return false
  console.error('claimEvent insert error', error)
  return false
}

async function recordFraudAndMaybeBan(
  admin: any,
  userId: string | null,
  reasonCode: 'amount_mismatch' | 'repeated_failures',
  meta: Record<string, unknown>,
) {
  if (!userId) return
  try {
    await admin.from('admin_audit_log').insert({
      actor_id: null,
      actor_email: 'system:zapupi-guard',
      target_user_id: userId,
      action: `fraud_strike:${reasonCode}`,
      notes: JSON.stringify(meta),
      metadata: meta,
    })

    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: mismatchCount } = await admin
      .from('zapupi_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'mismatch').gte('created_at', sinceIso)
    const { count: failedCount } = await admin
      .from('zapupi_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'failed').gte('created_at', sinceIso)
    const mm = mismatchCount ?? 0
    const ff = failedCount ?? 0

    let shouldBan = false
    let banReason = ''
    if (reasonCode === 'amount_mismatch' && mm >= 1) {
      shouldBan = true
      banReason = `Auto-ban: ZapUPI amount-mismatch (${mm} in 24h). Latest: expected ₹${meta.expected_inr}, paid ₹${meta.paid_inr}, order ${meta.order_id}.`
    } else if (ff >= 5) {
      const { count: succCount } = await admin
        .from('zapupi_deposits').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('credited', true).gte('created_at', sinceIso)
      if ((succCount ?? 0) === 0) {
        shouldBan = true
        banReason = `Auto-ban: ${ff} failed ZapUPI deposits in 24h with zero successes.`
      }
    }

    const { data: prof } = await admin
      .from('profiles').select('email, is_banned').eq('user_id', userId).maybeSingle()

    if (shouldBan && prof && !prof.is_banned) {
      await admin.from('profiles').update({
        is_banned: true,
        banned_reason: banReason,
        banned_at: new Date().toISOString(),
      }).eq('user_id', userId)
      await admin.from('admin_audit_log').insert({
        actor_id: null, actor_email: 'system:zapupi-guard',
        target_user_id: userId, target_email: prof.email ?? null,
        action: 'auto_ban', notes: banReason,
        metadata: { reasonCode, mismatch_24h: mm, failed_24h: ff, ...meta },
      })
    }

    const tag = shouldBan ? '⛔ AUTO-BANNED' : '🚨 FRAUD STRIKE'
    const msg = [
      `${tag} <b>(ZapUPI)</b>`, ``,
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

async function notifyTelegram(admin: any, orderId: string) {
  const { data: dep } = await admin
    .from('zapupi_deposits')
    .select('user_id, amount_inr, txn_id, utr')
    .eq('order_id', orderId)
    .maybeSingle()
  if (!dep) return
  const { data: prof } = await admin
    .from('profiles').select('email').eq('user_id', dep.user_id).maybeSingle()
  const { data: wal } = await admin
    .from('wallets').select('balance').eq('user_id', dep.user_id).maybeSingle()
  const balInr = wal?.balance ? (Number(wal.balance) * 90).toFixed(2) : '?'
  const msg = [
    `💰 <b>Auto Fund Added (ZapUPI)</b>`,
    ``,
    `👤 <b>User:</b> ${prof?.email ?? dep.user_id}`,
    `💵 <b>Amount:</b> ₹${Number(dep.amount_inr).toFixed(2)}`,
    `🏦 <b>New Balance:</b> ₹${balInr}`,
    `🆔 <b>Order:</b> <code>${orderId}</code>`,
    dep.utr ? `🔁 <b>UTR:</b> <code>${dep.utr}</code>` : '',
    dep.txn_id ? `🧾 <b>Txn:</b> <code>${dep.txn_id}</code>` : '',
    `📡 <b>Source:</b> sync (manual verify)`,
  ].filter(Boolean).join('\n')
  await fetch(`${SUPABASE_URL}/functions/v1/send-telegram-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
    body: JSON.stringify({ message: msg, parse_mode: 'HTML' }),
  })
}