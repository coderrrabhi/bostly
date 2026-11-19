import { Zap, Timer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveDeliverySettings, type DeliverySettings } from "@/lib/order-delivery-settings";

type Props = { value: DeliverySettings; onChange: (v: DeliverySettings) => void };

function Toggle({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-secondary p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${value === o.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Delivery Start Time only. Per-run minimums are NOT chosen here: they come
 * from "My Bundles" (user_bundle_items.min_quantity), which wins over the
 * provider service minimum and the built-in defaults — see resolveEffectiveMin.
 */
export function DeliveryStartTime({ value, onChange }: Props) {
  const set = (patch: Partial<DeliverySettings>) => {
    const next = { ...value, ...patch };
    saveDeliverySettings(next);
    onChange(next);
  };

  return (
    <div className="glass-card p-6 space-y-6">
      {/* Start time */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Timer className="w-5 h-5 text-primary" />
            <Label className="text-base font-bold">Delivery Start Time</Label>
          </div>
          <Toggle
            options={[{ id: "instant", label: "Instant" }, { id: "custom", label: "Custom" }]}
            value={value.startMode}
            onChange={(id) => set({ startMode: id as DeliverySettings["startMode"] })}
          />
        </div>
        {value.startMode === "instant" ? (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-primary" /> First order goes to the provider instantly after you place it.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Start delivery after</span>
            <Input
              type="number"
              min={0}
              max={1440}
              className="w-24 h-9"
              value={value.startDelayMinutes}
              onChange={(e) => set({ startDelayMinutes: Math.max(0, Math.min(1440, Number(e.target.value) || 0)) })}
            />
            <span className="text-sm text-muted-foreground">minutes</span>
            {[5, 10, 15, 30].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => set({ startDelayMinutes: m })}
                className={`px-2.5 py-1 text-xs rounded-lg border border-border ${value.startDelayMinutes === m ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}
              >
                {m} min
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
