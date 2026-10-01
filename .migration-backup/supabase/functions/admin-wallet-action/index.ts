import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const INR_RATE = 90;
// Only these super-admin users can manually add funds. Everyone else (admin or not) is blocked.
// Funds otherwise come exclusively from successful ZapUPI payments.
const SUPER_ADMIN_USER_IDS = new Set<string>([
  "581a69bb-fe78-4da6-98cd-f36fdeff8f28", // zyrofit.my@gmail.com
  "82f9bd93-1e39-47ef-bdc0-f579262a122a", // admin@gmail.com
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = auth.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Invalid token" }, 401);

    // Admin role check
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "Forbidden — admins only" }, 403);

    const body = await req.json();
    const { target_user_id, action, inr_amount, notes, transaction_id } = body ?? {};

    // 🚫 HARD BLOCK: legacy pending-deposit approvals stay disabled forever.
    if (action === "approve_pending") {
      return json({
        error: "Manual approvals are permanently disabled. Funds can only be added via ZapUPI.",
      }, 403);
    }

    // 🔒 Manual `add` and `subtract` are allowed ONLY for super-admins.
    // All other admins are blocked from any wallet balance mutation.
    if ((action === "add" || action === "subtract") && !SUPER_ADMIN_USER_IDS.has(user.id)) {
      return json({
        error: "Only a super-admin can add or subtract funds. All other credits must come via ZapUPI.",
      }, 403);
    }

    // IP / UA (used by all branches)
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const ua = req.headers.get("user-agent") || "unknown";

    // ===== Branch: reject a pending deposit transaction (reject only — approve is disabled) =====
    if (action === "reject_pending") {
      if (!transaction_id) return json({ error: "transaction_id required" }, 400);

      const { data: tx, error: txFetchErr } = await admin
        .from("transactions")
        .select("id, user_id, amount, status, type, description")
        .eq("id", transaction_id)
        .maybeSingle();
      if (txFetchErr || !tx) return json({ error: "Transaction not found" }, 404);
      if (tx.status !== "pending") {
        return json({ error: `Already ${tx.status}` }, 400);
      }
      if (tx.type !== "deposit") {
        return json({ error: "Only deposit transactions can be rejected here" }, 400);
      }

      const txUsd = Number(tx.amount) || 0;
      const { data: tProfile } = await admin
        .from("profiles").select("email").eq("user_id", tx.user_id).maybeSingle();

      await admin.from("transactions").update({ status: "failed" }).eq("id", tx.id);
      await admin.from("admin_audit_log").insert({
        actor_id: user.id, actor_email: user.email,
        target_user_id: tx.user_id, target_email: tProfile?.email ?? null,
        action: "deposit_rejected", amount_usd: txUsd, amount_inr: null,
        notes: notes ?? null, ip_address: ip, user_agent: ua,
        metadata: { transaction_id: tx.id },
      });
      return json({ success: true, status: "failed" });
    }

    // ===== Branch: direct add / subtract by INR amount =====
    if (!target_user_id || (action !== "subtract" && action !== "add")) {
      return json({ error: "Invalid payload" }, 400);
    }
    const inr = Number(inr_amount);
    if (!isFinite(inr) || inr <= 0) {
      return json({ error: "Invalid amount" }, 400);
    }
    const usd = Math.trunc((inr / INR_RATE) * 10000) / 10000;

    // Fetch target wallet + email
    const { data: wallet, error: wErr } = await admin
      .from("wallets")
      .select("balance, total_deposited")
      .eq("user_id", target_user_id)
      .single();
    if (wErr || !wallet) return json({ error: "Target wallet not found" }, 404);

    const { data: targetProfile } = await admin
      .from("profiles")
      .select("email")
      .eq("user_id", target_user_id)
      .maybeSingle();

    const currentBalance = Number(wallet.balance) || 0;
    const isAdd = action === "add";
    const delta = isAdd ? usd : -usd;
    const newBalance = Math.trunc((currentBalance + delta) * 10000) / 10000;
    if (newBalance < 0) return json({ error: "Balance cannot be negative" }, 400);

    const currentDeposited = Number(wallet.total_deposited) || 0;
    const newDeposited = isAdd
      ? Math.trunc((currentDeposited + usd) * 10000) / 10000
      : currentDeposited;

    // IMPORTANT: insert transaction FIRST so the wallet credit-trail trigger
    // (enforce_wallet_credit_trail) finds a matching row when balance increases.
    const { error: txErr } = await admin.from("transactions").insert({
      user_id: target_user_id,
      type: isAdd ? "deposit" : "refund",
      amount: isAdd ? usd : -usd,
      balance_after: newBalance,
      description: `${isAdd ? "Admin manual credit" : "Admin withdrawal"} — ₹${inr.toFixed(2)}${notes ? " — " + notes : ""}`,
      status: "completed",
      payment_method: isAdd ? "manual_admin" : "manual_admin",
    });
    if (txErr) throw txErr;

    const { error: updErr } = await admin
      .from("wallets")
      .update({ balance: newBalance, total_deposited: newDeposited })
      .eq("user_id", target_user_id);
    if (updErr) throw updErr;

    // Audit log — never let logging failure block the action result
    await admin.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_email: user.email,
      target_user_id,
      target_email: targetProfile?.email ?? null,
      action: isAdd ? "wallet_credit_manual" : "wallet_withdraw",
      amount_usd: usd,
      amount_inr: inr,
      notes: notes ?? null,
      ip_address: ip,
      user_agent: ua,
      metadata: { new_balance: newBalance },
    });

    // Real-time Telegram alert (non-blocking)
    try {
      const balInr = (newBalance * INR_RATE).toFixed(2);
      const msg = [
        isAdd ? `🟢 <b>Manual Fund Added (Admin)</b>` : `🔴 <b>Manual Withdrawal (Admin)</b>`,
        ``,
        `👤 <b>User:</b> ${targetProfile?.email ?? target_user_id}`,
        `💵 <b>Amount:</b> ₹${inr.toFixed(2)}`,
        `🏦 <b>New Balance:</b> ₹${balInr}`,
        `🛡️ <b>Admin:</b> ${user.email ?? user.id}`,
        notes ? `📝 <b>Notes:</b> ${notes}` : '',
      ].filter(Boolean).join('\n');
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-telegram-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ message: msg, parse_mode: "HTML" }),
      });
    } catch (e) {
      console.error("tg notify failed", e);
    }

    return json({ success: true, new_balance: newBalance });
  } catch (e: any) {
    console.error("admin-wallet-action error", e);
    return json({ error: e?.message ?? "Internal error" }, 500);
  }

  function json(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});