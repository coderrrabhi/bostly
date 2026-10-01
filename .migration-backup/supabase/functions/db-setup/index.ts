// Temporary migration utility: mirrors this project's database into a target Supabase project.
// Phases: schema | data | users | verify
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

type Res = { sql: string; ok: boolean; error?: string };

async function run(client: Client, statements: string[]): Promise<Res[]> {
  const out: Res[] = [];
  for (const sql of statements) {
    if (!sql || !sql.trim()) continue;
    try {
      await client.queryArray(sql);
      out.push({ sql: sql.slice(0, 160), ok: true });
    } catch (e) {
      out.push({ sql: sql.slice(0, 300), ok: false, error: String((e as Error).message ?? e) });
    }
  }
  return out;
}

/* ---------------- schema introspection ---------------- */

async function buildSchemaSql(src: Client): Promise<string[]> {
  const stmts: string[] = [];

  // 1. enums
  const enums = await src.queryObject<{ name: string; labels: string[] }>(`
    select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    group by t.typname`);
  for (const e of enums.rows) {
    stmts.push(`do $mig$ begin
      if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname=${lit(e.name)}) then
        create type public.${q(e.name)} as enum (${e.labels.map(lit).join(", ")});
      end if;
    end $mig$;`);
  }

  // 1b. sequences (needed by nextval() column defaults)
  const seqs = await src.queryObject<{ name: string }>(`
    select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='S'`);
  for (const s of seqs.rows) stmts.push(`create sequence if not exists public.${q(s.name)};`);

  // 2. tables + columns
  const tables = await src.queryObject<{ table_name: string }>(`
    select c.relname as table_name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
    order by c.relname`);

  const cols = await src.queryObject<{
    table_name: string; column_name: string; type: string; notnull: boolean; def: string | null; ord: number;
  }>(`
    select c.relname as table_name, a.attname as column_name,
           format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull as notnull,
           pg_get_expr(d.adbin, d.adrelid) as def,
           a.attnum as ord
    from pg_attribute a
    join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
    order by c.relname, a.attnum`);

  const byTable = new Map<string, typeof cols.rows>();
  for (const c of cols.rows) {
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, [] as any);
    byTable.get(c.table_name)!.push(c);
  }

  for (const t of tables.rows) {
    const tc = byTable.get(t.table_name) ?? [];
    const defs = tc.map((c) => {
      let s = `${q(c.column_name)} ${c.type}`;
      if (c.def) s += ` default ${c.def}`;
      if (c.notnull) s += " not null";
      return s;
    });
    stmts.push(`create table if not exists public.${q(t.table_name)} (\n  ${defs.join(",\n  ")}\n);`);
    // add any missing columns when the table already existed
    for (const c of tc) {
      let s = `alter table public.${q(t.table_name)} add column if not exists ${q(c.column_name)} ${c.type}`;
      if (c.def) s += ` default ${c.def}`;
      stmts.push(s + ";");
    }
  }

  // 3. constraints (pk/unique first, then fk/check)
  const cons = await src.queryObject<{ table_name: string; conname: string; contype: string; def: string }>(`
    select c.relname as table_name, con.conname, con.contype::text as contype, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
    order by case con.contype when 'p' then 0 when 'u' then 1 when 'c' then 2 else 3 end, c.relname`);
  for (const c of cons.rows) {
    stmts.push(`do $mig$ begin
      if not exists (select 1 from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and cl.relname=${lit(c.table_name)} and con.conname=${lit(c.conname)}) then
        alter table public.${q(c.table_name)} add constraint ${q(c.conname)} ${c.def};
      end if;
    end $mig$;`);
  }

  // 4. indexes (skip constraint-backed)
  const idx = await src.queryObject<{ def: string }>(`
    select pg_get_indexdef(i.indexrelid) as def
    from pg_index i
    join pg_class c on c.oid=i.indrelid
    join pg_class ic on ic.oid=i.indexrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
      and not exists (select 1 from pg_constraint con where con.conindid=i.indexrelid)`);
  for (const i of idx.rows) {
    stmts.push(i.def.replace(/^CREATE (UNIQUE )?INDEX /i, (m) => m.replace(/INDEX $/i, "INDEX IF NOT EXISTS ")) + ";");
  }

  // 5. functions
  const fns = await src.queryObject<{ def: string }>(`
    select pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'`);
  for (const f of fns.rows) stmts.push(f.def + ";");

  // 6. views
  const views = await src.queryObject<{ viewname: string; def: string }>(`
    select c.relname as viewname, pg_get_viewdef(c.oid, true) as def
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='v'`);
  for (const v of views.rows) {
    stmts.push(`create or replace view public.${q(v.viewname)} with (security_invoker = on) as ${v.def}`);
  }

  // 7. triggers (public tables + auth.users)
  const trg = await src.queryObject<{ tgname: string; table_name: string; schema: string; def: string }>(`
    select t.tgname, c.relname as table_name, n.nspname as schema, pg_get_triggerdef(t.oid) as def
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and (n.nspname='public' or (n.nspname='auth' and c.relname='users'))`);
  for (const t of trg.rows) {
    stmts.push(`drop trigger if exists ${q(t.tgname)} on ${q(t.schema)}.${q(t.table_name)};`);
    stmts.push(t.def + ";");
  }

  // 8. grants
  const grants = await src.queryObject<{ grantee: string; table_name: string; privilege_type: string }>(`
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated','service_role')`);
  for (const g of grants.rows) {
    stmts.push(`grant ${g.privilege_type} on public.${q(g.table_name)} to ${g.grantee};`);
  }
  stmts.push(`grant usage on schema public to anon, authenticated, service_role;`);
  stmts.push(`grant execute on all functions in schema public to authenticated, service_role;`);

  // 9. RLS + policies
  const rls = await src.queryObject<{ table_name: string }>(`
    select c.relname as table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity`);
  for (const r of rls.rows) stmts.push(`alter table public.${q(r.table_name)} enable row level security;`);

  const pols = await src.queryObject<{
    tablename: string; policyname: string; cmd: string; permissive: string; roles: string[]; qual: string | null; with_check: string | null;
  }>(`select tablename, policyname, cmd, permissive, roles, qual, with_check from pg_policies where schemaname='public'`);
  for (const p of pols.rows) {
    stmts.push(`drop policy if exists ${q(p.policyname)} on public.${q(p.tablename)};`);
    let s = `create policy ${q(p.policyname)} on public.${q(p.tablename)} as ${p.permissive === "PERMISSIVE" ? "permissive" : "restrictive"} for ${p.cmd.toLowerCase() === "all" ? "all" : p.cmd.toLowerCase()} to ${(p.roles ?? ["public"]).join(", ")}`;
    if (p.qual) s += ` using (${p.qual})`;
    if (p.with_check) s += ` with check (${p.with_check})`;
    stmts.push(s + ";");
  }

  return stmts;
}

