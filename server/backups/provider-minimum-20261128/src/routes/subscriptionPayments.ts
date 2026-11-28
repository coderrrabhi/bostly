import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { resolveLegacyId } from "../lib/identity";

// Subscription checkout for Boostly (OxaPay crypto + ZapUPI). Gateway webhooks are only
// hints: every activation re-reads the payment from the gateway before granting a plan.
const router: IRouter = Router();
const SITE = "https://boostbotting.site";
const API = `${SITE}/api`;

async function postJson(url: string, body: unknown): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { raw: text, http: r.status }; }
}

async function verifyWithGateway(p: any): Promise<boolean> {
  if (p.provider === "oxapay") {
    const key = process.env["OXAPAY_MERCHANT_KEY"]; const track = p.raw_payload?.trackId;
    if (!key || !track) return false;
    const d = await postJson("https://api.oxapay.com/merchants/inquiry", { merchant: key, trackId: track });
    return d?.result === 100 && String(d?.status).toLowerCase() === "paid" && String(d?.orderId ?? p.order_id) === p.order_id;
  }
  const key = process.env["ZAPUPI_ZAP_KEY"]; if (!key) return false;
  const data = await postJson("https://pay.zapupi.com/api/order-status", { zap_key: key, order_id: p.order_id });
  const d = data?.data ?? data;
  const status = String(d?.status ?? data?.status ?? "").toLowerCase();
  const paid = Number(d?.paid_amount ?? d?.amount_paid ?? d?.amount ?? data?.amount);
  return ["success", "completed", "paid"].includes(status) && Number.isFinite(paid) && paid + 0.01 >= Number(p.amount_inr);
}

export async function confirmSubscriptionPayment(orderId: string): Promise<boolean> {
  const found = await pool.query("SELECT * FROM lovable_legacy.subscription_payments WHERE order_id=$1", [orderId]);
  const p = found.rows[0]; if (!p) return false; if (p.activated) return true;
  if (!(await verifyWithGateway(p))) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claimed = await client.query("UPDATE lovable_legacy.subscription_payments SET status='paid', activated=true, updated_at=now() WHERE id=$1 AND activated=false RETURNING user_id, plan_type", [p.id]);
    if (claimed.rowCount) {
      const plan = (await client.query("SELECT duration_days FROM lovable_legacy.subscription_plans WHERE plan_type=$1", [p.plan_type])).rows[0];
      const lifetime = p.plan_type === "lifetime";
      const days = Number(plan?.duration_days) || (p.plan_type === "yearly" ? 365 : 30);
      const cur = (await client.query("SELECT id, status, expires_at FROM lovable_legacy.subscriptions WHERE user_id=$1 ORDER BY updated_at DESC NULLS LAST LIMIT 1 FOR UPDATE", [p.user_id])).rows[0];
      const base = cur?.status === "active" && cur.expires_at && new Date(cur.expires_at) > new Date() ? new Date(cur.expires_at) : new Date();
      const expires = lifetime ? null : new Date(base.getTime() + days * 86_400_000);
      if (cur) await client.query("UPDATE lovable_legacy.subscriptions SET plan_type=$2, status='active', activated_at=now(), expires_at=$3, updated_at=now() WHERE id=$1", [cur.id, p.plan_type, expires]);
      else await client.query("INSERT INTO lovable_legacy.subscriptions (user_id, plan_type, status, activated_at, expires_at) VALUES ($1,$2,'active',now(),$3)", [p.user_id, p.plan_type, expires]);
    }
    await client.query("COMMIT"); return true;
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

router.post("/functions/subscription-checkout", requireAuth, async (req, res): Promise<void> => {
  try {
    const planType = String(req.body?.plan_type ?? ""); const provider = String(req.body?.provider ?? "");
    if (!["monthly", "yearly", "lifetime"].includes(planType) || !["oxapay", "zapupi"].includes(provider)) { res.status(400).json({ error: "Invalid plan or payment method" }); return; }
    const plan = (await pool.query("SELECT price_usd, price_inr, name FROM lovable_legacy.subscription_plans WHERE plan_type=$1 AND is_active IS NOT FALSE LIMIT 1", [planType])).rows[0];
    if (!plan) { res.status(400).json({ error: "Plan not available" }); return; }
    const userId = await resolveLegacyId((req as AuthenticatedRequest).userId);
    const orderId = `sub${Date.now()}${randomUUID().slice(0, 6)}`;
    const usd = Number(plan.price_usd); const inr = Number(plan.price_inr);
    const returnUrl = `${API}/public/subscription-return?order=${orderId}`;
    await pool.query("INSERT INTO lovable_legacy.subscription_payments (user_id, plan_type, provider, order_id, amount_usd, amount_inr, status) VALUES ($1,$2,$3,$4,$5,$6,'pending')", [userId, planType, provider, orderId, usd, inr]);
    let url: string | undefined; let raw: any;
    if (provider === "oxapay") {
      const key = process.env["OXAPAY_MERCHANT_KEY"]; if (!key) throw new Error("Crypto payment is not configured");
      raw = await postJson("https://api.oxapay.com/merchants/request", { merchant: key, amount: usd, currency: "USD", lifeTime: 60, orderId, description: `Boostly ${planType} plan`, callbackUrl: `${API}/public/oxapay-subscription-webhook`, returnUrl });
      if (raw?.result === 100) url = raw.payLink;
    } else {
      const key = process.env["ZAPUPI_ZAP_KEY"]; if (!key) throw new Error("UPI payment is not configured");
      raw = await postJson("https://pay.zapupi.com/api/create-order", { zap_key: key, order_id: orderId, amount: inr.toFixed(2), webhook_url: `${API}/public/zapupi-subscription-webhook`, success_url: returnUrl, failed_url: returnUrl, timeout_url: returnUrl, redirect_url: returnUrl, remark: `Boostly ${planType} plan` });
      url = raw?.payment_url || raw?.data?.payment_url || raw?.url;
    }
    const safeRaw = { trackId: raw?.trackId, result: raw?.result, message: raw?.message, status: raw?.status };
    await pool.query("UPDATE lovable_legacy.subscription_payments SET payment_url=$2, raw_payload=$3, status=$4, updated_at=now() WHERE order_id=$1", [orderId, url ?? null, safeRaw, url ? "pending" : "failed"]);
    if (!url) { console.error("subscription-checkout gateway failure", provider, JSON.stringify(safeRaw)); res.json({ error: `Payment gateway error: ${raw?.message ?? raw?.msg ?? "no payment link"}` }); return; }
    res.json({ order_id: orderId, payment_url: url });
  } catch (e) { res.json({ error: e instanceof Error ? e.message : "Payment init failed" }); }
});

const hint = (orderId: unknown) => typeof orderId === "string" && /^sub\d+[a-f0-9-]{0,8}$/.test(orderId) ? confirmSubscriptionPayment(orderId).catch((e) => { console.error("subscription confirm failed", e); return false; }) : Promise.resolve(false);
router.post("/public/oxapay-subscription-webhook", async (req, res) => { await hint(req.body?.orderId ?? req.body?.order_id); res.status(200).send("ok"); });
router.post("/public/zapupi-subscription-webhook", async (req, res) => { await hint(req.body?.order_id ?? req.body?.data?.order_id); res.status(200).send("ok"); });
router.get("/public/subscription-return", async (req, res) => { const ok = await hint(req.query["order"]); res.redirect(302, `${SITE}/subscription?payment=${ok ? "success" : "pending"}`); });

export default router;
