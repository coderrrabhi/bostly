import { Router, type IRouter } from "express";
import { pool } from "../db";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { resolveLegacyId } from "../lib/identity";
import { decryptProviderCredential, encryptProviderCredential } from "../lib/providerCredentials";

const router: IRouter = Router();
router.use(requireAuth);

function legacyId(req: AuthenticatedRequest): Promise<string> {
  return resolveLegacyId(req.userId);
}
function panelUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") ||
      /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error("Panel API URL must be a public https:// URL.");
  return url.toString().replace(/\/$/, "");
}
async function panel(apiUrl: string, apiKey: string, action: string, extra: Record<string, string | number> = {}): Promise<any> {
  const url = panelUrl(apiUrl);
  const params = new URLSearchParams({ key: apiKey, action, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "BoostlyPro/1.0 (+api)" }, body: params, signal: AbortSignal.timeout(8_000) });
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`Panel did not return JSON (HTTP ${response.status}).`); }
}
async function provider(id: string, userId: string): Promise<any | null> {
  const result = await pool.query("SELECT * FROM lovable_legacy.user_provider_accounts WHERE id=$1::uuid AND user_id=$2::uuid", [id, userId]);
  return result.rows[0] ?? null;
}
const bundleMapping = z.object({
  account_id: z.string().uuid(),
  enabled: z.boolean(),
  service_id: z.string().regex(/^\d+$/).nullable(),
  priority: z.coerce.number().int().min(1),
});
const body = z.object({
  op: z.enum(["create", "rotate_key", "test", "import_services", "validate_service", "place_order", "save_bundle_mappings"]),
  id: z.string().uuid().optional(), name: z.string().optional(), api_url: z.string().optional(), api_key: z.string().optional(),
  account_id: z.string().uuid().optional(), service_id: z.string().optional(), user_service_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(), mappings: z.array(bundleMapping).max(100).optional(),
  link: z.string().optional(), quantity: z.coerce.number().optional(),
});