/* ---------------- data copy ---------------- */

async function tableOrder(src: Client): Promise<string[]> {
  const tables = (await src.queryObject<{ t: string }>(`
    select c.relname as t from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by c.relname`)).rows.map((r) => r.t);
  const deps = (await src.queryObject<{ child: string; parent: string }>(`
    select cl.relname as child, pl.relname as parent
    from pg_constraint con
    join pg_class cl on cl.oid=con.conrelid
    join pg_class pl on pl.oid=con.confrelid
    join pg_namespace n on n.oid=cl.relnamespace
    join pg_namespace pn on pn.oid=pl.relnamespace
    where con.contype='f' and n.nspname='public' and pn.nspname='public'`)).rows;

  const ordered: string[] = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const visit = (t: string) => {
    if (seen.has(t) || visiting.has(t)) return;
    visiting.add(t);
    for (const d of deps.filter((d) => d.child === t && d.parent !== t)) visit(d.parent);
    visiting.delete(t);
    seen.add(t);
    ordered.push(t);
  };
  for (const t of tables) visit(t);
  return ordered;
}

async function copyData(src: Client, tgt: Client, only?: string[], startOffset = 0, maxRows = 0, sinceHours = 0) {
  const order = await tableOrder(src);
  const list = only?.length ? order.filter((t) => only.includes(t)) : order;
  const report: Record<string, unknown> = {};

  for (const table of list) {
    try {
      const colRows = (await src.queryObject<{ column_name: string; type: string }>(
        `select a.attname as column_name, format_type(a.atttypid, a.atttypmod) as type
         from pg_attribute a join pg_class c on c.oid=a.attrelid
         join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname=$1 and a.attnum>0 and not a.attisdropped order by a.attnum`,
        [table],
      )).rows;
      const cols = colRows.map((r) => r.column_name);
      const jsonCols = new Set(colRows.filter((r) => /json/i.test(r.type)).map((r) => r.column_name));

      const pk = (await src.queryObject<{ col: string }>(
        `select a.attname as col from pg_constraint con
         join pg_class c on c.oid=con.conrelid
         join pg_namespace n on n.oid=c.relnamespace
         join unnest(con.conkey) k(attnum) on true
         join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
         where con.contype='p' and n.nspname='public' and c.relname=$1`,
        [table],
      )).rows.map((r) => r.col);

      // unique constraints other than the PK — trigger-created target rows collide on these
      const uniqRows = (await src.queryObject<{ conname: string; col: string }>(
        `select con.conname, a.attname as col from pg_constraint con
         join pg_class c on c.oid=con.conrelid
         join pg_namespace n on n.oid=c.relnamespace
         join unnest(con.conkey) k(attnum) on true
         join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
         where con.contype='u' and n.nspname='public' and c.relname=$1`,
        [table],
      )).rows;
      const uniques = new Map<string, string[]>();
      for (const u of uniqRows) {
        if (!uniques.has(u.conname)) uniques.set(u.conname, []);
        uniques.get(u.conname)!.push(u.col);
      }

      // incremental mode: only rows touched in the last N hours (falls back to full copy)
      const tsCols = ["updated_at", "created_at"].filter((c) => cols.includes(c));
      const where = sinceHours > 0 && tsCols.length
        ? `where greatest(${tsCols.map((c) => `coalesce(${q(c)}, '-infinity'::timestamptz)`).join(", ")}) > now() - interval '${sinceHours} hours'`
        : "";

      // select json columns as text so they round-trip exactly
      const selectList = cols.map((c) => (jsonCols.has(c) ? `${q(c)}::text as ${q(c)}` : q(c))).join(", ");
      const colList = cols.map(q).join(", ");
      let offset = startOffset, total = 0;
      const orderBy = pk.length ? pk.map(q).join(", ") : cols.map(q).join(", ");
      let more = false;

      for (;;) {
        const batch = await src.queryArray(
          `select ${selectList} from public.${q(table)} ${where} order by ${orderBy} limit 500 offset ${offset}`,
        );
        if (batch.rows.length === 0) break;

        // clear target rows that would collide on a non-PK unique key (e.g. signup-trigger rows)
        for (const ucols of uniques.values()) {
          const idxs = ucols.map((c) => cols.indexOf(c));
          if (idxs.some((i) => i < 0)) continue;
          const vals: unknown[] = [];
          const tuples = batch.rows.map((row) => {
            const ph = idxs.map((i) => { vals.push(row[i]); return `$${vals.length}`; });
            return `(${ph.join(", ")})`;
          });
          try {
            await tgt.queryArray(
              `delete from public.${q(table)} where (${ucols.map(q).join(", ")}) in (${tuples.join(", ")})`,
              vals,
            );
          } catch { /* ignore */ }
        }

        const values: unknown[] = [];
        const rowsSql = batch.rows.map((row) => {
          const ph = row.map((v, i) => {
            values.push(v);
            return jsonCols.has(cols[i]) ? `$${values.length}::jsonb` : `$${values.length}`;
          });
          return `(${ph.join(", ")})`;
        });
        const conflict = pk.length
          ? `on conflict (${pk.map(q).join(", ")}) do update set ${cols.filter((c) => !pk.includes(c)).map((c) => `${q(c)} = excluded.${q(c)}`).join(", ") || `${q(pk[0])} = excluded.${q(pk[0])}`}`
          : "on conflict do nothing";
        await tgt.queryArray(
          `insert into public.${q(table)} (${colList}) values ${rowsSql.join(", ")} ${conflict}`,
          values,
        );
        total += batch.rows.length;
        offset += 500;
        if (batch.rows.length < 500) break;
        if (maxRows > 0 && total >= maxRows) { more = true; break; }
      }
      report[table] = { copied: total, next_offset: more ? offset : null };

    } catch (e) {
      report[table] = { error: String((e as Error).message ?? e) };
    }
  }
  return report;
}


