const ACTIVE = new Set(["pending", "dispatching", "started", "processing", "dispatch_uncertain"]);

const delivered = (run: any) => {
  if (run.provider_remains !== null && run.provider_remains !== undefined && Number.isFinite(Number(run.provider_remains))) {
    return Math.max(0, Number(run.quantity_to_send) - Number(run.provider_remains));
  }
  return ["completed", "partial"].includes(String(run.status)) ? Number(run.quantity_to_send) || 0 : 0;
};

/** Manual retry is only for failures where no provider order was accepted. */
export function safeManualRetryRuns(order: any, now = new Date()) {
  if (!order?.items) return [];
  const views = order.items.find((item: any) => /views?$/i.test(String(item.engagement_type)));
  let viewsComplete = false;
  if (views) {
    const runs = views.runs || [];
    const total = runs.reduce((sum: number, run: any) => sum + delivered(run), 0);
    viewsComplete = runs.length > 0 && runs.every((run: any) => !ACTIVE.has(String(run.status))) && (
      views.status === "completed" || total >= Number(views.quantity || 0)
    );
  }

  return order.items.flatMap((item: any) => {
    const runs = [...(item.runs || [])].sort((a: any, b: any) => a.run_number - b.run_number);
    const maxRetries = String(item.engagement_type).toLowerCase().includes("comment") ? 20 : 10;
    return runs.filter((run: any, index: number) => {
      if (run.status !== "failed" || run.provider_order_id || run.dispatch_uncertain || viewsComplete) return false;
      if (Number(run.retry_count || 0) >= maxRetries) return false;
      const next = runs[index + 1];
      return !next || new Date(next.scheduled_at).getTime() > now.getTime();
    });
  });
}
