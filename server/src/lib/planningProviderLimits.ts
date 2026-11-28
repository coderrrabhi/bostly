type ProviderRow = {
  user_provider_account_id: string;
  provider_service_id: string;
  min_quantity?: unknown;
  max_quantity?: unknown;
};

/** Missing imported services must not silently turn a provider minimum into 1. */
export async function planningProviderLimits<T extends ProviderRow>(
  rows: T[],
  catalog: (accountId: string) => Promise<Array<{ service?: unknown; id?: unknown; min?: unknown; max?: unknown }>>,
): Promise<Array<T & { min_quantity: number; max_quantity: number }>> {
  const catalogs = new Map<string, Awaited<ReturnType<typeof catalog>>>();
  const verified: Array<T & { min_quantity: number; max_quantity: number }> = [];
  for (const row of rows) {
    let min = Number(row.min_quantity), max = Number(row.max_quantity);
    if (!(min >= 1 && max >= min)) {
      let list = catalogs.get(row.user_provider_account_id);
      if (!list) {
        try { list = await catalog(row.user_provider_account_id); } catch { list = []; }
        catalogs.set(row.user_provider_account_id, list);
      }
      const service = list.find(s => String(s.service ?? s.id) === String(row.provider_service_id));
      min = Number(service?.min); max = Number(service?.max);
    }
    if (Number.isFinite(min) && min >= 1 && Number.isFinite(max) && max >= min) {
      verified.push({ ...row, min_quantity: Math.ceil(min), max_quantity: Math.floor(max) });
    }
  }
  if (!verified.length) throw new Error('Provider service limits could not be verified. Refresh services in My Providers before placing this order.');
  return verified;
}