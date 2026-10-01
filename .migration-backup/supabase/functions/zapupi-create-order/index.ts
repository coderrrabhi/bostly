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
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const token = authHeader.replace('Bearer ', '')
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token)
    if (claimsErr || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401)
    const userId = claims.claims.sub as string

    const body = await req.json().catch(() => ({}))
    const amount = Number(body?.amount_inr)
    if (!Number.isFinite(amount) || amount < 50 || amount > 100000) {
      return json({ error: 'Amount must be between ₹50 and ₹100000' }, 400)
    }
    const amountInr = Math.round(amount * 100) / 100

    const origin = safeOrigin(req.headers.get('origin') || (body?.origin as string) || 'https://boostlypro.com')
    const returnBaseUrl = safeReturnUrl(body?.return_url, origin)
    const customerMobile = String(body?.customer_mobile || '').replace(/\D/g, '').slice(-10)
    const webhookUrl = `${SUPABASE_URL}/functions/v1/zapupi-webhook`

    const orderId = 'ZAP_' + crypto.randomUUID().replace(/-/g, '')
    const successUrl = gatewayReturnUrl(returnBaseUrl, 'success', orderId)
    const failedUrl = gatewayReturnUrl(returnBaseUrl, 'failed', orderId)
    const timeoutUrl = gatewayReturnUrl(returnBaseUrl, 'timeout', orderId)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const { error: insErr } = await admin.from('zapupi_deposits').insert({
      user_id: userId,
      order_id: orderId,
      amount_inr: amountInr,
      status: 'pending',
    })
    if (insErr) return json({ error: 'Failed to create deposit row', detail: insErr.message }, 500)

    // Call ZapUPI per official spec: POST /api/create-order (JSON)
    // https://zapupi.com/docs — fields: zap_key, order_id, amount,
    // customer_mobile (optional), remark (optional), webhook_url,
    // success_url, failed_url, timeout_url
    const gwPayload: Record<string, string> = {
      zap_key: ZAPUPI_KEY,
      order_id: orderId,
      amount: amountInr.toFixed(2),
      webhook_url: webhookUrl,
      success_url: successUrl,
      failed_url: failedUrl,
      timeout_url: timeoutUrl,
      redirect_url: successUrl,
      remark: `Wallet topup | ${userId}`,
    }
    if (customerMobile.length === 10) gwPayload.customer_mobile = customerMobile

    const gwRes = await fetch('https://pay.zapupi.com/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(gwPayload),
    })
    const gwText = await gwRes.text()
    let gwData: any = {}
    try { gwData = JSON.parse(gwText) } catch { /* keep text */ }

    const paymentUrl: string | undefined =
      gwData?.payment_url || gwData?.data?.payment_url || gwData?.url || gwData?.upi_url
    const statusStr = String(gwData?.status ?? '').toLowerCase()
    const gwStatusOk = (statusStr === 'success' || gwData?.status === true || gwData?.success === true || !!paymentUrl)

    if (!gwRes.ok || !gwStatusOk || !paymentUrl) {
      await admin.from('zapupi_deposits').update({
        status: 'failed',
        gateway_response: gwData?.message ? gwData : { raw: gwText },
      }).eq('order_id', orderId)
      return json({ error: 'Gateway error', detail: gwData?.message || gwText }, 502)
    }

    // Return immediately — persist payment_url + gateway_response in the background
    // so the user gets redirected without waiting for an extra DB round-trip.
    const persist = admin.from('zapupi_deposits').update({
      payment_url: paymentUrl,
      gateway_response: gwData,
    }).eq('order_id', orderId).then(() => {}, () => {})
    // @ts-ignore — EdgeRuntime is provided by Supabase Deno runtime
    if (typeof EdgeRuntime !== 'undefined' && (EdgeRuntime as any).waitUntil) {
      // @ts-ignore
      ;(EdgeRuntime as any).waitUntil(persist)
    }

    return json({ order_id: orderId, payment_url: paymentUrl })
  } catch (e) {
    return json({ error: 'Internal error', detail: String((e as Error).message || e) }, 500)
  }
})

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

function safeOrigin(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin
  } catch { /* fallback below */ }
  return 'https://boostlypro.com'
}

function safeReturnUrl(value: unknown, origin: string) {
  try {
    if (typeof value === 'string' && value.length <= 2048) {
      const url = new URL(value)
      if (url.origin === origin && url.pathname.replace(/\/$/, '') === '/wallet') {
        url.hash = ''
        url.searchParams.delete('status')
        url.searchParams.delete('order_id')
        url.searchParams.delete('utr')
        return url
      }
    }
  } catch { /* fallback below */ }
  return new URL('/wallet', origin)
}

function gatewayReturnUrl(returnUrl: URL, status: 'success' | 'failed' | 'timeout', orderId: string) {
  const url = new URL(`${SUPABASE_URL}/functions/v1/zapupi-return`)
  url.searchParams.set('status', status)
  url.searchParams.set('deposit_order_id', orderId)
  url.searchParams.set('return_url', returnUrl.toString())
  return url.toString()
}