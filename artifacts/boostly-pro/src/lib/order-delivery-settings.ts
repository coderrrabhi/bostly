// Start delay + per-type minimum order settings shared by Single and Mass orders.
export const DEFAULT_MIN_QUANTITIES: Record<string, number> = {
  views: 101,
  likes: 2,
  comments: 1,
  saves: 10,
  shares: 2,
  reposts: 1,
};

export const MIN_TYPES: { key: string; label: string }[] = [
  { key: "views", label: "Views" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "saves", label: "Saves" },
  { key: "shares", label: "Shares" },
  { key: "reposts", label: "Reposts" },
];

export type DeliverySettings = {
  startMode: "instant" | "custom";
  startDelayMinutes: number;
  minMode: "default" | "custom";
  customMins: Record<string, number>;
};

const KEY = "boostly.delivery-settings.v1";

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  startMode: "instant",
  startDelayMinutes: 5,
  minMode: "default",
  customMins: { ...DEFAULT_MIN_QUANTITIES },
};

export function loadDeliverySettings(): DeliverySettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_DELIVERY_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_DELIVERY_SETTINGS,
      ...parsed,
      customMins: { ...DEFAULT_MIN_QUANTITIES, ...(parsed?.customMins ?? {}) },
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
  const mins = s.minMode === "custom" ? s.customMins : DEFAULT_MIN_QUANTITIES;
  const clean: Record<string, number> = {};
  Object.entries(mins).forEach(([k, v]) => { clean[k] = Math.max(0, Math.floor(Number(v) || 0)); });
  return {
    start_delay_minutes: s.startMode === "custom" ? Math.min(1440, Math.max(0, Math.floor(s.startDelayMinutes || 0))) : 0,
    min_quantities: clean,
  };
}
