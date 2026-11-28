// Comma-separated provider order numbers for the dashboard "Copy all" button.
// Runs arrive in scheduled order; blank/missing ids are skipped and repeats removed.
export function providerOrderIds(runs: any[]): string {
  const ids: string[] = [];
  for (const run of runs ?? []) {
    const id = String(run?.provider_order_id ?? "").trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.join(",");
}

// Per-Service History "Copy issues": provider ids of runs that are failed,
// cancelled/refunded or still processing at the provider. Completed and unsent runs are excluded.
export function issueProviderOrderIds(runs: any[], statusOf: (run: any) => string): string {
  return providerOrderIds((runs ?? []).filter((run) => ['failed', 'started'].includes(statusOf(run))));
}
