import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageMeta } from '@/components/seo/PageMeta';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Server, Plus, RefreshCw, Trash2, KeyRound, Download, CheckCircle2, XCircle } from 'lucide-react';
import { SubscriptionGuard } from '@/components/subscription/SubscriptionGuard';

async function invoke(op: string, payload: any = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Please sign in again — your session has expired.');
  const { data, error } = await supabase.functions.invoke('user-provider-manage', {
    body: { op, ...payload },
    headers: { Authorization: `Bearer ${token}`, 'x-region': 'us-east-1' },
  });
  if (error) {
    let detail = error.message;
    try {
      const ctx: any = (error as any).context;
      if (ctx?.json) { const j = await ctx.json(); if (j?.error) detail = j.error; }
      else if (ctx?.text) { const t = await ctx.text(); if (t) detail = t; }
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function MyProviders() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [rotate, setRotate] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({ name: '', api_url: '', api_key: '' });
  const [rotateKey, setRotateKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['user-providers', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_provider_accounts_safe').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['user-providers'] });

  async function handleAdd() {
    if (!form.name || !form.api_url || !form.api_key) return toast.error('All fields required');
    setBusy('add');
    try {
      const r = await invoke('create', form);
      toast[r.ok ? 'success' : 'warning'](r.ok ? 'Provider added & tested OK' : 'Added but connection failed — check key');
      setAddOpen(false); setForm({ name: '', api_url: '', api_key: '' }); refresh();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }

  async function handleTest(id: string) {
    setBusy(id);
    try {
      const r = await invoke('test', { id });
      toast[r.ok ? 'success' : 'error'](r.ok ? `Balance: ${r.test.balance} ${r.test.currency || ''}` : `Test failed: ${r.test?.error}`);
      refresh();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }

  async function handleImport(id: string) {
    setBusy(id + ':imp');
    try {
      const r = await invoke('import_services', { id });
      toast.success(`${r.imported} services imported`);
      qc.invalidateQueries({ queryKey: ['user-services'] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }

  async function handleRotate() {
    if (!rotate || !rotateKey) return;
    setBusy('rotate');
    try {
      const r = await invoke('rotate_key', { id: rotate.id, api_key: rotateKey });
      toast[r.ok ? 'success' : 'error'](r.ok ? 'Key rotated & tested' : `Rotated but failed: ${r.test?.error}`);
      setRotate(null); setRotateKey(''); refresh();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this provider? Its services and bundle items will be affected.')) return;
    const { error } = await supabase.from('user_provider_accounts').delete().eq('id', id);
    if (error) toast.error(error.message); else { toast.success('Deleted'); refresh(); }
  }

  return (
    <DashboardLayout>
      <PageMeta title="My Providers" description="Add and manage your own SMM panel API keys." canonicalPath="/my-providers" noIndex />
      <SubscriptionGuard>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Server className="w-6 h-6 text-primary" /> My Providers</h1>
            <p className="text-sm text-muted-foreground mt-1">Add your own SMM panel. Keys are stored encrypted — no other user can see them.</p>
          </div>
          <Button onClick={() => setAddOpen(true)}><Plus className="w-4 h-4 mr-1" /> Add Provider</Button>
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="grid gap-3">
            {providers.length === 0 && (
              <div className="rounded-2xl border border-dashed p-10 text-center">
                <Server className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="font-medium">No providers yet</p>
                <p className="text-sm text-muted-foreground mt-1">Add your first SMM panel to start placing orders through your own key.</p>
              </div>
            )}
            {providers.map((p: any) => (
              <div key={p.id} className="rounded-xl border bg-card p-4 flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold truncate">{p.name}</p>
                    {p.last_test_ok === true && <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700"><CheckCircle2 className="w-3 h-3" /> Live</span>}
                    {p.last_test_ok === false && <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700"><XCircle className="w-3 h-3" /> Error</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{p.api_url}</p>
                  <p className="text-xs mt-1">Key: <code className="bg-muted px-1 rounded">••••{p.api_key_hint}</code>
                    {p.balance_cached != null && <> · Balance: <b>{p.balance_cached} {p.balance_currency || ''}</b></>}
                  </p>
                  {p.last_test_error && <p className="text-[11px] text-destructive mt-1 truncate">{p.last_test_error}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => handleTest(p.id)}><RefreshCw className={`w-3.5 h-3.5 mr-1 ${busy === p.id ? 'animate-spin' : ''}`} /> Test</Button>
                  
                  <Button size="sm" variant="outline" onClick={() => setRotate({ id: p.id, name: p.name })}><KeyRound className="w-3.5 h-3.5 mr-1" /> Rotate Key</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add SMM Panel</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nickname</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My Main Panel" /></div>
            <div><Label>API URL</Label><Input value={form.api_url} onChange={(e) => setForm({ ...form, api_url: e.target.value })} placeholder="https://panel.example.com/api/v2" /></div>
            <div><Label>API Key</Label><Input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="Your panel API key" /></div>
            <p className="text-[11px] text-muted-foreground">Key is encrypted before being stored. Only you can use it.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={busy === 'add'}>{busy === 'add' ? 'Testing…' : 'Add & Test'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rotate} onOpenChange={(o) => !o && setRotate(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rotate Key — {rotate?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>New API Key</Label>
            <Input type="password" value={rotateKey} onChange={(e) => setRotateKey(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotate(null)}>Cancel</Button>
            <Button onClick={handleRotate} disabled={busy === 'rotate'}>{busy === 'rotate' ? 'Testing…' : 'Rotate'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </SubscriptionGuard>
    </DashboardLayout>
  );
}
