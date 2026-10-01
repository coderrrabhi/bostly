import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TERMINAL = new Set([
  "completed", "complete", "partial", "refunded", "canceled", "cancelled",
  "error", "failed", "success", "refund", "canscelled",
]);
const isTerminal = (s?: string | null) => TERMINAL.has((s || "").toLowerCase().trim());
const normLink = (s?: string | null) =>
  (s || "").toLowerCase().trim().replace(/\/$/, "");

async function sendTelegram(supabaseUrl: string, serviceKey: string, text: string) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-telegram-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({ message: text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("Telegram send failed:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Auth: service-role key or CRON_SECRET (cron-internal endpoint)
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!token || (token !== serviceKey && !(cronSecret && token === cronSecret))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const { data: runs, error } = await supabase
      .from("organic_run_schedule")
      .select(
        "id, status, provider_status, provider_order_id, provider_account_id, provider_account_name, engagement_order_item:engagement_order_items(engagement_type, engagement_order:engagement_orders(link))",
      )
      .eq("status", "started")
      .not("provider_order_id", "is", null)
      .limit(5000);

    if (error) throw error;

    // Group: key = link||type||provider_account_id, count active (started + non-terminal)
    const groups = new Map<
      string,
      { link: string; type: string; provider: string; providerId: string; count: number }
    >();

    for (const r of runs || []) {
      if (isTerminal((r as any).provider_status)) continue;
      const link = normLink((r as any).engagement_order_item?.engagement_order?.link);
      const type = ((r as any).engagement_order_item?.engagement_type || "")
        .toLowerCase()
        .trim();
      const pid = (r as any).provider_account_id;
      if (!link || !type || !pid) continue;
      const key = `${link}||${type}||${pid}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(key, {
          link,
          type,
          provider: (r as any).provider_account_name || "Unknown",
          providerId: pid,
          count: 1,
        });
      }
    }

    // Filter to violations
    const violations = Array.from(groups.entries()).filter(([, g]) => g.count > 1);

    // Load prior alert state for these keys
    const { data: priorStates } = await supabase
      .from("rotation_alert_state")
      .select("alert_key, last_count, resolved_at");

    const stateMap = new Map<string, { last_count: number; resolved_at: string | null }>();
    for (const s of priorStates || []) {
      stateMap.set((s as any).alert_key, {
        last_count: (s as any).last_count,
        resolved_at: (s as any).resolved_at,
      });
    }

    const alertsSent: string[] = [];
    const upserts: any[] = [];

    for (const [key, g] of violations) {
      const prior = stateMap.get(key);
      const priorCount = prior?.last_count ?? 0;
      const priorActive = prior && prior.resolved_at === null;
      // Anti-noise: only alert if the violation persisted across at least 2 consecutive scans.
      // First detection just records state silently; if next scan still sees it, then alert.
      // This kills transient races (parallel cron, revert migrations, etc.) that self-resolve within ~1 min.
      const persistedSecondScan = !!priorActive && priorCount > 0;
      const escalated = g.count > priorCount && priorActive;
      if (persistedSecondScan || escalated) {
        const msg =
          `🚨 <b>Rotation Guard Violation</b>\n\n` +
          `<b>Provider:</b> ${g.provider}\n` +
          `<b>Type:</b> ${g.type}\n` +
          `<b>Active orders on same link:</b> ${g.count}\n\n` +
          `<b>Link:</b> <code>${g.link}</code>\n\n` +
          `Same provider has ${g.count} active orders on this link+type — rotation guard failed (persisted across multiple scans).`;
        await sendTelegram(supabaseUrl, serviceKey, msg);
        alertsSent.push(key);
      }
      upserts.push({
        alert_key: key,
        last_count: g.count,
        last_alerted_at: new Date().toISOString(),
        resolved_at: null,
      });
    }

    if (upserts.length > 0) {
      await supabase.from("rotation_alert_state").upsert(upserts, { onConflict: "alert_key" });
    }

    // Mark resolved: prior keys no longer in violations
    const activeKeys = new Set(violations.map(([k]) => k));
    const toResolve = (priorStates || [])
      .filter((s: any) => !activeKeys.has(s.alert_key) && s.resolved_at === null)
      .map((s: any) => s.alert_key);

    if (toResolve.length > 0) {
      await supabase
        .from("rotation_alert_state")
        .update({ resolved_at: new Date().toISOString() })
        .in("alert_key", toResolve);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: (runs || []).length,
        violations: violations.length,
        alerts_sent: alertsSent.length,
        resolved: toResolve.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("detect-rotation-violations error:", err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});