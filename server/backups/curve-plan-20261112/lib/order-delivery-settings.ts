// Delivery start settings shared by Single and Mass orders.
//
// Per-run minimums are deliberately NOT stored or chosen here: they come from
// "My Bundles" (user_bundle_items.min_quantity) and win over the provider
// service minimum and the built-in defaults. See resolveEffectiveMin in
// engagement-order-management.ts.

export type DeliverySettings = {
  startMode: "instant" | "custom";
  startDelayMinutes: number;
};

const KEY = "boostly.delivery-settings.v1";

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  startMode: "instant",
  startDelayMinutes: 5,
};

export function loadDeliverySettings(): DeliverySettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_DELIVERY_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      startMode: parsed?.startMode === "custom" ? "custom" : "instant",
      startDelayMinutes: Math.min(1440, Math.max(0, Math.floor(Number(parsed?.startDelayMinutes) || 0))),
    };
  } catch {
    return DEFAULT_DELIVERY_SETTINGS;
  }
}

export function saveDeliverySettings(s: DeliverySettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** Fields to add to the process-engagement-order request body. */
export function deliveryPayload(s: DeliverySettings) {
  return {
    start_delay_minutes: s.startMode === "custom" ? Math.min(1440, Math.max(0, Math.floor(s.startDelayMinutes || 0))) : 0,
  };
}
