// Returns a fresh signed download URL for the latest database export backup.
// Protected by a shared token so it can be called from a VPS with a short command.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const token = url.searchParams.get("k") ?? "";
  const expected = Deno.env.get("BACKUP_LINK_TOKEN") ?? "";
  if (!expected || token !== expected) {
    return new Response("forbidden", { status: 403, headers: cors });
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

  const bRes = await fetch(`${SB_URL}/storage/v1/bucket`, { headers: h });
  const buckets: Array<{ name: string }> = await bRes.json();
  const exportBuckets = buckets
    .map((b) => b.name)
    .filter((n) => n.startsWith("database_export"))
    .sort()
    .reverse();

  for (const bucket of exportBuckets) {
    const lRes = await fetch(`${SB_URL}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ prefix: "", limit: 100, sortBy: { column: "created_at", order: "desc" } }),
    });
    const objs: Array<{ name: string }> = await lRes.json();
    const file = objs?.find?.((o) => o.name?.endsWith(".backup") || o.name?.endsWith(".dump") || o.name?.endsWith(".sql"));
    if (!file) continue;

    const sRes = await fetch(`${SB_URL}/storage/v1/object/sign/${bucket}/${file.name}`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    const signed = await sRes.json();
    if (!signed?.signedURL) continue;
    const full = `${SB_URL}/storage/v1${signed.signedURL}`;

    if (url.searchParams.get("redirect") === "0") {
      return new Response(full, { headers: { ...cors, "Content-Type": "text/plain" } });
    }
    return new Response(null, { status: 302, headers: { ...cors, Location: full } });
  }

  return new Response("no backup file found", { status: 404, headers: cors });
});
