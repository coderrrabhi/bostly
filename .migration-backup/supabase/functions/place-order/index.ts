import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============ BAN CHECK ============
    const { data: banRow } = await supabaseAdmin
      .from("profiles")
      .select("is_banned, banned_reason")
      .eq("user_id", user.id)
      .maybeSingle();
    if (banRow?.is_banned) {
      return new Response(JSON.stringify({ error: "Account suspended: " + (banRow.banned_reason || "fraud") }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { orderData, totalPrice, runs } = body;

    if (!orderData || !totalPrice || totalPrice <= 0) {
      return new Response(JSON.stringify({ error: "Invalid order data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============ ALLOWLIST CLIENT INPUT (anti field-injection) ============
    // Never spread client orderData into a service-role insert. Pick only safe fields.
    const service_name: string | undefined = orderData.service_name;
    const orderInsertData: Record<string, unknown> = {
      service_id: orderData.service_id,
      link: typeof orderData.link === "string" ? orderData.link : null,
      quantity: orderData.quantity,
      is_drip_feed: !!orderData.is_drip_feed,
      is_organic_mode: !!orderData.is_organic_mode,
      variance_percent:
        Number.isFinite(Number(orderData.variance_percent))
          ? Math.min(100, Math.max(0, Number(orderData.variance_percent)))
          : 25,
      peak_hours_enabled: !!orderData.peak_hours_enabled,
      drip_qty_per_run: orderData.drip_qty_per_run ?? null,
      drip_interval: orderData.drip_interval ?? null,
      drip_interval_unit:
        orderData.drip_interval_unit === "minutes" ||
        orderData.drip_interval_unit === "hours" ||
        orderData.drip_interval_unit === "days"
          ? orderData.drip_interval_unit
          : "hours",
      runs_total: orderData.runs_total ?? null,
    };

    // ============ SERVER-SIDE PRICE RECOMPUTATION (anti-tamper) ============
    const qty = Math.max(0, Math.floor(Number(orderInsertData.quantity) || 0));
    if (!orderInsertData.service_id || qty <= 0 || !orderInsertData.link) {
      return new Response(JSON.stringify({ error: "Invalid service or quantity" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: svc, error: svcErr } = await supabaseAdmin
      .from("services")
      .select("id, price, min_quantity, max_quantity, is_active")
      .eq("id", orderInsertData.service_id)
      .maybeSingle();
    if (svcErr || !svc || svc.is_active === false) {
      return new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (svc.min_quantity && qty < svc.min_quantity) {
      return new Response(JSON.stringify({ error: `Minimum quantity is ${svc.min_quantity}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (svc.max_quantity && qty > svc.max_quantity) {
      return new Response(JSON.stringify({ error: `Maximum quantity is ${svc.max_quantity}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: psRow } = await supabaseAdmin
      .from("platform_settings").select("global_markup_percent").limit(1).maybeSingle();
    const markupMul = 1 + (Number(psRow?.global_markup_percent ?? 0) / 100);
    const safeTotalPrice = Math.round((qty / 1000) * Number(svc.price) * markupMul * 10000) / 10000;
    // Override any client-supplied price
    orderInsertData.price = safeTotalPrice;
    orderInsertData.quantity = qty;
    orderInsertData.status = "pending";

    // Quick pre-check (UX only; real check is atomic RPC below)
    const { data: walletPre } = await supabaseAdmin
      .from("wallets")
      .select("balance")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!walletPre) {
      return new Response(JSON.stringify({ error: "Wallet not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (walletPre.balance < safeTotalPrice) {
      return new Response(JSON.stringify({ error: "Insufficient balance" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const duplicateWindowStart = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recentDuplicateOrder } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, status, created_at")
      .eq("user_id", user.id)
      .eq("service_id", orderInsertData.service_id)
      .eq("link", orderInsertData.link)
      .eq("quantity", orderInsertData.quantity)
      .gte("created_at", duplicateWindowStart)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentDuplicateOrder) {
      return new Response(JSON.stringify({
        success: true,
        duplicate_blocked: true,
        order_id: recentDuplicateOrder.id,
        order_number: recentDuplicateOrder.order_number,
        status: recentDuplicateOrder.status,
        message: "A similar order was just created, so a duplicate request was blocked.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Create order
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        ...orderInsertData,
        user_id: user.id,
      })
      .select()
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: `Failed to create order: ${orderError?.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Atomic debit + transaction (under row lock, single DB transaction).
    //    If this fails, the order we just inserted is rolled back manually so
    //    users cannot end up with an order that was never paid for.
    const { data: debitData, error: debitError } = await supabaseAdmin.rpc(
      "debit_wallet_for_order",
      {
        p_user_id: user.id,
        p_amount: safeTotalPrice,
        p_order_id: order.id,
        p_engagement_order_id: null,
        p_description: `Order #${order.order_number} - ${service_name || "Service Order"}`,
      }
    );

    if (debitError || !debitData) {
      console.error("Atomic debit failed, rolling back order:", debitError);
      await supabaseAdmin.from("orders").delete().eq("id", order.id);
      const msg = debitError?.message || "Payment failed";
      const isInsufficient = msg.toLowerCase().includes("insufficient");
      return new Response(JSON.stringify({ error: msg }), {
        status: isInsufficient ? 400 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newBalance = (debitData as any).new_balance as number;

    // 5. Insert organic run schedule if provided (allowlist fields only)
    if (runs && Array.isArray(runs) && runs.length > 0) {
      const runEntries = runs.map((run: any, idx: number) => ({
        order_id: order.id,
        run_number: Number(run?.run_number ?? idx + 1),
        scheduled_at: run?.scheduled_at,
        quantity_to_send: Math.max(0, Math.floor(Number(run?.quantity_to_send) || 0)),
        base_quantity: Math.max(0, Math.floor(Number(run?.base_quantity ?? run?.quantity_to_send) || 0)),
        variance_applied: Number.isFinite(Number(run?.variance_applied)) ? Number(run.variance_applied) : 0,
        peak_multiplier: Number.isFinite(Number(run?.peak_multiplier)) ? Number(run.peak_multiplier) : 1,
        status: "pending",
      }));
      
      const { error: runErr } = await supabaseAdmin
        .from("organic_run_schedule")
        .insert(runEntries);
        
      if (runErr) console.error("Run schedule insert error:", runErr);
    }

    // 6. Trigger process-order for non-organic orders
    if (!orderInsertData.is_organic_mode) {
      try {
        await supabaseAdmin.functions.invoke("process-order", {
          body: { order_id: order.id },
        });
      } catch (e) {
        console.error("Failed to trigger process-order:", e);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      order_id: order.id,
      order_number: order.order_number,
      new_balance: newBalance,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("place-order error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
