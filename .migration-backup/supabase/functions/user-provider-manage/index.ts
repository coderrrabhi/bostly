// User Provider Account manager: save/update key (encrypted), test connection, cache balance.
// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const appCorsHeaders = {
  ...corsHeaders,
  'Access-Control-Allow-Headers': `${corsHeaders['Access-Control-Allow-Headers']}, x-region`,
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const KEY_SECRET = Deno.env.get('PROVIDER_KEY_SECRET')!;

// ---- AES-GCM helpers ----
async function getKey() {
  const raw = new TextEncoder().encode(KEY_SECRET);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function encrypt(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0); out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}
async function decrypt(payload: string): Promise<string> {
  const key = await getKey();
  const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plain);
}

// JAP-style panel call — tolerant of panels behind WAF/Cloudflare
const HEADER_PROFILES: Record<string, string>[] = [
  // 1) minimal, curl-like — many Cloudflare setups allow this and block "fake browser" headers
  { 'User-Agent': 'curl/8.4.0', 'Accept': '*/*' },
  // 2) plain API client
  { 'User-Agent': 'BoostlyPro/1.0 (+api)', 'Accept': 'application/json' },
  // 3) full browser-like
  {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  },
  // 4) no custom headers at all
  {},
];

function parseMaybeJson(text: string): any | null {
  try { return JSON.parse(text); } catch { /* not json */ }
  // some panels wrap JSON in HTML/whitespace/BOM
  const m = text.match(/[\{\[][\s\S]*[\}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

function urlVariants(url: string): string[] {
  const out = [url];
  try {
    const u = new URL(url);
    if (u.hostname.startsWith('www.')) u.hostname = u.hostname.slice(4);
    else u.hostname = 'www.' + u.hostname;
    out.push(u.toString().replace(/\/$/, ''));
  } catch { /* ignore */ }
  return out;
}

function validatePublicPanelUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error('Panel API URL must use https://');
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' || host === '0.0.0.0' || host === '::1' ||
    host.endsWith('.local') || host.endsWith('.internal') ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error('Private/internal panel URLs are not allowed');
  return parsed.toString().replace(/\/$/, '');
}

async function callPanelDirect(api_url: string, api_key: string, action: string, extra: Record<string, any> = {}) {
  const base = (api_url || '').trim().replace(/\s+/g, '');
  const safeBase = validatePublicPanelUrl(base);
  const params = new URLSearchParams({ key: api_key, action, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });

  const attempts: Array<() => Promise<Response>> = [];
  for (const url of urlVariants(safeBase)) {
    for (const h of HEADER_PROFILES) {
      attempts.push(() => fetch(url, { method: 'POST', headers: { ...h, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), signal: AbortSignal.timeout(8000) }));
      attempts.push(() => fetch(`${url}${url.includes('?') ? '&' : '?'}${params.toString()}`, { method: 'GET', headers: h, signal: AbortSignal.timeout(8000) }));
    }
    attempts.push(() => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: api_key, action, ...extra }), signal: AbortSignal.timeout(8000) }));
  }

  let lastText = '';
  let lastStatus = 0;
  for (const attempt of attempts) {
    try {
      const r = await attempt();
      const text = await r.text();
      lastText = text; lastStatus = r.status;
      const data = parseMaybeJson(text);
      if (data) return data;
    } catch (e: any) {
      lastText = e?.message || 'network error';
    }
  }
  const snippet = lastText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  throw new Error(`Panel did not return JSON (HTTP ${lastStatus}). It likely blocks server requests (Cloudflare/WAF) or the API URL is wrong. Details: ${snippet}`);
}

