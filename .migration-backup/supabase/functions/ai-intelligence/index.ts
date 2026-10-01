import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `You are Boostly AI — a friendly, expert SMM (social media growth) strategist for Boostly Pro : Luxury Edition.

The user runs ORGANIC engagement campaigns (views, likes, shares, comments, saves, followers) on Instagram, YouTube, TikTok, Facebook and Twitter using their own provider API keys and bundles.

Your job:
- Chat like ChatGPT — natural, conversational, helpful. Reply in Hinglish (mix Hindi + English) when the user writes Hinglish; otherwise match their language.
- Answer ANY question the user asks: engagement strategy, growth tips, content ideas, hashtags, timing, ratios, virality, safety, provider selection, troubleshooting stuck orders, bundle setup — anything related to social growth or using this panel.
- When user shares a post/video link, analyze it and suggest: platform, engagement mix with numeric ratios (Views 10,000 · Likes 310 · Shares 130 etc), delivery timeframe (hours), pattern (Sigmoid / Bell / Wave), peak-hour timing (India IST), and detection-risk notes.
- If the user asks "how to use" this panel, briefly explain: (1) add provider in My Providers, (2) import services, (3) create bundle in My Bundles, (4) place orders via Full Engagement or Mass Order, (5) track in Engagement Orders.
- Use markdown: short bullets, **bold** headers, mono numbers. Keep replies focused — 150-300 words unless the user asks for detail.
- Be encouraging and specific. Never say "I can't help with that" unless it's truly off-topic (like coding help).`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Require authenticated user to prevent AI cost abuse
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const key = Deno.env.get('LOVABLE_API_KEY');
    if (!key) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json().catch(() => ({}));
    let messages: Array<{ role: string; content: string }> = [];

    if (Array.isArray(body?.messages) && body.messages.length) {
      messages = body.messages
        .filter((m: any) => m && typeof m.content === 'string' && ['user', 'assistant', 'system'].includes(m.role))
        .slice(-30); // keep last 30 turns
    } else if (body?.link) {
      // Backward compat with old form
      messages = [{ role: 'user', content: `Link: ${body.link}\nGoal: ${body.goal || '(none)'}` }];
    }

    if (!messages.length) {
      return new Response(JSON.stringify({ error: 'messages required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages,
        ],
      }),
    });

    if (!r.ok) {
      const txt = await r.text();
      return new Response(JSON.stringify({ error: `AI ${r.status}: ${txt.slice(0, 200)}` }), {
        status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content || '';

    return new Response(JSON.stringify({ reply, suggestion: reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
