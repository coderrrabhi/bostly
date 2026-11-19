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
