import { useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageMeta } from '@/components/seo/PageMeta';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ListChecks, Send } from 'lucide-react';

export default function MyServices() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [order, setOrder] = useState<{ id: string; name: string; rate: number; min: number; max: number } | null>(null);
  const [link, setLink] = useState(''); const [qty, setQty] = useState(100);
  const [busy, setBusy] = useState(false);

  const { data: services = [], isLoading } = useQuery({
    queryKey: ['user-services', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_services').select('*, provider:user_provider_account_id(name)').order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return services;
    return services.filter((x: any) => x.name.toLowerCase().includes(s) || x.category?.toLowerCase().includes(s));
  }, [services, q]);

  async function place() {
    if (!order || !link || !qty) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('user-provider-manage', {
        body: { op: 'place_order', user_service_id: order.id, link, quantity: qty },
        headers: { 'x-region': 'us-east-1' },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(`Order placed! Provider order id: ${data.provider_response?.order}`);
      setOrder(null); setLink(''); setQty(100);
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <DashboardLayout>
      <PageMeta title="My Services" description="Services imported from your own SMM panels." canonicalPath="/my-services" noIndex />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ListChecks className="w-6 h-6 text-primary" /> My Services</h1>
          <p className="text-sm text-muted-foreground mt-1">These services come from your own providers. Orders are placed using your API key.</p>
        </div>
        <Input placeholder="Search services…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />

        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr><th className="text-left p-2">ID</th><th className="text-left p-2">Service</th><th className="text-left p-2">Provider</th><th className="text-right p-2">Rate/1k</th><th className="text-right p-2">Min–Max</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((s: any) => (
                  <tr key={s.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs">{s.provider_service_id}</td>
                    <td className="p-2"><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.category}</div></td>
                    <td className="p-2 text-xs">{s.provider?.name}</td>
                    <td className="p-2 text-right">{s.rate}</td>
                    <td className="p-2 text-right text-xs">{s.min_quantity}–{s.max_quantity}</td>
                    <td className="p-2 text-right"><Button size="sm" variant="outline" onClick={() => setOrder({ id: s.id, name: s.name, rate: s.rate, min: s.min_quantity, max: s.max_quantity })}><Send className="w-3.5 h-3.5 mr-1" /> Order</Button></td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No services yet. Import from your provider on the Providers page.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!order} onOpenChange={(o) => !o && setOrder(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{order?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Link</Label><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" /></div>
            <div><Label>Quantity</Label><Input type="number" value={qty} min={order?.min} max={order?.max} onChange={(e) => setQty(Number(e.target.value))} /></div>
            <p className="text-xs text-muted-foreground">Range: {order?.min}–{order?.max} · Rate: {order?.rate}/1k</p>
            <p className="text-[11px] text-blue-700">The order will be sent using your own panel API key. Nothing is deducted from your wallet.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrder(null)}>Cancel</Button>
            <Button onClick={place} disabled={busy}>{busy ? 'Placing…' : 'Place Order'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
