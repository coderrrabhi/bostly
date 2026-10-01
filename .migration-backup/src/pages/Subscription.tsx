import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageMeta } from '@/components/seo/PageMeta';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Crown, Zap, Sparkles, Check, Loader2, CreditCard, MessageSquare, Info } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

type Plan = {
  plan_type: string;
  price_usd: number;
  price_inr: number;
  duration_days: number | null;
  label: string;
  sort_order: number;
};

const ICONS: Record<string, any> = {
  monthly: Zap,
  yearly: Sparkles,
  lifetime: Crown,
};

const HIGHLIGHT: Record<string, string> = {
  yearly: 'ring-2 ring-primary shadow-lg',
};

const FEATURES: Record<string, string[]> = {
  monthly: [
    'Add unlimited own providers',
    'Create unlimited bundles',
    'Full engagement + mass order',
    'AI Intelligence chat',
    '30 days access',
  ],
  yearly: [
    'Everything in Monthly',
    'Save $269 vs monthly',
    'Priority support',
    '365 days access',
    'Best value ⭐',
  ],
  lifetime: [
    'Everything in Yearly',
    'One-time payment — never renews',
    'All future features included',
    'Lifetime access',
    'Priority VIP support',
  ],
};

export default function Subscription() {
  const { user } = useAuth();
  const { subscription, hasActiveSubscription: isActive } = useSubscription();
  const [payingPlan, setPayingPlan] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState<string | null>(null);
  const [reqForm, setReqForm] = useState({ full_name: '', phone: '', message: '' });
  const [submitting, setSubmitting] = useState(false);

  const { data: plans = [] } = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return ((data || []) as Plan[]).map((plan) => {
        if (plan.plan_type === 'yearly') {
          return { ...plan, price_usd: 199, price_inr: 17910 };
        }
        if (plan.plan_type === 'lifetime') {
          return { ...plan, price_usd: 399, price_inr: 35910 };
        }
        return plan;
      });
    },
  });

  async function payWith(provider: 'oxapay' | 'zapupi', plan: Plan) {
    if (!user) return toast.error('Please login first');
    setPayingPlan(plan.plan_type + ':' + provider);
    try {
      const { data, error } = await supabase.functions.invoke('subscription-checkout', {
        body: {
          plan_type: plan.plan_type,
          provider,
          return_origin: window.location.origin,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (data?.payment_url) {
        window.location.href = data.payment_url;
      } else {
        throw new Error('No payment URL returned');
      }
    } catch (e: any) {
      toast.error(e.message || 'Payment init failed');
    } finally {
      setPayingPlan(null);
    }
  }

  async function submitRequest(planType: string) {
    if (!user) return;
    if (!reqForm.full_name.trim() || !reqForm.phone.trim()) {
      return toast.error('Name and phone required');
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('subscription_requests').insert({
        user_id: user.id,
        full_name: reqForm.full_name.trim(),
        email: user.email || '',
        phone: reqForm.phone.trim(),
        plan_type: planType,
        message: reqForm.message.trim() || null,
        status: 'pending',
      });
      if (error) throw error;
      toast.success('Request submitted! Admin will contact you soon.');
      setRequestOpen(null);
      setReqForm({ full_name: '', phone: '', message: '' });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashboardLayout>
      <PageMeta title="Subscription — Boostly Pro" description="Choose your plan to unlock providers and bundles." canonicalPath="/subscription" noIndex />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold">Unlock Boostly Pro</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            You need an active subscription to add providers or create bundles. Choose your plan below.
          </p>
        </div>

        {/* Current status */}
        {subscription && (
          <Card className={isActive ? 'border-primary/40 bg-primary/5' : 'border-warning/40 bg-warning/5'}>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isActive ? 'bg-primary/15 text-primary' : 'bg-warning/15 text-warning'}`}>
                  {isActive ? <Check className="w-5 h-5" /> : <Info className="w-5 h-5" />}
                </div>
                <div>
                  <p className="font-semibold">
                    {isActive ? `Active — ${subscription.plan_type.toUpperCase()}` : 'No active subscription'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {subscription.expires_at
                      ? `Expires ${format(new Date(subscription.expires_at), 'PP')}`
                      : subscription.plan_type === 'lifetime'
                        ? 'Lifetime access — never expires'
                        : 'Choose a plan below to activate'}
                  </p>
                </div>
              </div>
              {isActive && <Badge className="bg-primary text-primary-foreground">ACTIVE</Badge>}
            </CardContent>
          </Card>
        )}

        {/* Plan Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const Icon = ICONS[plan.plan_type] || Zap;
            const isCurrent = subscription?.plan_type === plan.plan_type && isActive;
            return (
              <Card key={plan.plan_type} className={`relative ${HIGHLIGHT[plan.plan_type] || ''}`}>
                {plan.plan_type === 'yearly' && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground px-3 py-1">MOST POPULAR</Badge>
                  </div>
                )}
                <CardHeader className="text-center pb-2">
                  <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                    <Icon className="w-7 h-7 text-primary" />
                  </div>
                  <CardTitle className="text-xl">{plan.label}</CardTitle>
                  <div className="pt-2">
                    <span className="text-4xl font-bold">${plan.price_usd}</span>
                    {plan.duration_days && (
                      <span className="text-muted-foreground text-sm">
                        {plan.duration_days === 30 ? '/month' : plan.duration_days === 365 ? '/year' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">≈ ₹{plan.price_inr}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2">
                    {(FEATURES[plan.plan_type] || []).map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <Button disabled className="w-full">Current Plan</Button>
                  ) : (
                    <div className="space-y-2">
                      <Button
                        className="w-full whitespace-normal h-auto min-h-10 py-2 px-3 text-xs sm:text-sm"
                        onClick={() => payWith('oxapay', plan)}
                        disabled={payingPlan !== null}
                      >
                        {payingPlan === plan.plan_type + ':oxapay' ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2 shrink-0" />
                        ) : (
                          <CreditCard className="w-4 h-4 mr-2 shrink-0" />
                        )}
                        <span className="truncate">Pay with Crypto (OxaPay)</span>
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full whitespace-normal h-auto min-h-10 py-2 px-3 text-xs sm:text-sm"
                        onClick={() => payWith('zapupi', plan)}
                        disabled={payingPlan !== null}
                      >
                        {payingPlan === plan.plan_type + ':zapupi' ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2 shrink-0" />
                        ) : (
                          <CreditCard className="w-4 h-4 mr-2 shrink-0" />
                        )}
                        <span className="truncate">Pay with UPI (ZapUPI)</span>
                      </Button>
                      <a
                        href="https://t.me/Organicsmmcashier"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full inline-flex items-center justify-center text-xs text-muted-foreground hover:text-primary transition-colors py-2"
                      >
                        <MessageSquare className="w-3 h-3 mr-1" />
                        Or request manual activation
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground max-w-xl mx-auto">
          Your subscription auto-activates immediately after a successful payment. If you run into any issue,
          contact admin — manual activation is also possible.
        </p>
      </div>

      {/* Manual request dialog */}
      <Dialog open={!!requestOpen} onOpenChange={(o) => !o && setRequestOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Manual Activation</DialogTitle>
            <DialogDescription>
              Send a contact request to admin — they will collect your payment details and activate manually.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Full name</Label>
              <Input value={reqForm.full_name} onChange={(e) => setReqForm({ ...reqForm, full_name: e.target.value })} />
            </div>
            <div>
              <Label>Phone / WhatsApp</Label>
              <Input value={reqForm.phone} onChange={(e) => setReqForm({ ...reqForm, phone: e.target.value })} />
            </div>
            <div>
              <Label>Message (optional)</Label>
              <Textarea rows={3} value={reqForm.message} onChange={(e) => setReqForm({ ...reqForm, message: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">Plan: <b className="uppercase">{requestOpen}</b></p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestOpen(null)}>Cancel</Button>
            <Button onClick={() => requestOpen && submitRequest(requestOpen)} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