/* ---------------- auth users copy ---------------- */

async function copyUsers(src: Client, tgt: Client) {
  const report: Record<string, unknown> = {};
  const userCols = [
    "instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at",
    "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at",
    "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at",
    "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at",
    "phone", "phone_confirmed_at", "banned_until", "is_sso_user", "deleted_at", "is_anonymous",
  ];
  const present = (await src.queryObject<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema='auth' and table_name='users'`,
  )).rows.map((r) => r.column_name);
  const tgtPresent = (await tgt.queryObject<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema='auth' and table_name='users'`,
  )).rows.map((r) => r.column_name);
  const use = userCols.filter((c) => present.includes(c) && tgtPresent.includes(c));

  const users = await src.queryArray(`select ${use.map(q).join(", ")} from auth.users order by created_at`);
  let inserted = 0;
  for (const row of users.rows) {
    const values: unknown[] = [];
    const ph = row.map((v) => { values.push(v); return `$${values.length}`; });
    try {
      await tgt.queryArray(
        `insert into auth.users (${use.map(q).join(", ")}) values (${ph.join(", ")})
         on conflict (id) do update set email = excluded.email, encrypted_password = excluded.encrypted_password,
           email_confirmed_at = excluded.email_confirmed_at, raw_user_meta_data = excluded.raw_user_meta_data`,
        values,
      );
      inserted++;
    } catch (e) {
      report[`user_error_${String(row[use.indexOf("id")])}`] = String((e as Error).message ?? e);
    }
  }
  report.users_upserted = inserted;

  // identities (email provider) — required for password login
  let ident = 0;
  const idCols = (await tgt.queryObject<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema='auth' and table_name='identities'`,
  )).rows.map((r) => r.column_name);
  const hasProviderId = idCols.includes("provider_id");

  const emails = await src.queryArray<[string, string]>(`select id::text, email from auth.users where email is not null`);
  for (const [id, email] of emails.rows) {
    try {
      if (hasProviderId) {
        await tgt.queryArray(
          `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
           values ($1::text, $2::uuid, jsonb_build_object('sub', $3::text, 'email', $4::text, 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now())
           on conflict (provider_id, provider) do nothing`,
          [id, id, id, email],
        );
      } else {
        await tgt.queryArray(
          `insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
           values (gen_random_uuid(), $1::uuid, jsonb_build_object('sub', $2::text, 'email', $3::text, 'email_verified', true), 'email', now(), now(), now())
           on conflict do nothing`,
          [id, id, email],
        );
      }
      ident++;
    } catch (e) {
      report[`identity_error_${id}`] = String((e as Error).message ?? e);
    }
  }
  report.identities_upserted = ident;
  return report;
}

/* ---------------- verify ---------------- */

async function verify(src: Client, tgt: Client) {
  const tables = (await src.queryObject<{ t: string }>(`
    select c.relname as t from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by c.relname`)).rows.map((r) => r.t);
  const rows: Record<string, unknown> = {};
  let mismatch = 0;
  for (const t of tables) {
    let s = -1, d = -1;
    try { s = Number((await src.queryArray<[string]>(`select count(*) from public.${q(t)}`)).rows[0][0]); } catch { /* ignore */ }
    try { d = Number((await tgt.queryArray<[string]>(`select count(*) from public.${q(t)}`)).rows[0][0]); } catch { /* ignore */ }
    rows[t] = { source: s, target: d, match: s === d };
    if (s !== d) mismatch++;
  }
  const su = Number((await src.queryArray<[string]>(`select count(*) from auth.users`)).rows[0][0]);
  const tu = Number((await tgt.queryArray<[string]>(`select count(*) from auth.users`)).rows[0][0]);
  return { tables: rows, table_count: tables.length, mismatched_tables: mismatch, users: { source: su, target: tu, match: su === tu } };
}

/* ---------------- handler ---------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Only a caller holding a service-role credential may run this migration utility.
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
  let authorized = false;
  if (provided && projectUrl) {
    try {
      const probe = await fetch(`${projectUrl}/auth/v1/admin/users?page=1&per_page=1`, {
        headers: { Authorization: `Bearer ${provided}`, apikey: provided },
      });
      authorized = probe.ok;
    } catch { authorized = false; }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sourceUrl = Deno.env.get("SUPABASE_DB_URL");
  const targetUrl = Deno.env.get("TARGET_DB_URL");
  if (!sourceUrl || !targetUrl) {
    return new Response(JSON.stringify({ error: "missing SUPABASE_DB_URL or TARGET_DB_URL" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { phase?: string; tables?: string[]; offset?: number; limit?: number; since_hours?: number } = {};
  try { body = await req.json(); } catch { /* default */ }
  const phase = body.phase ?? "verify";

  const src = new Client(sourceUrl);
  const tgt = new Client(targetUrl);
  try {
    await src.connect();
    await tgt.connect();

    let result: unknown;
    if (phase === "schema") {
      const all = await buildSchemaSql(src);
      const offset = body.offset ?? 0;
      const limit = body.limit ?? 120;
      const slice = all.slice(offset, offset + limit);
      const results = await run(tgt, slice);
      const failed = results.filter((r) => !r.ok);
      result = {
        total_statements: all.length,
        offset, applied: slice.length,
        next_offset: offset + slice.length < all.length ? offset + slice.length : null,
        succeeded: results.length - failed.length,
        failed: failed.length,
        errors: failed.slice(0, 40),
      };
    } else if (phase === "data") {
      result = await copyData(src, tgt, body.tables, body.offset ?? 0, body.limit ?? 0, body.since_hours ?? 0);
    } else if (phase === "sync") {
      // incremental 6-hourly mirror: new/changed rows + new signups
      const since = body.since_hours ?? 8;
      const users = await copyUsers(src, tgt);
      const data = await copyData(src, tgt, body.tables, 0, body.limit ?? 0, since);
      result = { since_hours: since, users, data };
    } else if (phase === "users") {
      result = await copyUsers(src, tgt);
    } else if (phase === "verify") {
      result = await verify(src, tgt);
    } else if (phase === "sql-preview") {
      result = { sql: (await buildSchemaSql(src)).join("\n\n") };
    } else {
      result = { error: `unknown phase: ${phase}` };
    }

    return new Response(JSON.stringify({ phase, result }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ phase, error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    try { await src.end(); } catch { /* ignore */ }
    try { await tgt.end(); } catch { /* ignore */ }
  }
});