router.post("/functions/user-provider-manage", async (req, res): Promise<void> => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }); return; }
  try {
    const data = parsed.data; const userId = await legacyId(req as AuthenticatedRequest);
    if (data.op === "create") {
      if (!data.name?.trim() || !data.api_url?.trim() || !data.api_key?.trim()) { res.status(400).json({ error: "name, api_url, api_key required" }); return; }
      const apiUrl = panelUrl(data.api_url.trim());
      const test = await panel(apiUrl, data.api_key.trim(), "balance").catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Connection failed" }));
      const ok = !test.error && test.balance !== undefined;
      const row = await pool.query(`INSERT INTO lovable_legacy.user_provider_accounts
        (user_id,name,api_url,api_key_ciphertext,api_key_hint,is_active,balance_cached,balance_currency,last_tested_at,last_test_ok,last_test_error)
        VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,now(),$6,$9) RETURNING id`,
        [userId, data.name.trim(), apiUrl, encryptProviderCredential(data.api_key.trim()), data.api_key.trim().slice(-4), ok, ok ? Number(test.balance) : null, ok ? (test.currency ?? null) : null, ok ? null : String(test.error ?? "Unknown")]);
      res.json({ id: row.rows[0].id, ok, test }); return;
    }
    if (data.op === "place_order") {
      if (!data.user_service_id || !data.link?.trim() || !data.quantity || data.quantity <= 0) { res.status(400).json({ error: "user_service_id, link, quantity required" }); return; }
      const service = await pool.query(`SELECT s.*, p.api_url, p.api_key_ciphertext FROM lovable_legacy.user_services s
        JOIN lovable_legacy.user_provider_accounts p ON p.id=s.user_provider_account_id
        WHERE s.id=$1::uuid AND s.user_id=$2::uuid AND p.user_id=$2::uuid`, [data.user_service_id, userId]);
      if (!service.rows[0]) { res.status(404).json({ error: "Service not found" }); return; }
      const row = service.rows[0];
      const response = await panel(row.api_url, decryptProviderCredential(row.api_key_ciphertext), "add", { service: row.provider_service_id, link: data.link.trim(), quantity: data.quantity });
      if (response?.error) { res.status(400).json({ error: String(response.error) }); return; }
      res.json({ ok: true, provider_response: response }); return;
    }
    if (data.op === "save_bundle_mappings") {
      if (!data.item_id || !data.mappings) { res.status(400).json({ error: "item_id and mappings required" }); return; }
      const enabledPriorities = data.mappings.filter((mapping) => mapping.enabled).map((mapping) => mapping.priority);
      if (new Set(enabledPriorities).size !== enabledPriorities.length) {
        res.status(400).json({ error: "Enabled providers must have unique priorities." }); return;
      }
      const accountIds = [...new Set(data.mappings.map((mapping) => mapping.account_id))];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const item = await client.query(
          "SELECT 1 FROM lovable_legacy.user_bundle_items WHERE id=$1::uuid AND user_id=$2::uuid FOR UPDATE",
          [data.item_id, userId],
        );
        if (!item.rows[0]) throw new Error("Bundle item not found.");
        if (accountIds.length) {
          const owned = await client.query(
            "SELECT id FROM lovable_legacy.user_provider_accounts WHERE user_id=$1::uuid AND id=ANY($2::uuid[])",
            [userId, accountIds],
          );
          if (owned.rowCount !== accountIds.length) throw new Error("One or more provider accounts do not belong to this user.");
        }
        const existing = await client.query<{ id: string; user_provider_account_id: string }>(
          "SELECT id,user_provider_account_id FROM lovable_legacy.user_bundle_item_providers WHERE user_bundle_item_id=$1::uuid AND user_id=$2::uuid FOR UPDATE",
          [data.item_id, userId],
        );
        const existingByAccount = new Map(existing.rows.map((row) => [row.user_provider_account_id, row.id]));
        await client.query(
          "UPDATE lovable_legacy.user_bundle_item_providers SET priority=-(1000000 + abs(priority)) WHERE user_bundle_item_id=$1::uuid AND user_id=$2::uuid",
          [data.item_id, userId],
        );
        for (const mapping of data.mappings) {
          const rowId = existingByAccount.get(mapping.account_id);
          if (rowId) {
            await client.query(
              "UPDATE lovable_legacy.user_bundle_item_providers SET enabled=$1,provider_service_id=$2,priority=$3,updated_at=now() WHERE id=$4::uuid AND user_id=$5::uuid",
              [mapping.enabled, mapping.service_id, mapping.priority, rowId, userId],
            );
          } else {
            await client.query(
              "INSERT INTO lovable_legacy.user_bundle_item_providers (user_id,user_bundle_item_id,user_provider_account_id,enabled,provider_service_id,priority) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6)",
              [userId, data.item_id, mapping.account_id, mapping.enabled, mapping.service_id, mapping.priority],
            );
          }
        }
        await client.query("COMMIT");
        res.json({ ok: true, saved: data.mappings.length }); return;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    const id = data.id ?? data.account_id;
    if (!id) { res.status(400).json({ error: "Provider id required" }); return; }
    const account = await provider(id, userId);
    if (!account) { res.status(404).json({ error: "Provider account not found" }); return; }
    if (data.op === "rotate_key") {
      if (!data.api_key?.trim()) { res.status(400).json({ error: "api_key required" }); return; }
      const test = await panel(account.api_url, data.api_key.trim(), "balance").catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Connection failed" }));
      const ok = !test.error && test.balance !== undefined;
      await pool.query(`UPDATE lovable_legacy.user_provider_accounts SET api_key_ciphertext=$1,api_key_hint=$2,is_active=$3,last_tested_at=now(),last_test_ok=$3,last_test_error=$4,balance_cached=COALESCE($5,balance_cached),balance_currency=COALESCE($6,balance_currency) WHERE id=$7::uuid`,
        [encryptProviderCredential(data.api_key.trim()), data.api_key.trim().slice(-4), ok, ok ? null : String(test.error ?? "Unknown"), ok ? Number(test.balance) : null, ok ? (test.currency ?? null) : null, id]);
      res.json({ ok, test }); return;
    }
    const credential = decryptProviderCredential(account.api_key_ciphertext);
    if (data.op === "test") {
      const test = await panel(account.api_url, credential, "balance").catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Connection failed" }));
      const ok = !test.error && test.balance !== undefined;
      await pool.query("UPDATE lovable_legacy.user_provider_accounts SET is_active=$1,last_tested_at=now(),last_test_ok=$1,last_test_error=$2,balance_cached=COALESCE($3,balance_cached),balance_currency=COALESCE($4,balance_currency) WHERE id=$5::uuid", [ok, ok ? null : String(test.error ?? "Unknown"), ok ? Number(test.balance) : null, ok ? (test.currency ?? null) : null, id]);
      res.json({ ok, test }); return;
    }
    if (data.op === "import_services") {
      const list = await panel(account.api_url, credential, "services");
      if (!Array.isArray(list)) { res.status(400).json({ error: list?.error ?? "Panel did not return a services array" }); return; }
      const client = await pool.connect();
      try { await client.query("BEGIN"); for (const s of list) { const serviceId = String(s.service ?? s.id ?? ""); if (!serviceId) continue;
        await client.query(`INSERT INTO lovable_legacy.user_services (user_id,user_provider_account_id,provider_service_id,name,category,type,rate,min_quantity,max_quantity,refill,cancel_allowed,is_active,raw)
          VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12::jsonb)
          ON CONFLICT (user_provider_account_id,provider_service_id) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,type=EXCLUDED.type,rate=EXCLUDED.rate,min_quantity=EXCLUDED.min_quantity,max_quantity=EXCLUDED.max_quantity,refill=EXCLUDED.refill,cancel_allowed=EXCLUDED.cancel_allowed,is_active=true,raw=EXCLUDED.raw`,
          [userId,id,serviceId,String(s.name ?? "Unnamed"),s.category ? String(s.category) : null,s.type ? String(s.type) : null,Number(s.rate ?? 0) || 0,Number(s.min ?? 1) || 1,Number(s.max ?? 1000000) || 1000000,Boolean(s.refill),Boolean(s.cancel),JSON.stringify(s)]); } await client.query("COMMIT"); } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
      res.json({ imported: list.filter((s: any) => String(s.service ?? s.id ?? "")).length }); return;
    }
    if (data.op === "validate_service") {
      const serviceId = data.service_id?.trim(); if (!serviceId || !/^\d+$/.test(serviceId)) { res.json({ ok: false, error: "Service ID must be numeric" }); return; }
      const cached = await pool.query("SELECT id,name,rate,min_quantity,max_quantity FROM lovable_legacy.user_services WHERE user_provider_account_id=$1::uuid AND provider_service_id=$2", [id, serviceId]);
      if (cached.rows[0]) { res.json({ ok: true, service: cached.rows[0] }); return; }
      const list = await panel(account.api_url, credential, "services"); const match = Array.isArray(list) && list.find((s: any) => String(s.service ?? s.id ?? "") === serviceId);
      res.json(match ? { ok: true, service: { name: String(match.name ?? "Unnamed"), rate: Number(match.rate ?? 0), min_quantity: Number(match.min ?? 1), max_quantity: Number(match.max ?? 1000000) } } : { ok: false, error: `Service ID ${serviceId} not found on this provider` }); return;
    }
    res.status(400).json({ error: "Unknown provider operation" });
  } catch (error) { req.log.warn({ err: error instanceof Error ? error.message : "provider operation failed" }, "Provider operation failed"); res.status(400).json({ error: error instanceof Error ? error.message : "Provider operation failed" }); }
});
export default router;