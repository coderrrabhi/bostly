import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabase = createClient(supabaseUrl, serviceRoleKey);

        // Verify authentication
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) throw new Error("Not authenticated");
        const token = authHeader.replace("Bearer ", "");
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) throw new Error("Not authenticated");

        // Check if user is admin
        const { data: roleData } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("role", "admin")
            .maybeSingle();

        const isAdmin = !!roleData;

        const body = await req.json().catch(() => ({}));
        const orderId = body.order_id;
        if (!orderId) throw new Error("No order_id provided");

        // ============ ATOMIC RPC (race-condition safe, idempotent) ============
        // The RPC locks the order row, validates ownership/admin, cancels pending
        // runs, computes refund, and credits the wallet — all in ONE transaction.
        // Concurrent calls cannot double-refund because the second call sees
        // status='cancelled' under the row lock and returns already_cancelled.
        const { data: result, error: rpcError } = await supabase.rpc('cancel_order_with_refund', {
            p_order_id: orderId,
            p_actor: user.id,
            p_is_admin: isAdmin,
        });

        if (rpcError) throw new Error(rpcError.message || 'Cancellation failed');
        const r: any = result || {};

        return new Response(JSON.stringify({
            success: true,
            message: r.already_cancelled ? 'Order was already cancelled' : 'Order cancelled successfully',
            refundAmount: Number(r.refund_amount) || 0,
            refundedQuantity: Number(r.refunded_quantity) || 0,
            already_cancelled: !!r.already_cancelled,
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (err: any) {
        console.error("Cancel order error:", err);
        return new Response(JSON.stringify({ error: err.message || "Failed to cancel order" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }
});
