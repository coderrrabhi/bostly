import { Link } from 'react-router-dom';
import { PageMeta } from '@/components/seo/PageMeta';
import logo from '@/assets/logo.png';
import {
  CheckCircle2, Shield, Zap, Users, TrendingUp, Clock, DollarSign, Sparkles,
  Instagram, Youtube, Music2, Facebook, Twitter, ArrowRight, Star, MapPin
} from 'lucide-react';

const C = {
  navy: '#0E1B4D',
  pink: '#1D5CFF',
  cream: '#FFF6EC',
  white: '#FFFFFF',
  ink: '#111827',
  muted: '#6B7280',
};

export default function SmmPanelUsa() {
  return (
    <div className="min-h-screen" style={{ background: C.white, color: C.ink }}>
      <PageMeta
        title="SMM Panel USA — Cheapest & Best US SMM Panel for Instagram, TikTok, YouTube"
        description="Boostly Pro is the #1 SMM panel in the USA delivering real, organic Instagram followers, YouTube subscribers, and TikTok views. AI-powered natural delivery, USD wallet, 24/7 support, 100% account-safe. Free signup."
        canonicalPath="/smm-panel-usa"
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'SMM Panel USA', path: '/smm-panel-usa' },
        ]}
        faqItems={[
          {
            question: 'What is the best SMM panel in the USA?',
            answer: 'Boostly Pro is the best SMM panel for US users — it delivers real, organic engagement using AI-driven natural delivery patterns, accepts USD via crypto and card, and keeps American Instagram, TikTok, and YouTube accounts 100% safe.',
          },
          {
            question: 'Is Boostly Pro the cheapest SMM panel in USA?',
            answer: 'Boostly Pro offers some of the most competitive US SMM panel prices with a multi-provider rotation engine that automatically picks the cheapest working provider for every order — starting at $0.10 per 1,000 views.',
          },
          {
            question: 'Do you accept USD payments from American users?',
            answer: 'Yes. US customers can top up their wallet in USD using crypto (USDT, BTC, ETH via OxaPay) or card. There is no minimum monthly fee.',
          },
          {
            question: 'Is it safe to use an SMM panel in the United States?',
            answer: 'Yes — Boostly Pro uses S-curve delivery, ±50% variance, US peak-hour optimization (6–10 PM local time) and night slowdown, so growth looks 100% organic and never triggers Instagram, TikTok, or YouTube spam filters.',
          },
          {
            question: 'How fast is delivery for US orders?',
            answer: 'Most US orders start within 0–15 minutes. Views typically complete in 1–6 hours, followers in 12–48 hours depending on quantity, with a delivery curve that mirrors real American user activity.',
          },
        ]}
      />

      {/* NAV */}
      <header className="sticky top-0 z-40 backdrop-blur bg-white/80 border-b" style={{ borderColor: 'rgba(14,27,77,0.08)' }}>
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Boostly Pro logo" width={32} height={32} className="rounded-lg" />
            <span className="font-extrabold text-lg" style={{ color: C.navy }}>Boostly Pro</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/auth" className="text-sm font-semibold hidden sm:inline" style={{ color: C.navy }}>Sign in</Link>
            <Link to="/auth" className="px-4 py-2 rounded-full text-sm font-bold text-white"
              style={{ background: C.pink }}>
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden" style={{ background: `linear-gradient(180deg, ${C.cream} 0%, ${C.white} 100%)` }}>
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-14 md:py-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold mb-6"
            style={{ background: 'rgba(29,92,255,0.08)', color: C.pink }}>
            <MapPin className="w-3.5 h-3.5" /> USA · United States
          </div>
          <h1 className="text-4xl md:text-6xl font-black leading-[1.05] tracking-tight" style={{ color: C.navy }}>
            The #1 <span style={{ color: C.pink }}>SMM Panel in the USA</span><br />
            for real, organic social growth
          </h1>
          <p className="mt-6 max-w-2xl text-lg md:text-xl" style={{ color: C.muted }}>
            Boostly Pro delivers <b>real Instagram followers, YouTube subscribers, TikTok views and more</b> to
            American creators, agencies and brands — with AI-powered natural delivery, USD wallets and
            zero-ban guarantee.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/auth" className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-bold text-white shadow-lg"
              style={{ background: C.pink, boxShadow: '0 12px 30px -12px rgba(29,92,255,0.5)' }}>
              Create free US account <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/#pricing" className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-bold border"
              style={{ borderColor: C.navy, color: C.navy }}>
              See US pricing
            </Link>
          </div>

          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl">
            {[
              { k: '50,000+', v: 'US orders delivered' },
              { k: '0', v: 'Account bans' },
              { k: '4.9★', v: 'From 2,400+ users' },
              { k: '24/7', v: 'US-timezone support' },
            ].map((s, i) => (
              <div key={i} className="rounded-2xl p-4 border" style={{ borderColor: 'rgba(14,27,77,0.08)', background: C.white }}>
                <div className="text-2xl font-black" style={{ color: C.navy }}>{s.k}</div>
                <div className="text-xs font-semibold" style={{ color: C.muted }}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PLATFORMS */}
      <section className="py-16 md:py-20">
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          <h2 className="text-3xl md:text-4xl font-black text-center" style={{ color: C.navy }}>
            Every US platform, one panel
          </h2>
          <p className="mt-3 text-center max-w-2xl mx-auto" style={{ color: C.muted }}>
            The most popular services for American creators — priced in USD, delivered from IPs that mimic
            real US user behavior.
          </p>

          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: Instagram, name: 'Instagram USA', desc: 'US followers, likes, story views, reel views — from $0.35/1k likes.' },
              { icon: Youtube, name: 'YouTube USA', desc: 'US subscribers, watch-time hours, monetization-safe views — from $0.80/1k views.' },
              { icon: Music2, name: 'TikTok USA', desc: 'US followers, likes, shares, live views — from $0.10/1k views.' },
              { icon: Facebook, name: 'Facebook USA', desc: 'US page likes, post reactions, followers — from $0.90/1k.' },
              { icon: Twitter, name: 'X / Twitter USA', desc: 'US followers, retweets, impressions — from $1.20/1k.' },
              { icon: Sparkles, name: 'Spotify + more', desc: 'US streams, playlist adds, monthly listeners — real US IPs.' },
            ].map((p, i) => (
              <div key={i} className="rounded-2xl p-6 border transition-all hover:-translate-y-1"
                style={{ borderColor: 'rgba(14,27,77,0.08)', background: C.white, boxShadow: '0 8px 24px -12px rgba(14,27,77,0.08)' }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: 'rgba(29,92,255,0.1)' }}>
                  <p.icon className="w-5 h-5" style={{ color: C.pink }} />
                </div>
                <div className="font-extrabold text-lg" style={{ color: C.navy }}>{p.name}</div>
                <p className="mt-1 text-sm" style={{ color: C.muted }}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY USA */}
      <section className="py-16 md:py-20" style={{ background: C.cream }}>
        <div className="max-w-7xl mx-auto px-4 md:px-6 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold mb-4"
              style={{ background: 'rgba(14,27,77,0.08)', color: C.navy }}>
              Built for American creators
            </div>
            <h2 className="text-3xl md:text-4xl font-black leading-tight" style={{ color: C.navy }}>
              Why US creators pick Boostly Pro over cheap SMM panels
            </h2>
            <p className="mt-4 text-lg" style={{ color: C.muted }}>
              Bot-driven panels get American accounts flagged in days. Boostly Pro engineers every US order
              to look like natural growth from real US users, at real US-timezone hours.
            </p>

            <div className="mt-6 space-y-3">
              {[
                'AI delivery curve tuned to US peak hours (6–10 PM EST/PST)',
                '±50% quantity variance so growth never looks robotic',
                'Multi-provider rotation — cheapest working US provider wins',
                'Live delivery preview before you spend a cent',
                'USD wallet · crypto & card top-ups · no monthly minimums',
                'US-timezone live chat with real humans, not bots',
              ].map((f, i) => (
                <div key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: C.pink }} />
                  <span className="font-medium" style={{ color: C.ink }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: Shield, label: '100% Safe', sub: 'Zero bans across 50k orders' },
              { icon: Zap, label: '0–15 min start', sub: 'Fastest US delivery' },
              { icon: DollarSign, label: 'From $0.10/1k', sub: 'Cheapest US SMM panel' },
              { icon: Clock, label: '24/7 US support', sub: 'Live chat in seconds' },
              { icon: Users, label: 'Real US users', sub: 'North American IPs only' },
              { icon: TrendingUp, label: 'Organic curve', sub: 'AI natural-growth engine' },
            ].map((f, i) => (
              <div key={i} className="rounded-2xl p-5 border bg-white" style={{ borderColor: 'rgba(14,27,77,0.08)' }}>
                <f.icon className="w-6 h-6 mb-3" style={{ color: C.pink }} />
                <div className="font-extrabold" style={{ color: C.navy }}>{f.label}</div>
                <div className="text-xs mt-1" style={{ color: C.muted }}>{f.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-16 md:py-20">
        <div className="max-w-5xl mx-auto px-4 md:px-6">
          <h2 className="text-3xl md:text-4xl font-black text-center" style={{ color: C.navy }}>
            Start growing in 3 minutes
          </h2>
          <div className="mt-10 grid md:grid-cols-3 gap-6">
            {[
              { n: '01', t: 'Create free US account', d: 'Sign up with email — no card required. Verified American users get a $1 welcome credit.' },
              { n: '02', t: 'Top up your USD wallet', d: 'Pay with crypto (USDT/BTC/ETH) or card. Funds appear in seconds and never expire.' },
              { n: '03', t: 'Order & watch growth roll in', d: 'Pick a service, paste your link, and watch the AI deliver a natural-looking US growth curve in real time.' },
            ].map((s, i) => (
              <div key={i} className="rounded-2xl p-6 border bg-white" style={{ borderColor: 'rgba(14,27,77,0.08)' }}>
                <div className="text-4xl font-black" style={{ color: C.pink }}>{s.n}</div>
                <div className="mt-3 font-extrabold text-lg" style={{ color: C.navy }}>{s.t}</div>
                <p className="mt-2 text-sm" style={{ color: C.muted }}>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="py-16 md:py-20" style={{ background: C.navy, color: C.white }}>
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          <h2 className="text-3xl md:text-4xl font-black text-center">
            Trusted by 12,000+ US creators & agencies
          </h2>
          <div className="mt-10 grid md:grid-cols-3 gap-5">
            {[
              { n: 'Marcus T.', c: 'Los Angeles, CA', r: 'Grew my TikTok from 3k to 82k in 90 days. Every follower is a real US account. Nothing else comes close.' },
              { n: 'Priya S.', c: 'Austin, TX', r: 'I run 14 client Instagram accounts. Boostly Pro is the only US SMM panel I trust — zero flags in a year.' },
              { n: 'Devon W.', c: 'Brooklyn, NY', r: 'The multi-provider rotation cut my costs by 60%. And the delivery actually looks organic on analytics.' },
            ].map((t, i) => (
              <div key={i} className="rounded-2xl p-6" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="flex gap-0.5 mb-3">
                  {[...Array(5)].map((_, j) => <Star key={j} className="w-4 h-4 fill-current" style={{ color: C.pink }} />)}
                </div>
                <p className="text-sm leading-relaxed">"{t.r}"</p>
                <div className="mt-4">
                  <div className="font-extrabold">{t.n}</div>
                  <div className="text-xs opacity-70">{t.c}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 md:py-20">
        <div className="max-w-3xl mx-auto px-4 md:px-6">
          <h2 className="text-3xl md:text-4xl font-black text-center" style={{ color: C.navy }}>
            SMM Panel USA — FAQ
          </h2>
          <div className="mt-8 space-y-3">
            {[
              { q: 'What is the best SMM panel in the USA?', a: 'Boostly Pro — it combines real US engagement, AI-driven natural delivery patterns, USD wallets and 24/7 US-timezone support, backed by 4.9★ from 2,400+ American users.' },
              { q: 'Is Boostly Pro the cheapest SMM panel in USA?', a: 'Yes — our multi-provider rotation engine picks the cheapest working US provider for every order. Prices start at $0.10 per 1,000 TikTok views.' },
              { q: 'Do you accept USD from American users?', a: 'Yes. US customers can top up in USD via crypto (USDT, BTC, ETH) or card. No monthly fees, no expiring credits.' },
              { q: 'Is it safe for my American social accounts?', a: 'Absolutely. Every US order uses S-curve delivery with ±50% variance and US peak-hour optimization, so growth looks 100% organic to Instagram, TikTok, YouTube and Meta.' },
              { q: 'How fast is delivery for USA orders?', a: 'Most US orders start within 0–15 minutes. Views usually complete in 1–6 hours; followers in 12–48 hours with a natural growth curve.' },
            ].map((f, i) => (
              <details key={i} className="group rounded-2xl border p-5 bg-white" style={{ borderColor: 'rgba(14,27,77,0.08)' }}>
                <summary className="font-extrabold cursor-pointer flex items-center justify-between" style={{ color: C.navy }}>
                  {f.q}
                  <span className="text-2xl transition-transform group-open:rotate-45" style={{ color: C.pink }}>+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: C.muted }}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 md:py-20" style={{ background: C.cream }}>
        <div className="max-w-4xl mx-auto px-4 md:px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-black" style={{ color: C.navy }}>
            Ready to dominate your US niche?
          </h2>
          <p className="mt-4 text-lg" style={{ color: C.muted }}>
            Join 12,000+ American creators using Boostly Pro to grow real, organic audiences.
          </p>
          <Link to="/auth" className="mt-8 inline-flex items-center gap-2 px-8 py-4 rounded-full font-bold text-white text-lg shadow-xl"
            style={{ background: C.pink, boxShadow: '0 20px 40px -15px rgba(29,92,255,0.5)' }}>
            Create your free US account <ArrowRight className="w-5 h-5" />
          </Link>
          <div className="mt-4 text-xs" style={{ color: C.muted }}>
            No card required · $1 welcome credit · Cancel anytime
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-10 border-t" style={{ borderColor: 'rgba(14,27,77,0.08)' }}>
        <div className="max-w-7xl mx-auto px-4 md:px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Boostly Pro" width={24} height={24} className="rounded" />
            <span className="text-sm font-bold" style={{ color: C.navy }}>Boostly Pro USA</span>
          </div>
          <div className="text-xs" style={{ color: C.muted }}>
            © {new Date().getFullYear()} Boostly Pro — SMM panel for American creators.
            <Link to="/" className="ml-3 underline">Home</Link>
            <Link to="/about" className="ml-3 underline">About</Link>
            <Link to="/contact" className="ml-3 underline">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
