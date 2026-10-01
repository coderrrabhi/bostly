import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

async function deriveWebhookSecret(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(`telegram-webhook:${apiKey}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function tg(path: string, body: Record<string, unknown>) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) throw new Error("Telegram connector not configured");
  const res = await fetch(`${GATEWAY_URL}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return await res.json();
}

async function getUsdToInr(): Promise<number> {
  try {
    const r = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    const j = await r.json();
    const rate = Number(j?.rates?.INR);
    if (rate > 0) return rate;
  } catch (_) { /* ignore */ }
  return 84;
}

async function fetchLiveBalances(chatId: number) {
  const { data: accounts, error } = await supabase
    .from("provider_accounts")
    .select("id,name,api_url,api_key,balance_currency,is_active")
    .eq("is_active", true)
    .order("name");

  if (error) {
    await tg("sendMessage", { chat_id: chatId, text: `❌ DB error: ${error.message}` });
    return;
  }
  if (!accounts?.length) {
    await tg("sendMessage", { chat_id: chatId, text: "⚠️ No active provider accounts found." });
    return;
  }

  await tg("sendMessage", { chat_id: chatId, text: `🔄 Checking <b>${accounts.length}</b> providers...`, parse_mode: "HTML" });

  const usdToInr = await getUsdToInr();
  const results = await Promise.all(accounts.map(async (acc: any) => {
    try {
      const fd = new URLSearchParams();
      fd.append("key", acc.api_key);
      fd.append("action", "balance");
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const resp = await fetch(acc.api_url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: fd.toString(),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const text = await resp.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { error: text }; }
      if (data.error) {
        await supabase.from("provider_accounts").update({
          balance_checked_at: new Date().toISOString(),
          last_balance_error: typeof data.error === "string" ? data.error : JSON.stringify(data.error),
        }).eq("id", acc.id);
        return { name: acc.name, error: String(data.error).slice(0, 80) };
      }
      const balance = parseFloat(data.balance ?? "0");
      const currency = (data.currency ?? acc.balance_currency ?? "USD").toUpperCase();
      await supabase.from("provider_accounts").update({
        balance, balance_currency: currency,
        balance_checked_at: new Date().toISOString(),
        last_balance_error: null,
      }).eq("id", acc.id);
      const inr = currency === "USD" ? balance * usdToInr : balance;
      return { name: acc.name, balance, currency, inr };
    } catch (e: any) {
      return { name: acc.name, error: e.message || "Network error" };
    }
  }));

  let totalInr = 0;
  const lines = results.map((r: any) => {
    if (r.error) return `❌ <b>${r.name}</b>\n   <i>${r.error}</i>`;
    totalInr += r.inr;
    const emoji = r.inr < 50 ? "🔴" : r.inr < 200 ? "🟡" : "🟢";
    return `${emoji} <b>${r.name}</b>\n   ₹${r.inr.toFixed(2)}`;
  });

  const msg = `💰 <b>Provider Balances</b>\n\n${lines.join("\n\n")}\n\n━━━━━━━━━━━━━━\n<b>Total: ₹${totalInr.toFixed(2)}</b>\n<i>Updated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</i>`;
  await tg("sendMessage", { chat_id: chatId, text: msg, parse_mode: "HTML" });
}

async function handleCommand(cmd: string, chatId: number) {
  const c = cmd.toLowerCase().split("@")[0].trim();
  if (c === "/balance" || c === "/bal" || c === "/balances") {
    await fetchLiveBalances(chatId);
  } else if (c === "/start" || c === "/help") {
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: `👋 <b>Boostly Pro Admin Bot</b>\n\nAvailable commands:\n\n/balance - Check live balance of all providers\n/help - Show this message`,
    });
  } else {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `❓ Unknown command. Send /help for available commands.`,
    });
  }
}

serve(async (req) => {
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, service: "telegram-webhook" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  if (!TELEGRAM_API_KEY) return new Response("Not configured", { status: 500 });

  const expected = await deriveWebhookSecret(TELEGRAM_API_KEY);
  const actual = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!safeEqual(actual, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = await req.json().catch(() => null);
  const message = update?.message ?? update?.edited_message;
  const chatId = message?.chat?.id;
  const text: string = message?.text ?? "";

  if (!chatId || !text) {
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only allow the configured admin chat
  const ALLOWED = Deno.env.get("TELEGRAM_CHAT_ID");
  if (ALLOWED && String(chatId) !== String(ALLOWED)) {
    await tg("sendMessage", { chat_id: chatId, text: "⛔ Unauthorized chat." });
    return new Response(JSON.stringify({ ok: true, unauthorized_chat: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    if (text.startsWith("/")) {
      await handleCommand(text, chatId);
    }
  } catch (e: any) {
    console.error("handler error", e);
    await tg("sendMessage", { chat_id: chatId, text: `❌ Error: ${e.message}` });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});