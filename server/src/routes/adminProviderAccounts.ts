import { Router, type IRouter } from "express";
import { pool } from "../db";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { resolveIdentity } from "../lib/identity";
import { decryptProviderCredential } from "../lib/providerCredentials";

const router: IRouter = Router();
router.use(requireAuth);

const requestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("list") }).strict(),
  z.object({
    op: z.literal("update"),
    id: z.string().uuid(),
    priority: z.coerce.number().int().min(1).max(999).optional(),
    is_active: z.boolean().optional(),
  }).strict(),
  z.object({ op: z.literal("refresh_balance"), id: z.string().uuid() }).strict(),
]);

async function requireAdmin(req: AuthenticatedRequest): Promise<string> {
  const identity = await resolveIdentity(req.userId);
  if (!identity.isAdmin) {
    const error = new Error("Administrator access is required.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }
  return identity.legacyId;
}

function safePanelUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("Provider API URL must be a public HTTPS URL.");
  }
  return url.toString().replace(/\/$/, "");
}

async function refreshBalance(id: string): Promise<any> {
  const result = await pool.query(
    `SELECT id,api_url,api_key_ciphertext
       FROM lovable_legacy.user_provider_accounts
      WHERE id=$1::uuid`,
    [id],
  );
  const account = result.rows[0];
  if (!account) throw new Error("Provider account not found.");
  const params = new URLSearchParams({
    key: decryptProviderCredential(account.api_key_ciphertext),
    action: "balance",
  });
  const response = await fetch(safePanelUrl(account.api_url), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "BoostlyPro/1.0 (+api)" },
    body: params,
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Provider returned HTTP ${response.status} without JSON.`);
  }
  if (!response.ok || body?.error || body?.balance === undefined) {
    throw new Error(String(body?.error ?? "Provider did not return a balance."));
  }
  await pool.query(
    `UPDATE lovable_legacy.user_provider_accounts
        SET balance_cached=$1,balance_currency=$2,last_tested_at=now(),
            last_test_ok=true,last_test_error=NULL,updated_at=now()
      WHERE id=$3::uuid`,
    [Number(body.balance), body.currency ? String(body.currency) : null, id],
  );
  return body;
}

router.post("/functions/admin-provider-accounts", async (req, res): Promise<void> => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }
  try {
    await requireAdmin(req as AuthenticatedRequest);
    if (parsed.data.op === "list") {
      const result = await pool.query(
        `SELECT upa.id,upa.user_id,upa.name,upa.api_url,upa.api_key_hint,upa.priority,upa.is_active,
                upa.balance_cached,upa.balance_currency,upa.last_tested_at,upa.last_test_ok,
                upa.last_test_error,upa.created_at,upa.updated_at,
                COALESCE(active.active_runs,0)::int AS active_runs,
                COALESCE(mapped.mapped_services,0)::int AS mapped_services,
                p.email
           FROM lovable_legacy.user_provider_accounts upa
           LEFT JOIN lovable_legacy.profiles p ON p.id=upa.user_id
           LEFT JOIN LATERAL (
             SELECT count(*) AS active_runs
               FROM lovable_legacy.organic_run_schedule rs
              WHERE rs.user_provider_account_id=upa.id
                AND rs.rotation_lock_key IS NOT NULL
                AND rs.status IN ('dispatching','started','processing','dispatch_uncertain')
           ) active ON true
           LEFT JOIN LATERAL (
             SELECT count(*) AS mapped_services
               FROM lovable_legacy.user_bundle_item_providers ubip
              WHERE ubip.user_provider_account_id=upa.id AND ubip.enabled=true
           ) mapped ON true
          ORDER BY upa.priority,upa.name`,
      );
      res.json({ accounts: result.rows });
      return;
    }
    if (parsed.data.op === "update") {
      if (parsed.data.priority === undefined && parsed.data.is_active === undefined) {
        res.status(400).json({ error: "No account changes were supplied." });
        return;
      }
      const result = await pool.query(
        `UPDATE lovable_legacy.user_provider_accounts
            SET priority=COALESCE($1,priority),is_active=COALESCE($2,is_active),updated_at=now()
          WHERE id=$3::uuid
          RETURNING id,priority,is_active`,
        [parsed.data.priority ?? null, parsed.data.is_active ?? null, parsed.data.id],
      );
      if (!result.rows[0]) {
        res.status(404).json({ error: "Provider account not found." });
        return;
      }
      res.json({ account: result.rows[0] });
      return;
    }
    const balance = await refreshBalance(parsed.data.id);
    res.json({ ok: true, balance });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400;
    req.log.warn({ err: error instanceof Error ? error.message : "admin provider operation failed" }, "Admin provider account operation failed");
    res.status(status).json({ error: error instanceof Error ? error.message : "Provider account operation failed." });
  }
});

export default router;