import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const OXAPAY_KEY = Deno.env.get('OXAPAY_MERCHANT_API_KEY') || ''
const ZAPUPI_KEY = Deno.env.get('ZAPUPI_ZAP_KEY') || ''
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
    const email = (claims.claims.email as string) || ''

    const body = await req.json().catch(() => ({}))
    const planType = String(body?.plan_type || '')
    const provider = String(body?.provider || '') as 'oxapay' | 'zapupi'
    if (!['monthly', 'yearly', 'lifetime'].includes(planType)) return json({ error: 'Invalid plan' }, 400)
    if (!['oxapay', 'zapupi'].includes(provider)) return json({ error: 'Invalid provider' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    const { data: plan } = await admin.from('subscription_plans')
      .select('*').eq('plan_type', planType).eq('is_active', true).maybeSingle()
    if (!plan) return json({ error: 'Plan not found' }, 404)

    const { data: prof } = await admin.from('profiles')
      .select('is_banned').eq('user_id', userId).maybeSingle()
    if (prof?.is_banned) return json({ error: 'Account suspended' }, 403)

    const returnBase = getSafeReturnBase(body?.return_origin)
    const orderId = `SUB_${provider.toUpperCase()}_${planType.toUpperCase()}_${crypto.randomUUID()}`
    const amountUsd = Number(plan.price_usd)
    const amountInr = Number(plan.price_inr)

    // Record intent
    await admin.from('subscription_payments').insert({
      user_id: userId,
      plan_type: planType,
      provider,
      order_id: orderId,
      amount_usd: amountUsd,
      amount_inr: amountInr,
      status: 'pending',
    })

    let paymentUrl: string | null = null

    if (provider === 'oxapay') {
      if (!OXAPAY_KEY) return json({ error: 'OxaPay not configured — admin ko API key set karni hai' }, 503)
      const payload = {
        amount: amountUsd,
        currency: 'USD',
        lifetime: 30,
        fee_paid_by_payer: 1,
        under_paid_coverage: 0,
        order_id: orderId,
        email,
        description: `Boostly Pro ${plan.label} subscription ($${amountUsd})`,
        return_url: `${returnBase}/subscription?paid=1&plan=${planType}`,
        callback_url: `${SUPABASE_URL}/functions/v1/oxapay-webhook`,
      }
      const r = await fetch('https://api.oxapay.com/v1/payment/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'merchant_api_key': OXAPAY_KEY },
        body: JSON.stringify(payload),
      })
      const text = await r.text()
      let data: any = {}
      try { data = JSON.parse(text) } catch { data = { raw: text } }
      const inner = data?.data ?? data
      paymentUrl = inner?.payment_url || inner?.payLink || null
      await admin.from('subscription_payments').update({
        raw_payload: data,
        payment_url: paymentUrl,
      }).eq('order_id', orderId)
    } else {
      if (!ZAPUPI_KEY) return json({ error: 'ZapUPI not configured — admin ko API key set karni hai' }, 503)
      const payload = {
        zap_key: ZAPUPI_KEY,
        order_id: orderId,
        amount: amountInr,
        customer_email: email,
        customer_name: email.split('@')[0] || 'user',
        redirect_url: `${returnBase}/subscription?paid=1&plan=${planType}`,
        webhook_url: `${SUPABASE_URL}/functions/v1/zapupi-webhook`,
        description: `Boostly Pro ${plan.label} subscription (₹${amountInr})`,
      }
      const r = await fetch('https://pay.zapupi.com/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const text = await r.text()
      let data: any = {}
      try { data = JSON.parse(text) } catch { data = { raw: text } }
      const inner = data?.data ?? data
      paymentUrl = inner?.payment_url || inner?.pay_url || inner?.checkout_url || null
      await admin.from('subscription_payments').update({
        raw_payload: data,
        payment_url: paymentUrl,
      }).eq('order_id', orderId)
    }

    if (!paymentUrl) {
      await admin.from('subscription_payments').update({ status: 'failed' }).eq('order_id', orderId)
      return json({ error: 'Gateway error — payment URL missing' }, 502)
    }

    return json({ order_id: orderId, payment_url: paymentUrl, amount_usd: amountUsd, amount_inr: amountInr })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status,
  })
}

function getSafeReturnBase(input: unknown): string {
  const fallback = 'https://boostlypro.com'
  try {
    const url = new URL(String(input || fallback))
    const host = url.hostname.toLowerCase()
    const allowed = host === 'boostlypro.com'
      || host.endsWith('.lovable.app')
      || host === 'localhost'
    return allowed ? `${url.protocol}//${url.host}`.replace(/\/+$/, '') : fallback
  } catch {
    return fallback
  }
}
