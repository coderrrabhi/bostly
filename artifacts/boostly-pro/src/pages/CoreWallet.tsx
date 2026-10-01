import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useWallet } from '@/hooks/useWallet';
import { useTransactions, type TransactionFilter } from '@/hooks/useTransactions';
import { useCurrency } from '@/hooks/useCurrency';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, Bitcoin, ExternalLink, IndianRupee,
  Loader2, RefreshCw, ShieldCheck, Wallet as WalletIcon, Zap,
} from 'lucide-react';
import { PageMeta } from '@/components/seo/PageMeta';

const UPI_QUICK = [100, 500, 1000, 2000, 5000];
const CRYPTO_QUICK = [90, 500, 1000, 2000, 5000, 10000];

function DepositCard({ method }: { method: 'upi' | 'crypto' }) {
  const crypto = method === 'crypto';
  const [amount, setAmount] = useState(crypto ? '90' : '500');
  const [loading, setLoading] = useState(false);
  const minimum = crypto ? 90 : 50;
  const maximum = crypto ? 540000 : 100000;
  const accent = crypto ? '#d97706' : '#ea580c';
  const gradient = crypto
    ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)'
    : 'linear-gradient(135deg, #ff8a3d 0%, #ea580c 50%, #c2410c 100%)';
  const quick = crypto ? CRYPTO_QUICK : UPI_QUICK;
  const numericAmount = Number(amount || 0);

  const startDeposit = async () => {
    const parsedAmount = Math.round(numericAmount * 100) / 100;
    if (!Number.isFinite(parsedAmount) || parsedAmount < minimum) {
      toast.error(`Minimum ₹${minimum.toLocaleString('en-IN')}`);
      return;
    }
    if (parsedAmount > maximum) {
      toast.error(`Maximum ₹${maximum.toLocaleString('en-IN')} per transaction`);
      return;
    }

    setLoading(true);
    try {
      await api.fetchApi('/wallet/deposits', {
        method: 'POST',
        body: JSON.stringify({ amount_inr: parsedAmount, method }),
      });
      toast.error('The payment provider did not return a payment URL.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-3xl p-7" style={{
      background: 'white', border: '1px solid #eef1f6',
      boxShadow: '0 4px 24px -8px rgba(15,23,42,.08), 0 1px 2px rgba(15,23,42,.04)',
      fontFamily: 'Manrope, system-ui, sans-serif',
    }}>
      <div aria-hidden className="absolute -top-16 -right-16 w-56 h-56 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(closest-side, ${crypto ? 'rgba(245,158,11,.10)' : 'rgba(234,88,12,.10)'}, transparent 70%)` }} />
      <div className="relative flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm"
            style={{ background: crypto ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #ff8a3d, #ea580c)', boxShadow: `0 6px 16px -6px ${crypto ? 'rgba(217,119,6,.5)' : 'rgba(234,88,12,.5)'}` }}>
            {crypto ? <Bitcoin className="h-5 w-5 text-white" strokeWidth={2.5} /> : <Zap className="h-5 w-5 text-white" strokeWidth={2.5} />}
          </div>
          <div>
            <h2 className="text-[17px] font-bold tracking-tight" style={{ color: '#0f172a', fontFamily: 'Sora, system-ui, sans-serif' }}>
              {crypto ? 'Crypto Add Funds' : 'Add Funds'}
            </h2>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] mt-0.5" style={{ color: accent }}>
              {crypto ? 'OxaPay · USDT · BTC · TRX · LTC · ETH' : 'Instant UPI · Auto-credit'}
            </p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold"
          style={{ background: 'rgba(59,130,246,.08)', color: '#2563eb', border: '1px solid rgba(59,130,246,.18)' }}>
          <ShieldCheck className="h-3 w-3" /> {crypto ? 'AUTO-CREDIT' : 'SECURE'}
        </div>
      </div>
      <p className="text-[13px] leading-relaxed mb-6" style={{ color: '#64748b' }}>
        {crypto
          ? 'Enter INR amount. The payment page will open with the matching crypto amount automatically.'
          : 'Pay via UPI · GPay · PhonePe · Paytm — your wallet is credited instantly after payment.'}
      </p>
      <Label htmlFor={`${method}-amount`} className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#64748b' }}>
        {crypto ? 'Amount (INR)' : 'Enter Amount'}
      </Label>
      <div className="relative mt-2">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-lg font-bold"
          style={{ background: `${crypto ? 'rgba(217,119,6,.08)' : 'rgba(234,88,12,.08)'}`, color: accent }}>
          {crypto ? '₹' : <IndianRupee className="h-3.5 w-3.5" strokeWidth={2.5} />}
        </div>
        <Input id={`${method}-amount`} type="number" inputMode="decimal" min={minimum} max={maximum} step={crypto ? '1' : undefined}
          value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="500"
          className="pl-14 pr-4 h-14 text-2xl font-bold border-2 rounded-xl"
          style={{ color: '#0f172a', borderColor: '#e2e8f0', background: '#f8fafc', fontFamily: 'Sora, system-ui, sans-serif' }} />
      </div>
      {crypto && <p className="text-[11px] mt-1.5" style={{ color: '#94a3b8' }}>
        ₹{Number.isFinite(numericAmount) ? numericAmount.toLocaleString('en-IN') : '0'} will be credited after confirmation · Min ₹90
      </p>}
      <div className={`grid ${crypto ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-5'} gap-2 mt-3`}>
        {quick.map((value) => {
          const active = amount === String(value);
          return <button key={value} type="button" onClick={() => setAmount(String(value))}
            className="py-2.5 rounded-xl text-[12px] font-bold transition-all active:scale-95"
            style={{ background: active ? (crypto ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #ff8a3d, #ea580c)') : 'white', color: active ? 'white' : '#475569', border: active ? '1px solid transparent' : '1.5px solid #e2e8f0', boxShadow: active ? `0 4px 12px -4px ${crypto ? 'rgba(217,119,6,.45)' : 'rgba(234,88,12,.45)'}` : 'none' }}>
            ₹{value >= 1000 ? `${value / 1000}k` : value}
          </button>;
        })}
      </div>
      <button onClick={startDeposit} disabled={loading || !amount}
        className="w-full mt-6 h-14 rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 transition-all active:scale-[.98] disabled:opacity-60 disabled:cursor-not-allowed"
        style={{ background: gradient, color: 'white', boxShadow: `0 10px 24px -8px ${crypto ? 'rgba(217,119,6,.55)' : 'rgba(234,88,12,.55)'}`, fontFamily: 'Sora, system-ui, sans-serif', letterSpacing: '-0.01em' }}>
        {loading ? <><Loader2 className="h-5 w-5 animate-spin" /> {crypto ? 'Opening payment page…' : 'Redirecting to UPI…'}</>
          : <>{crypto ? <Bitcoin className="h-5 w-5" /> : <Zap className="h-5 w-5" fill="white" strokeWidth={2.5} />} Pay ₹{Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount.toLocaleString('en-IN') : ''} Now {!crypto && <ArrowRight className="h-5 w-5" strokeWidth={2.5} />}</>}
      </button>
      {!crypto && <div className="flex items-center justify-center gap-1.5 mt-4">
        <ShieldCheck className="h-3 w-3" style={{ color: '#94a3b8' }} />
        <p className="text-[11px]" style={{ color: '#94a3b8' }}>Auto-verified by server · No refresh needed</p>
      </div>}
    </div>
  );
}

export default function CoreWallet() {
  const { wallet } = useWallet();
  const { formatPrice } = useCurrency();
  const [filter, setFilter] = useState<TransactionFilter>('all');
  const { data: transactions } = useTransactions(filter);
  const [depositMethod, setDepositMethod] = useState<'upi' | 'crypto'>('upi');
  const getIcon = (type: string) => type === 'deposit' ? <ArrowDownLeft className="h-4 w-4" style={{ color: '#3b82f6' }} /> : type === 'order' ? <ArrowUpRight className="h-4 w-4" style={{ color: '#ef4444' }} /> : type === 'refund' ? <RefreshCw className="h-4 w-4" style={{ color: '#2563eb' }} /> : <WalletIcon className="h-4 w-4" style={{ color: '#999' }} />;
  const getIconBg = (type: string) => type === 'deposit' ? 'rgba(59,130,246,.1)' : type === 'order' ? 'rgba(239,68,68,.1)' : type === 'refund' ? 'rgba(22, 163, 74,.1)' : 'rgba(0,0,0,.04)';
  const getAmountColor = (type: string) => type === 'deposit' ? '#3b82f6' : type === 'order' ? '#ef4444' : '#2563eb';
  const fmtDate = (date: string) => new Date(date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return <DashboardLayout>
    <PageMeta title="Wallet & Top-up" description="Add funds via UPI or crypto and review your Boostly Pro wallet balance and transaction history." canonicalPath="/wallet" noIndex />
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold" style={{ color: '#111827' }}>Wallet</h1><p className="text-[13px] mt-1" style={{ color: '#999' }}>Manage your balance and transactions.</p></div>
      <div className="relative overflow-hidden rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 55%, #3b82f6 100%)', boxShadow: '0 10px 28px -12px rgba(37,99,235,.55), inset 0 1px 0 rgba(255,255,255,.18)', fontFamily: "'Manrope', system-ui, sans-serif" }}>
        <div aria-hidden className="absolute -top-16 -right-12 w-48 h-48 rounded-full pointer-events-none" style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,.22), transparent 70%)' }} /><div aria-hidden className="absolute -bottom-20 -left-10 w-40 h-40 rounded-full pointer-events-none" style={{ background: 'radial-gradient(closest-side, rgba(59,130,246,.45), transparent 70%)' }} />
        <div className="relative z-10 flex items-center justify-between"><div className="flex items-center gap-2"><span className="inline-flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: 'rgba(255,255,255,.18)', backdropFilter: 'blur(4px)' }}><WalletIcon className="h-3.5 w-3.5 text-white" /></span><p className="text-[10px] font-semibold uppercase text-white/80" style={{ letterSpacing: '0.16em' }}>Available Balance</p></div><div className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: 'rgba(255,255,255,.18)', letterSpacing: '0.05em' }}>INR</div></div>
        <p className="relative z-10 mt-2 text-3xl md:text-4xl text-white" style={{ fontFamily: "'Sora', system-ui, sans-serif", fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05 }}>{formatPrice(Number(wallet?.balance ?? 0))}</p>
        <div className="relative z-10 mt-3 pt-3 grid grid-cols-2 gap-3" style={{ borderTop: '1px solid rgba(255,255,255,.18)' }}>
          {[['Total In', ArrowDownLeft, wallet?.totalDeposited], ['Total Out', ArrowUpRight, wallet?.totalSpent]].map(([label, Icon, amount]) => <div key={String(label)} className="flex items-center gap-2"><span className="inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0" style={{ background: 'rgba(255,255,255,.18)' }}><Icon className="h-3.5 w-3.5 text-white" /></span><div className="min-w-0"><p className="text-[9px] font-semibold uppercase text-white/70" style={{ letterSpacing: '0.14em' }}>{label}</p><p className="text-[13px] text-white truncate" style={{ fontFamily: "'Sora', system-ui, sans-serif", fontWeight: 600 }}>{formatPrice(Number(amount ?? 0))}</p></div></div>)}
        </div>
      </div>
      <div><div className="flex gap-2 mb-3">{(['upi', 'crypto'] as const).map((method) => <button key={method} onClick={() => setDepositMethod(method)} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold transition-all" style={{ background: depositMethod === method ? (method === 'upi' ? 'linear-gradient(135deg, #ff8a3d, #ea580c)' : 'linear-gradient(135deg, #f59e0b, #d97706)') : 'white', color: depositMethod === method ? 'white' : '#475569', border: depositMethod === method ? '1px solid transparent' : '1.5px solid #e2e8f0', boxShadow: depositMethod === method ? (method === 'upi' ? '0 4px 12px -4px rgba(234,88,12,.4)' : '0 4px 12px -4px rgba(217,119,6,.4)') : 'none' }}>{method === 'upi' ? '💳 UPI (INR)' : '🪙 Crypto'}</button>)}</div><DepositCard method={depositMethod} /></div>
      <div className="rounded-2xl p-6" style={{ background: 'white', border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.04)' }}>
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3"><h2 className="text-lg font-bold" style={{ color: '#111827' }}>Transaction History</h2><div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(0,0,0,.03)' }}>{(['all', 'deposit', 'order', 'refund'] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all" style={{ background: filter === value ? '#2563eb' : 'transparent', color: filter === value ? 'white' : '#888' }}>{value === 'all' ? 'All' : value === 'deposit' ? 'Deposits' : value === 'order' ? 'Orders' : 'Refunds'}</button>)}</div></div>
        {transactions?.length ? <div className="space-y-2">{transactions.map((tx: any) => <div key={tx.id} className="flex items-center justify-between p-4 rounded-xl transition-colors" style={{ background: 'rgba(0,0,0,.015)', border: '1px solid rgba(0,0,0,.04)' }}><div className="flex items-center gap-3 min-w-0"><div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: getIconBg(tx.type) }}>{getIcon(tx.type)}</div><div className="min-w-0"><p className="font-medium text-[13px] leading-tight truncate max-w-[260px]" style={{ color: '#111827' }}>{tx.description || tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</p><div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1">{tx.paymentMethod && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,.04)', color: '#888' }}>{tx.paymentMethod.replace(/_/g, ' ').toUpperCase()}</span>}<span className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ background: tx.status === 'pending' ? 'rgba(245,158,11,.1)' : tx.status === 'completed' ? 'rgba(59,130,246,.1)' : 'rgba(239,68,68,.1)', color: tx.status === 'pending' ? '#f59e0b' : tx.status === 'completed' ? '#3b82f6' : '#ef4444' }}>{tx.status}</span><span className="text-[11px]" style={{ color: '#bbb' }}>{fmtDate(tx.createdAt)}</span>{tx.paymentReference && tx.paymentMethod === 'usdt_bep20' && <a href={`https://bscscan.com/tx/${tx.paymentReference}`} target="_blank" rel="noopener noreferrer" className="text-[11px] flex items-center gap-0.5 hover:underline" style={{ color: '#2563eb' }}>BSCScan <ExternalLink className="h-3 w-3" /></a>}</div></div></div><div className="text-right flex-shrink-0 ml-4"><p className="font-bold text-[15px]" style={{ color: getAmountColor(tx.type) }}>{tx.type === 'order' ? '−' : '+'}{formatPrice(Math.abs(Number(tx.amount)))}</p>{tx.balanceAfter != null && <p className="text-[11px] mt-0.5" style={{ color: '#bbb' }}>Bal: {formatPrice(Number(tx.balanceAfter))}</p>}</div></div>)}</div> : <div className="text-center py-12"><div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(22, 163, 74,.08)' }}><WalletIcon className="h-6 w-6" style={{ color: '#2563eb' }} /></div><p className="font-medium text-[14px]" style={{ color: '#666' }}>No transactions yet</p><p className="text-[12px] mt-1" style={{ color: '#bbb' }}>Your deposits and spending history will appear here.</p></div>}
      </div>
    </div>
  </DashboardLayout>;
}