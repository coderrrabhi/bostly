import { API_BASE, apiUrl } from "@/lib/apiBase";
export const fetchApi = async (endpoint: string, options: RequestInit = {}) => {
  const res = await fetch(apiUrl(endpoint), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error || `Request failed with status ${res.status}`);
  }
  return res.json();
};

// Coalesces concurrent callers onto one in-flight request and serves a short
// lived cached copy, so mounting several consumers does not fan out requests.
type CacheEntry = { inflight: Promise<any> | null; cachedAt: number; cached: any };

const coalescedGet = (endpoint: string, ttlMs: number) => {
  // Entries are scoped (normally by the signed-in user id) so one account can
  // never be served a response that was fetched for another.
  const entries = new Map<string, CacheEntry>();
  const request = (scope: string) => {
    const entry = entries.get(scope) ?? { inflight: null, cachedAt: 0, cached: null };
    entries.set(scope, entry);
    if (entry.cached && Date.now() - entry.cachedAt < ttlMs) return Promise.resolve(entry.cached);
    if (entry.inflight) return entry.inflight;
    entry.inflight = fetchApi(endpoint)
      .then((data) => {
        entry.cached = data;
        entry.cachedAt = Date.now();
        return data;
      })
      .finally(() => {
        entry.inflight = null;
      });
    return entry.inflight;
  };
  const get = () => request('');
  get.scoped = (scope: string) => request(scope);
  get.clear = () => entries.clear();
  return get;
};

const getDashboard = coalescedGet('/dashboard', 10_000);
const getSession = coalescedGet('/session', 5_000);

// Drop every short-lived response cache; called whenever the signed-in user changes.
const clearCaches = () => {
  getDashboard.clear();
  getSession.clear();
};

export const api = {
  fetchApi,
  getDashboard,
  getSession,
  clearCaches,
  getServices: () => fetchApi('/services'),
  getOrders: () => fetchApi('/orders'),
  getWallet: () => fetchApi('/wallet'),
  getSupportTickets: () => fetchApi('/support/tickets'),
  createSupportTicket: (data: any) => fetchApi('/support/tickets', { method: 'POST', body: JSON.stringify(data) }),
  getSettings: () => fetchApi('/settings'),
  updateSettings: (data: any) => fetchApi('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
};
