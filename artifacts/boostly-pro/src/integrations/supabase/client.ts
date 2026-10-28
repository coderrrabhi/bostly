import { API_BASE, apiUrl } from "@/lib/apiBase";
/**
 * Boostly runs on its own VPS API. This is a small PostgREST-shaped client that
 * sends every restored-screen read/write to that same-origin API (cookie auth),
 * so no page ever waits on the retired external backend.
 */
type Op = "eq" | "neq" | "in" | "is" | "notIn" | "lt" | "lte" | "gt" | "gte" | "like" | "ilike";
type Filter = { operator: Op; column: string; value: unknown };
type Result = { data: any; error: Error | null; count?: number | null };

const SERVER_READ_OPS = new Set<Op>(["eq", "neq", "in", "is"]);

const unavailable = (message = "This data operation is unavailable."): Result => ({
  data: null, error: new Error(message), count: null,
});

async function post(path: string, body: unknown): Promise<Result> {
  try {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.error) return unavailable(json.error || `Request failed (${response.status})`);
    return { data: json.data ?? json, error: null };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "Request failed");
  }
}

function likeToRegex(pattern: string, insensitive: boolean): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, insensitive ? "i" : "");
}

function matches(row: Record<string, any>, f: Filter): boolean {
  const v = row?.[f.column];
  switch (f.operator) {
    case "lt": return v != null && v < (f.value as any);
    case "lte": return v != null && v <= (f.value as any);
    case "gt": return v != null && v > (f.value as any);
    case "gte": return v != null && v >= (f.value as any);
    case "notIn": return !(Array.isArray(f.value) ? f.value : []).includes(v);
    case "like": return typeof v === "string" && likeToRegex(String(f.value), false).test(v);
    case "ilike": return typeof v === "string" && likeToRegex(String(f.value), true).test(v);
    default: return true;
  }
}

function parseList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const text = String(value ?? "").replace(/^\(|\)$/g, "");
  return text ? text.split(",").map((s) => s.trim().replace(/^"|"$/g, "")) : [];
}

class LegacyQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private sort?: { column: string; ascending: boolean };
  private take?: number;
  private page?: { from: number; to: number };
  private selected?: string;
  private countOnly = false;
  private wantCount = false;
  private mutation?: "insert" | "update" | "upsert" | "delete";
  private values?: unknown;

  private readonly table: string;
  // The "_safe" view never existed on the VPS database; the API already strips
  // every key/secret column from the base table, so read that instead.
  constructor(table: string) { this.table = table === "user_provider_accounts_safe" ? "user_provider_accounts" : table; }

  select(columns = "*", options?: { count?: string; head?: boolean }): this {
    if (!this.mutation) this.selected = columns;
    if (options?.count) this.wantCount = true;
    if (options?.head) this.countOnly = true;
    return this;
  }
  private add(operator: Op, column: string, value: unknown): this { this.filters.push({ operator, column, value }); return this; }
  eq(c: string, v: unknown) { return this.add("eq", c, v); }
  neq(c: string, v: unknown) { return this.add("neq", c, v); }
  in(c: string, v: unknown[]) { return this.add("in", c, v); }
  is(c: string, v: unknown) { return this.add("is", c, v); }
  lt(c: string, v: unknown) { return this.add("lt", c, v); }
  lte(c: string, v: unknown) { return this.add("lte", c, v); }
  gt(c: string, v: unknown) { return this.add("gt", c, v); }
  gte(c: string, v: unknown) { return this.add("gte", c, v); }
  like(c: string, v: unknown) { return this.add("like", c, v); }
  ilike(c: string, v: unknown) { return this.add("ilike", c, v); }
  not(column: string, operator: string, value: unknown): this {
    if (operator === "in") return this.add("notIn", column, parseList(value));
    if (operator === "is") return this.add("is", column, value === null ? "not-null" : null);
    if (operator === "eq") return this.add("neq", column, value);
    return this;
  }
  filter(column: string, operator: string, value: unknown): this {
    if (operator === "in") return this.add("in", column, parseList(value));
    if (["eq", "neq", "lt", "lte", "gt", "gte", "like", "ilike", "is"].includes(operator)) return this.add(operator as Op, column, value);
    return this;
  }
  match(query: Record<string, unknown>): this { for (const [k, v] of Object.entries(query)) this.eq(k, v); return this; }
  or(): this { return this; }
  contains(): this { return this; }
  textSearch(): this { return this; }
  returns(): this { return this; }
  abortSignal(): this { return this; }
  order(column: string, options?: { ascending?: boolean }): this {
    if (!this.sort) this.sort = { column, ascending: options?.ascending !== false };
    return this;
  }
  limit(value: number): this { this.take = Math.min(Math.max(1, value), 500); return this; }
  range(from: number, to: number): this { this.page = { from, to: Math.min(to, from + 499) }; return this; }

  insert(values?: unknown): this { this.mutation = "insert"; this.values = values; return this; }
  update(values?: unknown): this { this.mutation = "update"; this.values = values; return this; }
  upsert(values?: unknown): this { this.mutation = "upsert"; this.values = values; return this; }
  delete(): this { this.mutation = "delete"; return this; }

  async execute(): Promise<Result> {
    if (this.mutation) {
      return post("/legacy/mutate", { table: this.table, action: this.mutation, values: this.values, filters: this.filters });
    }
    const serverFilters = this.filters.filter((f) => SERVER_READ_OPS.has(f.operator) && !(f.operator === "is" && f.value === "not-null"));
    const clientFilters = this.filters.filter((f) => !serverFilters.includes(f));
    const notNull = this.filters.filter((f) => f.operator === "is" && f.value === "not-null");
    const needsClientSide = clientFilters.length > 0;
    const result = await post("/legacy/query", {
      table: this.table,
      filters: serverFilters.slice(0, 25),
      order: this.sort,
      limit: needsClientSide ? 500 : this.take,
      range: needsClientSide ? undefined : this.page,
      select: this.selected,
    });
    if (result.error) return result;
    let rows: any[] = Array.isArray(result.data) ? result.data : [];
    if (needsClientSide) {
      rows = rows.filter((row) => clientFilters.every((f) => f.operator === "is" ? true : matches(row, f)));
      rows = rows.filter((row) => notNull.every((f) => row?.[f.column] != null));
      if (this.page) rows = rows.slice(this.page.from, this.page.to + 1);
      else if (this.take) rows = rows.slice(0, this.take);
    }
    const count = this.wantCount ? rows.length : null;
    return { data: this.countOnly ? null : rows, error: null, count };
  }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> { return this.execute().then(onfulfilled, onrejected); }
  single(): Promise<Result> {
    return this.execute().then((r) => {
      if (r.error) return r;
      const rows = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
      if (rows.length === 1) return { data: rows[0], error: null };
      const err = Object.assign(new Error(rows.length ? "Multiple rows returned" : "No rows returned"), { code: "PGRST116" });
      return { data: null, error: err };
    });
  }
  maybeSingle(): Promise<Result> {
    return this.execute().then((r) => {
      if (r.error) return r;
      const rows = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
      return rows.length > 1 ? unavailable("Multiple rows returned") : { data: rows[0] ?? null, error: null };
    });
  }
}

const noSession = { data: { session: { access_token: "legacy-cookie" } }, error: null };

export const supabase: any = {
  from: (table: string) => new LegacyQuery(table),
  rpc: (name: string, args?: Record<string, unknown>) => post("/legacy/rpc", { name, args: args ?? {} }),
  functions: {
    invoke: async (name: string, options?: { body?: unknown; headers?: Record<string, string> }) => {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json", ...(options?.headers ?? {}) };
        if (headers.Authorization === "Bearer legacy-cookie") delete headers.Authorization;
        const response = await fetch(`${API_BASE}/functions/${encodeURIComponent(name)}`, {
          method: "POST", headers, credentials: "same-origin", body: JSON.stringify(options?.body ?? {}),
        });
        const body = await response.json().catch(() => ({}));
        return !response.ok || body.error ? unavailable(body.error || `Request failed (${response.status})`) : { data: body, error: null };
      } catch (error) { return unavailable(error instanceof Error ? error.message : "Request failed"); }
    },
  },
  auth: {
    getSession: async () => noSession,
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => unavailable("Please use the sign-in page."),
    signUp: async () => unavailable("Please use the sign-up page."),
    resetPasswordForEmail: async () => unavailable("Password reset is handled by support. Please contact us on Telegram."),
    updateUser: async () => unavailable("This account change is unavailable right now."),
  },
  storage: { from: () => ({ upload: async () => unavailable("File uploads are unavailable."), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  channel: () => { const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: () => undefined }; return ch; },
  removeChannel: () => undefined,
  removeAllChannels: () => undefined,
};
