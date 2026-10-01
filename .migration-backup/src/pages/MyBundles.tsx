import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageMeta } from '@/components/seo/PageMeta';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Package, Plus, Trash2, Globe, Eye, Heart, MessageCircle, Bookmark, Share2, Repeat2, UserPlus } from 'lucide-react';
import { SubscriptionGuard } from '@/components/subscription/SubscriptionGuard';

const ENGAGEMENT_TYPES = [
  { key: 'views', label: 'Views', icon: Eye },
  { key: 'likes', label: 'Likes', icon: Heart },
  { key: 'comments', label: 'Comments', icon: MessageCircle },
  { key: 'saves', label: 'Saves', icon: Bookmark },
  { key: 'shares', label: 'Shares', icon: Share2 },
  { key: 'reposts', label: 'Reposts', icon: Repeat2 },
  { key: 'followers', label: 'Followers', icon: UserPlus },
];
const EMPTY_ROWS: any[] = [];

export default function MyBundles() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [platform, setPlatform] = useState('instagram');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const { data: bundles = [], error: bundlesError } = useQuery({
    queryKey: ['user-bundles', user?.id],
    enabled: !!user?.id,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_bundles')
        .select('*, user_bundle_items(*, user_bundle_item_providers(*))')
        .order('created_at', { ascending: false });
      if (error) {
        console.error('[user-bundles] query error:', error);
        throw error;
      }
      return data || [];
    },
  });

  useEffect(() => {
    if (bundlesError) {
      const msg = (bundlesError as any)?.message || 'Failed to load bundles';
      toast.error(msg === 'Failed to fetch' ? 'Network issue loading bundles — please retry' : msg);
    }
  }, [bundlesError]);


  const { data: accountRows } = useQuery({
    queryKey: ['user-provider-accounts-min', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from('user_provider_accounts').select('id, name, is_active').order('name');
      return data || [];
    },
  });
  const accounts = accountRows ?? EMPTY_ROWS;

  const refresh = () => qc.invalidateQueries({ queryKey: ['user-bundles'] });

  async function createBundle() {
    if (!name.trim()) return toast.error('Name required');
    if (!user?.id) return toast.error('Not signed in');
    try {
      const { data, error } = await supabase
        .from('user_bundles')
        .insert({ user_id: user.id, name: name.trim(), description: desc || null, platform })
        .select('id')
        .single();
      if (error) {
        console.error('[createBundle] insert error:', error);
        const msg = error.message?.includes('SUBSCRIPTION_REQUIRED')
          ? 'Active subscription required to create bundles'
          : error.message || 'Failed to create bundle';
        return toast.error(msg);
      }
      toast.success('Bundle created');
      setCreateOpen(false);
      setName('');
      setDesc('');
      await qc.invalidateQueries({ queryKey: ['user-bundles'] });
    } catch (e: any) {
      console.error('[createBundle] threw:', e);
      toast.error(e?.message === 'Failed to fetch' ? 'Network issue — please retry' : (e?.message || 'Failed to create bundle'));
    }
  }
  async function deleteBundle(id: string) {
    if (!confirm('Delete this bundle?')) return;
    try {
      const { error } = await supabase.from('user_bundles').delete().eq('id', id);
      if (error) return toast.error(error.message);
      toast.success('Deleted');
      await qc.invalidateQueries({ queryKey: ['user-bundles'] });
    } catch (e: any) {
      console.error('[deleteBundle]', e);
      toast.error(e?.message === 'Failed to fetch' ? 'Network issue — please retry' : (e?.message || 'Failed'));
    }
  }
  async function addEngagementItem(bundleId: string, engagementType: string) {
    const exists = bundles.find((b: any) => b.id === bundleId)?.user_bundle_items?.some((i: any) => i.engagement_type === engagementType);
    if (exists) return toast.error(`${engagementType} already added`);
    if (!user?.id) return toast.error('Not signed in');
    try {
      const { error } = await supabase.from('user_bundle_items').insert({
        user_id: user.id, user_bundle_id: bundleId, engagement_type: engagementType, quantity: 100,
      });
      if (error) {
        console.error('[addEngagementItem]', error);
        return toast.error(error.message || 'Failed to add');
      }
      await qc.invalidateQueries({ queryKey: ['user-bundles'] });
    } catch (e: any) {
      console.error('[addEngagementItem] threw:', e);
      toast.error(e?.message === 'Failed to fetch' ? 'Network issue — please retry' : (e?.message || 'Failed'));
    }
  }
  async function deleteItem(id: string) {
    try {
      const { error } = await supabase.from('user_bundle_items').delete().eq('id', id);
      if (error) return toast.error(error.message);
      await qc.invalidateQueries({ queryKey: ['user-bundles'] });
    } catch (e: any) {
      console.error('[deleteItem]', e);
      toast.error(e?.message === 'Failed to fetch' ? 'Network issue — please retry' : (e?.message || 'Failed'));
    }
  }
  async function updateQuantity(id: string, quantity: number) {
    try {
      await supabase.from('user_bundle_items').update({ quantity }).eq('id', id);
      await qc.invalidateQueries({ queryKey: ['user-bundles'] });
    } catch (e: any) {
      console.error('[updateQuantity]', e);
    }
  }


  return (
    <DashboardLayout>
      <PageMeta title="My Bundles" description="Create engagement bundles from your own services." canonicalPath="/my-bundles" noIndex />
      <SubscriptionGuard>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="w-6 h-6 text-primary" /> My Bundles</h1>
              <p className="text-sm text-muted-foreground mt-1">Create bundles and map each engagement type to your provider accounts with priority-based rotation.</p>
            </div>
            <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1" /> New Bundle</Button>
          </div>

          <div className="grid gap-4">
            {bundles.length === 0 && (
              <div className="rounded-2xl border border-dashed p-10 text-center">
                <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="font-medium">No bundles yet</p>
              </div>
            )}
            {bundles.map((b: any) => {
              const items: any[] = b.user_bundle_items || [];
              const usedTypes = new Set(items.map((i) => i.engagement_type));
              return (
                <div key={b.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{b.name} <span className="text-xs text-muted-foreground">· {b.platform}</span></p>
                      <p className="text-xs text-muted-foreground">{b.description || 'No description'}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteBundle(b.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>

                  {/* Engagement type chips */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {ENGAGEMENT_TYPES.map(({ key, label, icon: Icon }) => {
                      const active = usedTypes.has(key);
                      return (
                        <button
                          key={key}
                          onClick={() => !active && addEngagementItem(b.id, key)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm border transition ${
                            active ? 'bg-muted text-muted-foreground opacity-60 cursor-default' : 'bg-background hover:bg-primary/5 hover:border-primary/40'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {label}
                          {!active && <Plus className="w-3 h-3" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Items */}
                  <div className="mt-4 space-y-2">
                    {items.map((it: any) => {
                      const meta = ENGAGEMENT_TYPES.find((e) => e.key === it.engagement_type);
                      const Icon = meta?.icon || Eye;
                      const mappedCount = (it.user_bundle_item_providers || []).filter((p: any) => p.enabled).length;
                      const isOpen = expandedItem === it.id;
                      return (
                        <div key={it.id} className="rounded-lg border bg-muted/30">
                          <div className="p-3 flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Icon className="w-4 h-4 text-primary" />
                              </div>
                              <div>
                                <div className="font-medium capitalize text-sm">{it.engagement_type}</div>
                                <div className="text-[11px] text-muted-foreground">{mappedCount} provider{mappedCount !== 1 ? 's' : ''} mapped</div>
                              </div>
                            </div>
                            <Button size="sm" variant="ghost" className="text-destructive h-8 w-8 p-0" onClick={() => deleteItem(it.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                          <div className="border-t bg-background/60 p-3">
                            <ProvidersPanel
                              itemId={it.id}
                              itemLabel={`${b.platform} ${it.engagement_type}`}
                              accounts={accounts as any[]}
                              onChanged={refresh}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {items.length === 0 && <p className="text-xs text-muted-foreground italic">Add engagement types above to get started.</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>New Bundle</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>Description</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
              <div><Label>Platform</Label>
                <select className="w-full h-10 px-3 rounded-md border bg-background" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  {['instagram', 'youtube', 'tiktok', 'facebook', 'twitter', 'telegram', 'other'].map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={createBundle}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </SubscriptionGuard>
    </DashboardLayout>
  );
}

function ProvidersPanel({
  itemId, itemLabel, accounts, onChanged,
}: { itemId: string; itemLabel: string; accounts: any[]; onChanged?: () => void }) {
  const qc = useQueryClient();
  const { data: mappingRows } = useQuery({
    queryKey: ['ubi-providers', itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data } = await supabase.from('user_bundle_item_providers').select('*').eq('user_bundle_item_id', itemId);
      return data || [];
    },
  });
  const mappings = mappingRows ?? EMPTY_ROWS;

  const byAccount: Record<string, any> = {};
  for (const m of mappings) byAccount[m.user_provider_account_id] = m;

  type Draft = { enabled: boolean; provider_service_id: string; priority: number };
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);

  // Sync drafts when mappings load/change
  useEffect(() => {
    const next: Record<string, Draft> = {};
    for (const a of accounts) {
      const m = byAccount[a.id];
      next[a.id] = {
        enabled: !!m?.enabled,
        provider_service_id: m?.provider_service_id || '',
        priority: m?.priority ?? 1,
      };
    }
    setDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappings, accounts]);

  function updateDraft(accountId: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [accountId]: { ...d[accountId], ...patch } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const changed: { accountId: string; draft: Draft; existing: any }[] = [];
      for (const a of accounts) {
        const d = drafts[a.id];
        if (!d) continue;
        const m = byAccount[a.id];
        const same =
          !!m?.enabled === d.enabled &&
          (m?.provider_service_id || '') === d.provider_service_id.trim() &&
          (m?.priority ?? 1) === d.priority;
        if (!same) changed.push({ accountId: a.id, draft: d, existing: m });
      }

      if (changed.length === 0) {
        toast.info('No changes to save');
        return;
      }

      // Validate: enabled providers must have unique priorities within this engagement item
      const enabledPriorities = accounts
        .map((a) => ({ name: a.name, d: drafts[a.id] }))
        .filter((x) => x.d?.enabled);
      const seen = new Map<number, string>();
      for (const ep of enabledPriorities) {
        const p = ep.d!.priority;
        if (seen.has(p)) {
          toast.error(`Priority ${p} is used by both "${seen.get(p)}" and "${ep.name}". Each enabled provider must have a unique priority.`);
          return;
        }
        seen.set(p, ep.name);
      }


      // Validate all non-empty service IDs locally. The mapping belongs to the
      // stable provider account and survives API-key rotation or downtime.
      for (const c of changed) {
        const sid = c.draft.provider_service_id.trim();
        if (!sid) continue;
        if (!/^\d+$/.test(sid)) {
          toast.error(`Service ID must be numeric (${accounts.find(x=>x.id===c.accountId)?.name})`);
          return;
        }
      }

      const { data, error } = await supabase.functions.invoke('user-provider-manage', {
        body: {
          op: 'save_bundle_mappings',
          item_id: itemId,
          mappings: accounts.map((account) => {
            const draft = drafts[account.id];
            const serviceId = draft?.provider_service_id.trim() || '';
            return {
              account_id: account.id,
              enabled: !!draft?.enabled,
              service_id: serviceId || null,
              priority: draft?.priority ?? 1,
            };
          }),
        },
      });
      if (error || !data?.ok) {
        toast.error(error?.message || data?.error || 'Failed to save bundle mappings');
        return;
      }
      toast.success(`Saved ${changed.length} change${changed.length > 1 ? 's' : ''}`);
      await qc.invalidateQueries({ queryKey: ['ubi-providers', itemId] });
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Which provider accounts can fulfill "{itemLabel}"</div>
      <div className="rounded-lg border overflow-hidden bg-card">
        <div className="hidden sm:grid grid-cols-[56px_1.2fr_1.4fr_90px] text-xs font-semibold px-3 sm:px-4 py-2 bg-muted/50 border-b gap-2">
          <div>Use</div>
          <div>Account</div>
          <div>Service ID</div>
          <div className="text-right">Priority</div>
        </div>
        <div className="max-h-96 overflow-y-auto divide-y">
          {accounts.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">No provider accounts. Add one from My Providers first.</div>
          )}
          {accounts.map((a: any) => {
            const d = drafts[a.id] || { enabled: false, provider_service_id: '', priority: 1 };
            return (
              <div
                key={a.id}
                className={`px-3 sm:px-4 py-3 gap-2 sm:gap-3 sm:grid sm:grid-cols-[56px_1.2fr_1.4fr_90px] sm:items-center flex flex-wrap items-center ${d.enabled ? 'bg-primary/5' : ''}`}
              >
                <div className="order-1">
                  <button
                    onClick={() => updateDraft(a.id, { enabled: !d.enabled })}
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${d.enabled ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`}
                    aria-label="toggle use"
                  >
                    {d.enabled && <div className="w-2 h-2 rounded-full bg-white" />}
                  </button>
                </div>
                <div className="min-w-0 flex-1 order-2">
                  <div className="font-medium truncate">
                    {a.name}
                    {!a.is_active && <span className="ml-2 text-[10px] font-medium text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5">API inactive</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate sm:hidden">Account</div>
                </div>
                <div className="order-4 sm:order-3 w-full sm:w-auto">
                  <label className="text-[11px] text-muted-foreground sm:hidden mb-1 block">Service ID</label>
                  <Input
                    placeholder="Service ID"
                    value={d.provider_service_id}
                    onChange={(e) => updateDraft(a.id, { provider_service_id: e.target.value })}
                    className="h-10 bg-background border-2 border-border hover:border-primary/50 focus-visible:border-primary rounded-lg px-3 font-mono text-sm shadow-sm w-full"
                  />
                </div>
                <div className="order-3 sm:order-4 sm:text-right">
                  <label className="text-[11px] text-muted-foreground sm:hidden mb-1 block">Priority</label>
                  <Input
                    type="number"
                    min={1}
                    value={d.priority}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => updateDraft(a.id, { priority: Math.max(1, Number(e.target.value) || 1) })}
                    className="h-9 w-20 sm:ml-auto text-right"
                  />

                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg bg-muted/50 border border-dashed p-3 text-xs text-muted-foreground">
        <b className="text-foreground">Priority Order:</b> Lower number = tried first (1 = highest priority).<br />
        If account #1 has an active order on the same link, system tries #2, then #3, and so on.
      </div>
      {accounts.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="min-w-32">
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      )}
    </div>
  );
}

