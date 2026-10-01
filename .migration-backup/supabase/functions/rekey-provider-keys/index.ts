import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OLD_SECRET = Deno.env.get('PROVIDER_KEY_SECRET')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getKey(secret: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function decryptWith(secret: string, payload: string) {
  const key = await getKey(secret);
  const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return new TextDecoder().decode(plain);
}
async function encryptWith(secret: string, plain: string) {
  const key = await getKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!OLD_SECRET) return json({ error: 'PROVIDER_KEY_SECRET missing on this deployment' }, 500);
    if (!SERVICE_ROLE) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY missing' }, 500);

    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user) return json({ error: 'unauthorized' }, 401);

    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: userRes.user.id, _role: 'admin' });
    if (!isAdmin) return json({ error: 'forbidden: admin only' }, 403);

    const body = await req.json().catch(() => ({}));
    const newSecret: string | undefined = body?.new_secret;
    // mode: 'export' -> do NOT touch this DB, just return re-encrypted ciphertexts
    const exportOnly: boolean = body?.mode === 'export';
    const dryRun: boolean = !exportOnly && body?.dry_run !== false && !newSecret;

    if (!dryRun && (typeof newSecret !== 'string' || newSecret.length < 16 || newSecret.length > 512)) {
      return json({ error: 'new_secret must be 16-512 characters' }, 400);
    }

    const { data: rows, error } = await admin
      .from('user_provider_accounts')
      .select('id, name, api_key_ciphertext');
    if (error) return json({ error: error.message }, 500);

    let ok = 0;
    let failed = 0;
    let rekeyed = 0;
    const failures: string[] = [];
    const items: Array<{ id: string; api_key_ciphertext: string }> = [];

    for (const row of rows ?? []) {
      let plain: string;
      try {
        plain = await decryptWith(OLD_SECRET, row.api_key_ciphertext);
        ok++;
      } catch {
        failed++;
        if (failures.length < 20) failures.push(row.id);
        continue;
      }
      if (dryRun) continue;
      const ct = await encryptWith(newSecret!, plain);
      if (exportOnly) {
        items.push({ id: row.id, api_key_ciphertext: ct });
        rekeyed++;
        continue;
      }
      const { error: upErr } = await admin
        .from('user_provider_accounts')
        .update({ api_key_ciphertext: ct, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (upErr) {
        failed++;
        if (failures.length < 20) failures.push(row.id);
      } else {
        rekeyed++;
      }
    }

    return json({
      mode: exportOnly ? 'export' : dryRun ? 'dry_run' : 'rekeyed',
      total: rows?.length ?? 0,
      decryptable: ok,
      rekeyed,
      failed,
      failed_ids: failures,
      ...(exportOnly ? { items } : {}),
    });

  } catch (e) {
    console.error('rekey-provider-keys error', e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
