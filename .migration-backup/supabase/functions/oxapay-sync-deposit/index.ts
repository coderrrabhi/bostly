import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const OXAPAY_KEY = Deno.env.get('OXAPAY_MERCHANT_API_KEY')!
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
    const orderId = String(body?.order_id || '')
    if (!orderId) return json({ error: 'order_id required' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const { data: dep } = await admin.from('oxapay_deposits')
      .select('*').eq('order_id', orderId).maybeSingle()
    if (!dep) return json({ error: 'Not found' }, 404)
    if (dep.user_id !== userId) return json({ error: 'Forbidden' }, 403)
    if (dep.credited) return json({ credited: false, already: true })

    // Poll OxaPay for latest state. Never credit here — that only happens in webhook.
    if (dep.track_id) {
      try {
        const r = await fetch(`https://api.oxapay.com/v1/payment/${dep.track_id}`, {
          headers: { 'merchant_api_key': OXAPAY_KEY },
        })
        const txt = await r.text()
        let data: any = {}
        try { data = JSON.parse(txt) } catch { data = { raw: txt } }
        const inner = data?.data ?? data
        const remoteStatus = String(inner?.status || '').toLowerCase()
        if (remoteStatus) {
          await admin.from('oxapay_deposits').update({
            status: remoteStatus,
            pay_currency: inner?.pay_currency || inner?.currency || dep.pay_currency,
            raw_payload: data,
          }).eq('order_id', orderId)
        }
      } catch { /* ignore polling errors */ }
    }

    // Re-read
    const { data: fresh } = await admin.from('oxapay_deposits')
      .select('status,credited').eq('order_id', orderId).maybeSingle()

    return json({
      credited: false,
      already: !!fresh?.credited,
      status: fresh?.status || dep.status,
      awaiting: 'signed_webhook',
    })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status,
  })
}