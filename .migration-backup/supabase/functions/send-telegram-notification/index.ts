import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

async function tg(path: string, body: Record<string, unknown>) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    throw new Error("Telegram connector not configured");
  }
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Authentication: service-role key OR an authenticated ADMIN user only.
    // Regular users can no longer post to the admin Telegram channel.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    let authorized = !!token && !!serviceKey && token === serviceKey;
    if (!authorized && token) {
      try {
        const supa = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          serviceKey,
        );
        const { data, error } = await supa.auth.getUser(token);
        if (!error && data?.user) {
          const { data: roleRow } = await supa
            .from("user_roles")
            .select("role")
            .eq("user_id", data.user.id)
            .eq("role", "admin")
            .maybeSingle();
          authorized = !!roleRow;
        }
      } catch (_) {
        authorized = false;
      }
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const TG_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
    if (!TG_CHAT_ID) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "TELEGRAM_CHAT_ID not set" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { message, photo_url, parse_mode = "HTML" } = await req.json();
    if (!message) {
      return new Response(JSON.stringify({ error: "No message provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result;
    if (photo_url) {
      result = await tg("sendPhoto", {
        chat_id: TG_CHAT_ID,
        photo: photo_url,
        caption: message,
        parse_mode,
      });
      if (!result?.ok) {
        result = await tg("sendMessage", { chat_id: TG_CHAT_ID, text: message, parse_mode });
      }
    } else {
      result = await tg("sendMessage", { chat_id: TG_CHAT_ID, text: message, parse_mode });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});