async function callPanel(api_url: string, api_key: string, action: string, extra: Record<string, any> = {}) {
  return await callPanelDirect(api_url, api_key, action, extra);
}



Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: appCorsHeaders });
  try {
    const body = await req.json().catch(() => ({}));

    if (!KEY_SECRET) { console.error('PROVIDER_KEY_SECRET missing'); return json({ error: 'server misconfigured: PROVIDER_KEY_SECRET missing' }, 500); }
    if (!SERVICE_ROLE) { console.error('SERVICE_ROLE missing'); return json({ error: 'server misconfigured: SERVICE_ROLE missing' }, 500); }
    if (!ANON) { console.error('ANON missing'); return json({ error: 'server misconfigured: ANON key missing' }, 500); }

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return json({ error: 'unauthorized' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const op = String(body?.op || '');
    console.log(`[user-provider-manage] op=${op} user=${user.id}`);

    // ---- CREATE ----
    if (op === 'create') {
      const name = String(body.name || '').trim();
      const api_url = String(body.api_url || '').trim();
      const api_key = String(body.api_key || '').trim();
      if (!name || !api_url || !api_key) return json({ error: 'name, api_url, api_key required' }, 400);
      if (!/^https?:\/\//i.test(api_url)) return json({ error: 'api_url must be http(s)://' }, 400);

      // test first
      const test = await callPanel(api_url, api_key, 'balance').catch((e) => ({ error: String(e.message || e) }));
      const ok = !test?.error && (test?.balance !== undefined);
      console.log(`[user-provider-manage] create test ok=${ok} err=${test?.error ?? ''}`);
      let ciphertext: string;
      try { ciphertext = await encrypt(api_key); } catch (e: any) {
        console.error('encrypt failed', e);
        return json({ error: 'encryption failed: ' + String(e?.message || e) }, 500);
      }
      const hint = api_key.slice(-4);

      const { data, error } = await admin.from('user_provider_accounts').insert({
        user_id: user.id, name, api_url,
        api_key_ciphertext: ciphertext, api_key_hint: hint,
        is_active: ok,
        balance_cached: ok ? Number(test.balance) : null,
        balance_currency: ok ? (test.currency || null) : null,
        last_tested_at: new Date().toISOString(),
        last_test_ok: ok,
        last_test_error: ok ? null : String(test?.error || 'Unknown'),
      }).select('id').single();
      if (error) {
        console.error('insert failed', JSON.stringify(error));
        return json({ error: error.message, details: (error as any).details, hint: (error as any).hint, code: (error as any).code }, 400);
      }
      return json({ id: data.id, ok, test });
    }

    // ---- UPDATE key ----
    if (op === 'rotate_key') {
      const id = String(body.id || '');
      const api_key = String(body.api_key || '').trim();
      if (!id || !api_key) return json({ error: 'id and api_key required' }, 400);
      const { data: row, error: rErr } = await admin.from('user_provider_accounts').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (rErr || !row) return json({ error: 'not found' }, 404);
      const test = await callPanel(row.api_url, api_key, 'balance').catch((e) => ({ error: String(e.message || e) }));
      const ok = !test?.error && (test?.balance !== undefined);
      const ciphertext = await encrypt(api_key);
      await admin.from('user_provider_accounts').update({
        api_key_ciphertext: ciphertext, api_key_hint: api_key.slice(-4),
        is_active: ok,
        last_tested_at: new Date().toISOString(), last_test_ok: ok,
        last_test_error: ok ? null : String(test?.error || 'Unknown'),
        balance_cached: ok ? Number(test.balance) : row.balance_cached,
        balance_currency: ok ? (test.currency || row.balance_currency) : row.balance_currency,
      }).eq('id', id).eq('user_id', user.id);
      return json({ ok, test });
    }

    // ---- TEST existing ----
    if (op === 'test') {
      const id = String(body.id || '');
      const { data: row } = await admin.from('user_provider_accounts').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!row) return json({ error: 'not found' }, 404);
      const key = await decrypt(row.api_key_ciphertext);
      const test = await callPanel(row.api_url, key, 'balance').catch((e) => ({ error: String(e.message || e) }));
      const ok = !test?.error && (test?.balance !== undefined);
      await admin.from('user_provider_accounts').update({
        is_active: ok,
        last_tested_at: new Date().toISOString(), last_test_ok: ok,
        last_test_error: ok ? null : String(test?.error || 'Unknown'),
        balance_cached: ok ? Number(test.balance) : row.balance_cached,
        balance_currency: ok ? (test.currency || row.balance_currency) : row.balance_currency,
      }).eq('id', id);
      return json({ ok, test });
    }

    // ---- IMPORT services ----
    if (op === 'import_services') {
      const id = String(body.id || '');
      const { data: row } = await admin.from('user_provider_accounts').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!row) return json({ error: 'not found' }, 404);
      const key = await decrypt(row.api_key_ciphertext);
      const list = await callPanel(row.api_url, key, 'services').catch((e) => ({ error: String(e.message || e) }));
      if (!Array.isArray(list)) return json({ error: list?.error || 'panel did not return services array' }, 400);

      const rows = list.map((s: any) => ({
        user_id: user.id,
        user_provider_account_id: id,
        provider_service_id: String(s.service ?? s.id ?? ''),
        name: String(s.name ?? 'Unnamed'),
        category: s.category ? String(s.category) : null,
        type: s.type ? String(s.type) : null,
        rate: Number(s.rate ?? 0) || 0,
        min_quantity: Number(s.min ?? 1) || 1,
        max_quantity: Number(s.max ?? 1000000) || 1000000,
        refill: Boolean(s.refill) || false,
        cancel_allowed: Boolean(s.cancel) || false,
        is_active: true,
        raw: s,
      })).filter((r) => r.provider_service_id);

      // upsert
      const { error: upErr } = await admin.from('user_services').upsert(rows, { onConflict: 'user_provider_account_id,provider_service_id' });
      if (upErr) return json({ error: upErr.message }, 400);
      return json({ imported: rows.length });
    }

    // ---- VALIDATE service id against provider ----
    if (op === 'validate_service') {
      const account_id = String(body.account_id || '');
      const service_id = String(body.service_id || '').trim();
      if (!account_id || !service_id) return json({ error: 'account_id and service_id required' }, 400);
      if (!/^\d+$/.test(service_id)) return json({ ok: false, error: 'Service ID must be numeric' }, 200);

      const { data: prov } = await admin.from('user_provider_accounts').select('*').eq('id', account_id).eq('user_id', user.id).maybeSingle();
      if (!prov) return json({ ok: false, error: 'Provider account not found' }, 200);

      // 1. Check cached user_services first (fast path)
      const { data: cached } = await admin.from('user_services')
        .select('id, name, rate, min_quantity, max_quantity')
        .eq('user_provider_account_id', account_id)
        .eq('provider_service_id', service_id)
        .maybeSingle();
      if (cached) return json({ ok: true, service: cached });

      // 2. Live lookup against panel (fallback)
      const key = await decrypt(prov.api_key_ciphertext);
      const list = await callPanel(prov.api_url, key, 'services').catch((e) => ({ error: String(e.message || e) }));
      if (!Array.isArray(list)) return json({ ok: false, error: list?.error || 'Provider did not return services list' }, 200);
      const match = list.find((s: any) => String(s.service ?? s.id ?? '') === service_id);
      if (!match) return json({ ok: false, error: `Service ID ${service_id} not found on this provider` }, 200);
      return json({ ok: true, service: { name: String(match.name || 'Unnamed'), rate: Number(match.rate || 0), min_quantity: Number(match.min || 1), max_quantity: Number(match.max || 1000000) } });
    }


    if (op === 'place_order') {
      const service_id = String(body.user_service_id || '');
      const link = String(body.link || '').trim();
      const quantity = Number(body.quantity || 0);
      if (!service_id || !link || !quantity) return json({ error: 'user_service_id, link, quantity required' }, 400);

      const { data: svc } = await admin.from('user_services').select('*').eq('id', service_id).eq('user_id', user.id).maybeSingle();
      if (!svc) return json({ error: 'service not found' }, 404);
      const { data: prov } = await admin.from('user_provider_accounts').select('*').eq('id', svc.user_provider_account_id).eq('user_id', user.id).maybeSingle();
      if (!prov) return json({ error: 'provider not found' }, 404);

      const key = await decrypt(prov.api_key_ciphertext);
      const resp = await callPanel(prov.api_url, key, 'add', { service: svc.provider_service_id, link, quantity });
      if (resp?.error) return json({ error: resp.error }, 400);
      return json({ ok: true, provider_response: resp });
    }

    return json({ error: 'unknown op' }, 400);
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...appCorsHeaders, 'Content-Type': 'application/json' } });
}
