// DECOMMISSIONED — Plisio removed. This endpoint accepts nothing and credits nothing.
// Kept only to override the previous deployment.
Deno.serve(() => new Response(JSON.stringify({ error: "plisio_disabled" }), {
  status: 410,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
}));
