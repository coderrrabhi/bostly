export function bundleMaximum(value: unknown): number {
  const max = Number(value);
  return Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
}

export function capAtBundleMaximum(quantity: number, maxValue: unknown): number {
  const normalized = Math.max(0, Math.floor(Number(quantity) || 0));
  const max = bundleMaximum(maxValue);
  return max > 0 ? Math.min(normalized, max) : normalized;
}

export function assertWithinBundleMaximum(type: string, quantity: number, maxValue: unknown): number {
  const max = bundleMaximum(maxValue);
  if (max > 0 && quantity > max) {
    throw new Error(
      `${type} quantity ${quantity.toLocaleString("en-US")} exceeds My Bundles maximum ${max.toLocaleString("en-US")}.`,
    );
  }
  return max;
}
