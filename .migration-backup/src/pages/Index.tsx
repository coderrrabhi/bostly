import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, TrendingUp, Shuffle, Clock, Moon, Timer, Eye,
  Link2, Sparkles, Brain, CheckCircle2, XCircle, FileText, Menu, X, Zap,
} from 'lucide-react';
import logo from '@/assets/logo.png';
import { PageMeta } from '@/components/seo/PageMeta';

/* ═════════════════════════════════════════════════════
   BOOSTLY PRO — EDITORIAL SERIF LANDING
   Palette: soft blue paper + deep ink + electric blue accent
   Fonts:   Fraunces (display) + Inter (body)
   ═════════════════════════════════════════════════════ */

const C = {
  bg1:    '#EAF1FF',
  bg2:    '#F4F7FF',
  ink:    '#0B1220',
  navy:   '#0E1B4D',
  mute:   '#4B5670',
  soft:   '#8892AB',
  blue:   '#1D5CFF',
  blueSoft:'#E4ECFF',
  card:   '#FFFFFF',
  line:   'rgba(14,27,77,0.08)',
};

const Index = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div
      className="min-h-screen w-full overflow-x-hidden"
      style={{
        background: `linear-gradient(180deg, ${C.bg1} 0%, ${C.bg2} 100%)`,
        color: C.ink,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <PageMeta
        title="Boostly Pro — Best SMM Panel for Organic Social Growth"
        description="AI-powered engagement for Instagram, YouTube & TikTok. Real engagement, natural delivery, safe accounts. Start free in 60 seconds."
        canonicalPath="/"
        breadcrumbs={[{ name: 'Home', path: '/' }]}
      />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700;800&display=swap');
        .bp-serif { font-family:'Fraunces', 'Times New Roman', serif; font-weight:600; letter-spacing:-0.02em; line-height:1.02; }
        @keyframes bp-pulse { 0%,100%{opacity:.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.15)} }
        .bp-dot { animation: bp-pulse 2.2s ease-in-out infinite; }
      `}</style>

      {/* ═══════ NAV ═══════ */}
      <style>{`
        @keyframes bp-live { 0%,100%{box-shadow:0 0 0 0 rgba(29,92,255,.55)} 50%{box-shadow:0 0 0 6px rgba(29,92,255,0)} }
        .bp-live-dot { animation: bp-live 1.6s ease-out infinite; }
        .bp-nav-link { position:relative; }
        .bp-nav-link::after { content:''; position:absolute; left:12px; right:12px; bottom:-6px; height:2px; background:${C.blue}; border-radius:2px; transform:scaleX(0); transform-origin:left; transition:transform .35s cubic-bezier(.6,.2,.1,1); }
        .bp-nav-link:hover::after { transform:scaleX(1); }
        .bp-cta { position:relative; overflow:hidden; }
        .bp-cta::before { content:''; position:absolute; inset:0; background:linear-gradient(120deg, transparent 30%, rgba(255,255,255,.35) 50%, transparent 70%); transform:translateX(-120%); transition:transform .8s ease; }
        .bp-cta:hover::before { transform:translateX(120%); }
      `}</style>

      <nav className="sticky top-3 sm:top-4 z-50 px-3 sm:px-4">
        <div
          className="max-w-6xl mx-auto flex items-center justify-between gap-2 h-[62px] pl-2 pr-2 sm:pl-3 sm:pr-2 transition-all duration-300"
          style={{
            background: scrolled ? 'rgba(255,255,255,0.82)' : C.card,
            backdropFilter: 'saturate(160%) blur(14px)',
            WebkitBackdropFilter: 'saturate(160%) blur(14px)',
            borderRadius: 999,
            border: `1px solid ${scrolled ? 'rgba(14,27,77,.09)' : 'rgba(14,27,77,.05)'}`,
            boxShadow: scrolled
              ? '0 14px 40px -18px rgba(14,27,77,0.28), 0 2px 6px rgba(14,27,77,0.05)'
              : '0 8px 28px -14px rgba(14,27,77,0.18), 0 2px 6px rgba(14,27,77,0.04)',
          }}
        >
          {/* LOGO PILL */}
          <Link to="/" className="flex items-center gap-2.5 pl-1.5 pr-2 py-1.5 rounded-full transition"
            style={{ background: 'transparent' }}>
            <span className="relative inline-flex items-center justify-center w-10 h-10">
              <img src={logo} alt="Boostly Pro" width={40} height={40}
                className="w-10 h-10 rounded-2xl object-cover"
                style={{ boxShadow:'0 10px 22px -10px rgba(29,92,255,.55)' }}/>
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 bp-live-dot" style={{ border:'2px solid #fff' }}/>
            </span>
            <span className="hidden xs:inline text-[18px] sm:text-[19px] font-extrabold tracking-tight" style={{ color: C.navy }}>
              Boostly<span style={{ color: C.blue }}>.</span>Pro
            </span>
            <span className="hidden sm:inline ml-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: C.blueSoft, color: C.blue, letterSpacing:'.06em' }}>
              {"v2.0"}
            </span>
          </Link>

          {/* CENTER LINKS */}
          <div className="hidden md:flex items-center gap-1 text-[13.5px] font-semibold px-2 py-1.5 rounded-full"
            style={{ background: C.bg2, border:`1px solid ${C.line}`, color: C.navy }}>
            {[
              { href:'#features', label:'Features' },
              { href:'#how',      label:'How it works' },
              { href:'#setup',    label:'Setup' },
              { href:'#guide',    label:'Guide' },
              { href:'#pricing',  label:'Pricing' },
              { href:'#why',      label:'Why us' },
            ].map(l => (
              <a key={l.href} href={l.href} className="bp-nav-link px-3 py-1.5 rounded-full hover:text-[color:var(--tw)] transition"
                onMouseEnter={e=>{ (e.currentTarget as HTMLElement).style.color = C.blue; }}
                onMouseLeave={e=>{ (e.currentTarget as HTMLElement).style.color = C.navy; }}>
                {l.label}
              </a>
            ))}
          </div>

          {/* RIGHT CTA */}
          <div className="flex items-center gap-1.5">
            <Link to="/auth" className="hidden sm:inline-flex items-center text-[13.5px] font-semibold px-3.5 py-2 rounded-full hover:bg-[color:var(--h)]"
              style={{ color: C.navy }}
              onMouseEnter={e=>{ (e.currentTarget as HTMLElement).style.background = C.bg2; }}
              onMouseLeave={e=>{ (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              Login
            </Link>
            <Link to="/auth"
              className="bp-cta group inline-flex items-center gap-1.5 text-[13.5px] font-bold text-white pl-4 pr-1.5 py-1.5 rounded-full"
              style={{ background: C.ink, boxShadow: '0 12px 26px -12px rgba(11,18,32,0.65)' }}>
              <span>Sign Up Free</span>
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full transition-transform group-hover:translate-x-0.5"
                style={{ background: C.blue }}>
                <ArrowRight className="w-4 h-4" strokeWidth={2.6}/>
              </span>
            </Link>

            {/* MOBILE TOGGLE */}
            <button
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-full ml-0.5"
              style={{ background: C.bg2, color: C.navy, border:`1px solid ${C.line}` }}
              onClick={() => setMenuOpen(v => !v)}
              aria-label="Toggle menu"
            >
              {menuOpen ? <X className="w-5 h-5"/> : <Menu className="w-5 h-5"/>}
            </button>
          </div>
        </div>

        {/* MOBILE DROPDOWN */}
        {menuOpen && (
          <div className="md:hidden max-w-6xl mx-auto mt-2 rounded-3xl p-3"
            style={{ background: C.card, border:`1px solid ${C.line}`, boxShadow:'0 20px 40px -20px rgba(14,27,77,.25)' }}>
            <div className="flex flex-col text-[15px] font-semibold" style={{ color: C.navy }}>
              {[
                { href:'#features', label:'Features' },
                { href:'#how',      label:'How it works' },
                { href:'#setup',    label:'Provider setup' },
                { href:'#guide',    label:'How to use' },
                { href:'#pricing',  label:'Pricing' },
                { href:'#why',      label:'Why us' },
              ].map(l => (
                <a key={l.href} href={l.href} onClick={()=>setMenuOpen(false)}
                  className="px-4 py-3 rounded-2xl hover:opacity-80"
                  style={{ borderBottom:`1px solid ${C.line}` }}>
                  {l.label}
                </a>
              ))}
              <Link to="/auth" onClick={()=>setMenuOpen(false)}
                className="mt-2 flex items-center justify-center gap-2 text-white font-bold py-3 rounded-2xl"
                style={{ background: C.blue }}>
                Sign Up Free <ArrowRight className="w-4 h-4"/>
              </Link>
            </div>
          </div>
        )}
      </nav>


      {/* ═══════ HERO ═══════ */}
      <section className="px-4 pt-16 sm:pt-24 pb-10 sm:pb-16 text-center max-w-5xl mx-auto">
        <h1 className="bp-serif text-[54px] sm:text-[86px] md:text-[112px]" style={{ color: C.ink }}>
          Boostly Pro
        </h1>
        <h2 className="bp-serif mt-6 text-[28px] sm:text-[44px] md:text-[54px]" style={{ color: C.ink }}>
          Best SMM Panel for<br />Organic Social Growth
        </h2>
        <p className="mt-6 text-[15px] sm:text-[18px]" style={{ color: C.mute }}>
          AI-powered for Instagram, YouTube &amp; TikTok · Real engagement &amp; natural delivery · Safe accounts.
        </p>

        <div className="mt-6 flex items-center justify-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-pink-400 bp-dot" />
          <span className="w-2.5 h-2.5 rounded-full bp-dot" style={{ background: C.blue, animationDelay: '.3s' }} />
          <span className="w-2.5 h-2.5 rounded-full bg-black bp-dot" style={{ animationDelay: '.6s' }} />
        </div>

        <div className="mt-8 flex justify-center">
          <Link to="/auth"
            className="inline-flex items-center gap-2 text-white font-bold text-[16px] px-8 py-4 rounded-full"
            style={{ background: C.blue, boxShadow: '0 18px 40px -14px rgba(29,92,255,0.55)' }}>
            Sign Up Free <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[13px] sm:text-[14px]"
          style={{ color: C.mute }}>
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" style={{color:C.blue}}/> No card needed</span>
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" style={{color:C.blue}}/> Every tool unlocked</span>
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" style={{color:C.blue}}/> Ready in 60 seconds</span>
        </div>
      </section>

      {/* ═══════ FEATURES ═══════ */}
      <section id="features" className="px-4 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-center mb-6">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] uppercase px-4 py-1.5 rounded-full"
              style={{ background: C.card, color: C.blue, boxShadow:`0 4px 14px -8px rgba(29,92,255,.4)` }}>
              <Sparkles className="w-3.5 h-3.5"/> Built for organic growth
            </span>
          </div>
          <h3 className="bp-serif text-center text-[34px] sm:text-[52px]" style={{ color: C.ink }}>
            Tuned to move like real people do.
          </h3>

          <div className="mt-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { icon: TrendingUp, t:'S-Curve Rollout',  d:'Momentum like a real trend' },
              { icon: Shuffle,    t:'±50% Variance',    d:'Batch sizes shift every drop' },
              { icon: Clock,      t:'Peak-Hour Push',   d:'1.5× lift during 6–10 PM' },
              { icon: Moon,       t:'Overnight Ease-Off', d:'Mimics real sleep cycles' },
              { icon: Timer,      t:'±5min Jitter',     d:'Timing no bot can fake' },
              { icon: Eye,        t:'Live Preview',     d:'See the plan before you pay' },
            ].map((f,i)=>(
              <div key={i} className="rounded-2xl p-5"
                style={{ background: C.card, border:`1px solid ${C.line}`, boxShadow:'0 8px 24px -18px rgba(14,27,77,.25)' }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: C.blueSoft }}>
                  <f.icon className="w-5 h-5" style={{ color: C.blue }} strokeWidth={2.2}/>
                </div>
                <div className="bp-serif text-[19px]" style={{ color: C.ink }}>{f.t}</div>
                <p className="mt-1 text-[13px]" style={{ color: C.mute }}>{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ COMPARE ═══════ */}
      <section id="why" className="px-4 pb-16 sm:pb-24">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-5">
          <div className="rounded-3xl p-8" style={{ background: C.card, border:`1px solid ${C.line}` }}>
            <div className="inline-flex items-center gap-2 mb-4">
              <XCircle className="w-5 h-5" style={{color:'#EF4444'}}/>
              <span className="font-bold text-[16px]" style={{color:C.ink}}>Typical SMM panels</span>
            </div>
            <ul className="space-y-3 text-[14.5px]" style={{color:C.mute}}>
              {[
                'Identical batches every run — instant giveaway',
                'Bot-flat curves that trip spam filters',
                'No preview, no control, no timing',
                'One provider, one point of failure',
              ].map((x,i)=>(
                <li key={i} className="flex gap-2"><span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:'#EF4444'}}/> {x}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-3xl p-8 relative overflow-hidden" style={{ background: C.card, border:`1px solid ${C.line}` }}>
            <span className="absolute top-6 right-6 text-[10px] font-bold tracking-[0.14em] uppercase px-3 py-1 rounded-full text-white"
              style={{ background: C.blue }}>Our approach</span>
            <div className="inline-flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-5 h-5" style={{color:C.blue}}/>
              <span className="font-bold text-[16px]" style={{color:C.ink}}>Boostly Pro</span>
            </div>
            <ul className="space-y-3 text-[14.5px]" style={{color:C.mute}}>
              {[
                'Every drop is a fresh shape — reads like real fans',
                'S-curve pacing with peak-hour lift',
                'Live preview before a single credit is spent',
                'Multi-provider rotation — cheapest working provider wins',
              ].map((x,i)=>(
                <li key={i} className="flex gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{color:C.blue}}/> {x}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ═══════ HOW IT WORKS ═══════ */}
      <section id="how" className="px-4 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto">
          <h3 className="bp-serif text-center text-[30px] sm:text-[46px]" style={{ color: C.ink }}>
            Drop one link. Everything else runs on its own.
          </h3>

          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { n:'01', icon: Link2,      t:'Drop the URL',    d:'Paste any Instagram, YouTube or TikTok link.' },
              { n:'02', icon: Sparkles,   t:'Choose the mix',  d:'Flip on views, likes, comments, saves or shares.' },
              { n:'03', icon: Brain,      t:'Engine plans it', d:'S-curve pacing, ±50% variance, peak-hour lifts.' },
              { n:'04', icon: TrendingUp, t:'Watch it unfold', d:'Rolls in gradually, tracked live, safe.' },
            ].map((s,i)=>(
              <div key={i} className="relative rounded-2xl p-6"
                style={{ background: C.card, border:`1px solid ${C.line}`, boxShadow:'0 8px 24px -18px rgba(14,27,77,.25)' }}>
                <span className="absolute -top-3 right-5 text-[11px] font-bold tracking-wider text-white px-2.5 py-1 rounded-full"
                  style={{ background: C.ink }}>{s.n}</span>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: C.blueSoft }}>
                  <s.icon className="w-5 h-5" style={{ color: C.blue }} strokeWidth={2.2}/>
                </div>
                <div className="bp-serif text-[19px]" style={{ color: C.ink }}>{s.t}</div>
                <p className="mt-1 text-[13.5px]" style={{ color: C.mute }}>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ SETUP DIAGRAM — HOW TO ADD API KEY ═══════ */}
      <section id="setup" className="px-4 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-center mb-6">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] uppercase px-4 py-1.5 rounded-full"
              style={{ background: C.card, color: C.blue, boxShadow:`0 4px 14px -8px rgba(29,92,255,.4)` }}>
              <Sparkles className="w-3.5 h-3.5"/> Provider setup
            </span>
          </div>
          <h3 className="bp-serif text-center text-[30px] sm:text-[46px]" style={{ color: C.ink }}>
            Add your provider in under a minute.
          </h3>
          <p className="text-center mt-4 text-[14.5px] max-w-2xl mx-auto" style={{ color: C.mute }}>
            Grab your API key from any SMM panel, paste it into Boostly Pro, map service IDs — done. Here's exactly how it flows.
          </p>

          <div className="mt-12 rounded-3xl p-4 sm:p-8"
            style={{ background: C.card, border:`1px solid ${C.line}`, boxShadow:'0 20px 50px -30px rgba(14,27,77,.25)' }}>
            <svg viewBox="0 0 900 520" className="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={C.blue} />
                </marker>
                <style>{`
                  .lbl2{font-family:'Inter',sans-serif;font-size:13px;font-weight:600;fill:${C.ink}}
                  .sub2{font-family:'Inter',sans-serif;font-size:11px;fill:${C.mute}}
                  .ttl2{font-family:'Fraunces',serif;font-size:17px;font-weight:600;fill:${C.ink}}
                  .num2{font-family:'Inter',sans-serif;font-size:13px;font-weight:800;fill:#fff}
                  .code2{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;fill:${C.navy}}
                  .flow2{stroke:${C.blue};stroke-width:2;fill:none;stroke-dasharray:6 5;animation:bpdash 1.6s linear infinite}
                `}</style>
              </defs>

              {/* STEP 1 — SMM PANEL */}
              <g>
                <rect x="30" y="60" width="240" height="180" rx="18" fill="#fff" stroke={C.blue} strokeWidth="2"/>
                <circle cx="55" cy="85" r="14" fill={C.blue}/>
                <text x="55" y="89" textAnchor="middle" className="num2">1</text>
                <text x="80" y="90" className="ttl2">Any SMM Panel</text>
                <text x="45" y="115" className="sub2">Login → API section</text>

                {/* browser card */}
                <rect x="50" y="128" width="200" height="96" rx="10" fill={C.bg1} stroke={C.line}/>
                <circle cx="62" cy="140" r="3" fill="#EF4444"/>
                <circle cx="72" cy="140" r="3" fill="#F59E0B"/>
                <circle cx="82" cy="140" r="3" fill="#10B981"/>
                <text x="60" y="165" className="sub2">Your API Key</text>
                <rect x="60" y="172" width="180" height="20" rx="4" fill="#fff" stroke={C.blue}/>
                <text x="68" y="186" className="code2">a3f9•••••••b2c8•••••••</text>
                <rect x="60" y="198" width="60" height="18" rx="4" fill={C.blue}/>
                <text x="90" y="210" textAnchor="middle" className="sub2" style={{fill:'#fff',fontWeight:700}}>Copy</text>
              </g>

              {/* arrow 1 → 2 */}
              <path className="flow2" d="M270 150 C 305 150, 315 150, 340 150" markerEnd="url(#ah2)"/>

              {/* STEP 2 — PASTE IN BOOSTLY */}
              <g>
                <rect x="340" y="60" width="240" height="180" rx="18" fill={C.blueSoft} stroke={C.blue} strokeWidth="2"/>
                <circle cx="365" cy="85" r="14" fill={C.blue}/>
                <text x="365" y="89" textAnchor="middle" className="num2">2</text>
                <text x="390" y="90" className="ttl2">Boostly → My Providers</text>
                <text x="355" y="115" className="sub2">Paste key + API URL</text>

                {/* form card */}
                <rect x="360" y="128" width="200" height="96" rx="10" fill="#fff" stroke={C.line}/>
                <text x="370" y="146" className="sub2">Provider name</text>
                <rect x="370" y="150" width="180" height="16" rx="3" fill={C.bg2}/>
                <text x="376" y="162" className="code2">MySMM</text>
                <text x="370" y="180" className="sub2">API URL</text>
                <rect x="370" y="184" width="180" height="16" rx="3" fill={C.bg2}/>
                <text x="376" y="196" className="code2">https://panel.com/api/v2</text>
                <text x="370" y="214" className="sub2">API Key ✓ pasted</text>
              </g>

              {/* arrow 2 → 3 */}
              <path className="flow2" d="M580 150 C 615 150, 625 150, 650 150" markerEnd="url(#ah2)"/>

              {/* STEP 3 — MAP SERVICES */}
              <g>
                <rect x="650" y="60" width="220" height="180" rx="18" fill="#fff" stroke={C.blue} strokeWidth="2"/>
                <circle cx="675" cy="85" r="14" fill={C.blue}/>
                <text x="675" y="89" textAnchor="middle" className="num2">3</text>
                <text x="700" y="90" className="ttl2">Map Service IDs</text>
                <text x="665" y="115" className="sub2">Paste each Service ID</text>

                <rect x="665" y="128" width="190" height="24" rx="6" fill={C.bg2}/>
                <text x="675" y="144" className="code2">▶ Instagram Views · 1421</text>
                <rect x="665" y="156" width="190" height="24" rx="6" fill={C.bg2}/>
                <text x="675" y="172" className="code2">▶ Instagram Likes · 883</text>
                <rect x="665" y="184" width="190" height="24" rx="6" fill={C.bg2}/>
                <text x="675" y="200" className="code2">▶ YouTube Views · 2094</text>
                <rect x="665" y="212" width="190" height="20" rx="6" fill="#DCFCE7"/>
                <text x="760" y="226" textAnchor="middle" className="sub2" style={{fill:'#166534',fontWeight:700}}>✓ Saved</text>
              </g>

              {/* down connectors */}
              <path className="flow2" d="M150 240 L 150 300" markerEnd="url(#ah2)"/>
              <path className="flow2" d="M460 240 L 460 300" markerEnd="url(#ah2)"/>
              <path className="flow2" d="M760 240 L 760 300" markerEnd="url(#ah2)"/>

              {/* STEP 4 — CREATE BUNDLE */}
              <g>
                <rect x="30" y="310" width="840" height="150" rx="20" fill={C.ink}/>
                <circle cx="60" cy="345" r="16" fill={C.blue}/>
                <text x="60" y="349" textAnchor="middle" className="num2">4</text>
                <text x="88" y="350" className="ttl2" style={{fill:'#fff'}}>Create a Bundle → attach providers with priority</text>
                <text x="88" y="372" className="sub2" style={{fill:'#cbd5ff'}}>One bundle = one engagement type + multiple providers ranked 1, 2, 3…</text>

                {/* three provider chips */}
                <g transform="translate(60, 390)">
                  <rect x="0" y="0" width="240" height="52" rx="12" fill="#fff"/>
                  <circle cx="24" cy="26" r="12" fill={C.blue}/>
                  <text x="24" y="30" textAnchor="middle" className="num2">1</text>
                  <text x="46" y="24" className="lbl2">Provider A</text>
                  <text x="46" y="40" className="sub2">Instagram Views · Priority 1</text>

                  <rect x="270" y="0" width="240" height="52" rx="12" fill="#fff" opacity=".85"/>
                  <circle cx="294" cy="26" r="12" fill={C.navy}/>
                  <text x="294" y="30" textAnchor="middle" className="num2">2</text>
                  <text x="316" y="24" className="lbl2">Provider B</text>
                  <text x="316" y="40" className="sub2">Backup · Priority 2</text>

                  <rect x="540" y="0" width="240" height="52" rx="12" fill="#fff" opacity=".7"/>
                  <circle cx="564" cy="26" r="12" fill={C.navy}/>
                  <text x="564" y="30" textAnchor="middle" className="num2">3</text>
                  <text x="586" y="24" className="lbl2">Provider C</text>
                  <text x="586" y="40" className="sub2">Failover · Priority 3</text>
                </g>
              </g>

              {/* STEP 5 — READY */}
              <g transform="translate(0, 470)">
                <rect x="30" y="0" width="840" height="40" rx="12" fill={C.blueSoft} stroke={C.blue}/>
                <circle cx="55" cy="20" r="12" fill={C.blue}/>
                <text x="55" y="24" textAnchor="middle" className="num2">5</text>
                <text x="80" y="25" className="lbl2">Done! Orders now auto-dispatch through your providers in strict priority order.</text>
              </g>
            </svg>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { n:'1', t:'Copy API key',    d:'From any SMM panel — Account → API section. Also grab the API URL.' },
                { n:'2', t:'Add in Boostly',  d:'My Providers → Add Provider. Paste name, URL & key. Save.' },
                { n:'3', t:'Map service IDs', d:'For every engagement type, paste the exact Service ID from the panel.' },
                { n:'4', t:'Build a bundle',  d:'My Bundles → attach 1 or more providers with priority 1, 2, 3…' },
              ].map((s,i)=>(
                <div key={i} className="rounded-2xl p-4" style={{ background: C.bg2, border:`1px solid ${C.line}` }}>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-[13px]" style={{ background: C.blue }}>{s.n}</div>
                    <div className="bp-serif text-[16px]" style={{ color: C.ink }}>{s.t}</div>
                  </div>
                  <p className="mt-2 text-[13px]" style={{ color: C.mute }}>{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ PROVIDER FLOW DIAGRAM ═══════ */}
      <section id="provider-flow" className="px-4 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-center mb-6">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] uppercase px-4 py-1.5 rounded-full"
              style={{ background: C.card, color: C.blue, boxShadow:`0 4px 14px -8px rgba(29,92,255,.4)` }}>
              <Shuffle className="w-3.5 h-3.5"/> How providers work
            </span>
          </div>
          <h3 className="bp-serif text-center text-[30px] sm:text-[46px]" style={{ color: C.ink }}>
            Your bundle. Your providers. Smart rotation.
          </h3>
          <p className="text-center mt-4 text-[14.5px] max-w-2xl mx-auto" style={{ color: C.mute }}>
            You add multiple provider accounts to a bundle and set priority. The engine dispatches every order in strict order — 1 → 2 → 3. If one is busy, the next one picks it up instantly.
          </p>

          <div className="mt-12 rounded-3xl p-4 sm:p-8"
            style={{ background: C.card, border:`1px solid ${C.line}`, boxShadow:'0 20px 50px -30px rgba(14,27,77,.25)' }}>
            <svg viewBox="0 0 900 460" className="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={C.blue} />
                </marker>
                <linearGradient id="pipe" x1="0" x2="1">
                  <stop offset="0%" stopColor={C.blue} stopOpacity="0.15"/>
                  <stop offset="100%" stopColor={C.blue} stopOpacity="0.55"/>
                </linearGradient>
                <style>{`
                  .lbl{font-family:'Inter',sans-serif;font-size:13px;font-weight:600;fill:${C.ink}}
                  .sub{font-family:'Inter',sans-serif;font-size:11px;fill:${C.mute}}
                  .ttl{font-family:'Fraunces',serif;font-size:16px;font-weight:600;fill:${C.ink}}
                  .pri{font-family:'Inter',sans-serif;font-size:11px;font-weight:800;fill:#fff}
                  .flow{stroke:${C.blue};stroke-width:2;fill:none;stroke-dasharray:6 5}
                  @keyframes bpdash{to{stroke-dashoffset:-44}}
                  .flow{animation:bpdash 1.6s linear infinite}
                `}</style>
              </defs>

              {/* USER */}
              <g>
                <rect x="30" y="180" width="150" height="100" rx="16" fill={C.blueSoft} stroke={C.blue} strokeWidth="1.5"/>
                <circle cx="105" cy="215" r="14" fill={C.blue}/>
                <text x="105" y="250" textAnchor="middle" className="ttl">You</text>
                <text x="105" y="268" textAnchor="middle" className="sub">Drop 1 link + type</text>
              </g>

              {/* BUNDLE */}
              <g>
                <rect x="230" y="150" width="180" height="160" rx="18" fill="#fff" stroke={C.blue} strokeWidth="2"/>
                <text x="320" y="180" textAnchor="middle" className="ttl">Your Bundle</text>
                <text x="320" y="198" textAnchor="middle" className="sub">Instagram · Views</text>
                <rect x="248" y="212" width="144" height="26" rx="8" fill={C.blueSoft}/>
                <text x="258" y="229" className="lbl">🔗 3 providers mapped</text>
                <rect x="248" y="244" width="144" height="26" rx="8" fill={C.blueSoft}/>
                <text x="258" y="261" className="lbl">⚡ Priority rotation</text>
                <rect x="248" y="276" width="144" height="26" rx="8" fill={C.blueSoft}/>
                <text x="258" y="293" className="lbl">🔒 Auto failover</text>
              </g>

              {/* PROVIDERS */}
              <g>
                {/* P1 */}
                <rect x="480" y="60" width="200" height="90" rx="14" fill="#fff" stroke={C.blue} strokeWidth="2"/>
                <circle cx="505" cy="90" r="14" fill={C.blue}/>
                <text x="505" y="94" textAnchor="middle" className="pri">1</text>
                <text x="530" y="88" className="ttl">Provider A</text>
                <text x="530" y="106" className="sub">Fastest · Cheapest</text>
                <rect x="530" y="118" width="70" height="20" rx="6" fill="#DCFCE7"/>
                <text x="565" y="132" textAnchor="middle" className="sub" style={{fill:'#166534'}}>● Active</text>

                {/* P2 */}
                <rect x="480" y="190" width="200" height="90" rx="14" fill="#fff" stroke={C.line} strokeWidth="1.5"/>
                <circle cx="505" cy="220" r="14" fill={C.navy}/>
                <text x="505" y="224" textAnchor="middle" className="pri">2</text>
                <text x="530" y="218" className="ttl">Provider B</text>
                <text x="530" y="236" className="sub">Backup · Standard</text>
                <rect x="530" y="248" width="80" height="20" rx="6" fill="#FEF3C7"/>
                <text x="570" y="262" textAnchor="middle" className="sub" style={{fill:'#92400E'}}>◐ On standby</text>

                {/* P3 */}
                <rect x="480" y="320" width="200" height="90" rx="14" fill="#fff" stroke={C.line} strokeWidth="1.5"/>
                <circle cx="505" cy="350" r="14" fill={C.navy}/>
                <text x="505" y="354" textAnchor="middle" className="pri">3</text>
                <text x="530" y="348" className="ttl">Provider C</text>
                <text x="530" y="366" className="sub">Last resort</text>
                <rect x="530" y="378" width="80" height="20" rx="6" fill="#FEE2E2"/>
                <text x="570" y="392" textAnchor="middle" className="sub" style={{fill:'#991B1B'}}>✕ Busy · skip</text>
              </g>

              {/* PLATFORM */}
              <g>
                <rect x="740" y="180" width="140" height="100" rx="16" fill={C.ink}/>
                <text x="810" y="220" textAnchor="middle" className="ttl" style={{fill:'#fff'}}>Platform</text>
                <text x="810" y="242" textAnchor="middle" className="sub" style={{fill:'#cbd5ff'}}>IG · YT · TikTok</text>
                <text x="810" y="262" textAnchor="middle" className="sub" style={{fill:'#cbd5ff'}}>Delivery live ✓</text>
              </g>

              {/* FLOWS */}
              <path className="flow" d="M180 230 C 200 230, 210 230, 230 230" markerEnd="url(#ah)"/>
              <path className="flow" d="M410 200 C 440 200, 450 105, 480 105" markerEnd="url(#ah)"/>
              <path className="flow" d="M410 230 C 440 230, 450 235, 480 235" markerEnd="url(#ah)" style={{opacity:.35}}/>
              <path className="flow" d="M410 260 C 440 260, 450 365, 480 365" markerEnd="url(#ah)" style={{opacity:.2}}/>
              <path className="flow" d="M680 105 C 720 105, 730 200, 740 220" markerEnd="url(#ah)"/>

              {/* Legend */}
              <g transform="translate(30,410)">
                <circle cx="8" cy="8" r="5" fill={C.blue}/>
                <text x="22" y="12" className="sub">Solid arrow = active dispatch path</text>
                <circle cx="290" cy="8" r="5" fill={C.blue} opacity=".3"/>
                <text x="304" y="12" className="sub">Faded = standby (kicks in if #1 busy)</text>
              </g>
            </svg>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { n:'1', t:'Order lands',   d:'Engine picks your bundle for that link + engagement type.' },
                { n:'2', t:'Priority check', d:'Tries Provider #1 first. Busy or same-link conflict? Jumps to #2, then #3.' },
                { n:'3', t:'Sent & tracked', d:'Provider ID logged, live status polled, retries auto-handled.' },
              ].map((s,i)=>(
                <div key={i} className="rounded-2xl p-4" style={{ background: C.bg2, border:`1px solid ${C.line}` }}>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-[13px]" style={{ background: C.blue }}>{s.n}</div>
                    <div className="bp-serif text-[17px]" style={{ color: C.ink }}>{s.t}</div>
                  </div>
                  <p className="mt-2 text-[13px]" style={{ color: C.mute }}>{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ SIMPLE GUIDE ═══════ */}
      <section id="guide" className="px-4 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-center mb-6">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] uppercase px-4 py-1.5 rounded-full"
              style={{ background: C.card, color: C.blue, boxShadow:`0 4px 14px -8px rgba(29,92,255,.4)` }}>
              <FileText className="w-3.5 h-3.5"/> How to use
            </span>
          </div>
          <h3 className="bp-serif text-center text-[30px] sm:text-[46px]" style={{ color: C.ink }}>
            A simple guide to your first campaign.
          </h3>
          <p className="text-center mt-4 text-[14.5px]" style={{ color: C.mute }}>
            Follow these five steps — from sign up to live delivery. Takes about 60 seconds.
          </p>

          <div className="mt-10 space-y-3">
            {[
              { t:'Create your free account',        d:'Sign up with email — no card needed. You land straight on the dashboard.' },
              { t:'Add funds to your wallet',        d:'Open Wallet, pick UPI or crypto, top up any amount. Balance is instant.' },
              { t:'Open Engagement Order',           d:'Go to Engagement Order, drop any Instagram, YouTube or TikTok URL.' },
              { t:'Pick views, likes, comments & more', d:'Toggle each engagement type on and set the quantity. Preview shows exact rollout.' },
              { t:'Place order & track live',        d:'Hit Place Order — the engine drips it out on a human pattern. Watch it grow in real-time.' },
            ].map((s,i)=>(
              <div key={i} className="flex items-start gap-4 rounded-2xl p-5"
                style={{ background: C.card, border:`1px solid ${C.line}` }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold"
                  style={{ background: C.blue }}>{i+1}</div>
                <div>
                  <div className="bp-serif text-[19px]" style={{ color: C.ink }}>{s.t}</div>
                  <p className="mt-1 text-[13.5px]" style={{ color: C.mute }}>{s.d}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center">
            <Link to="/auth"
              className="inline-flex items-center gap-2 text-white font-bold text-[16px] px-8 py-4 rounded-full"
              style={{ background: C.blue, boxShadow: '0 18px 40px -14px rgba(29,92,255,0.55)' }}>
              Start your first campaign <ArrowRight className="w-4 h-4" />
            </Link>
            <div className="mt-3 text-[13px]" style={{ color: C.mute }}>
              Free to start · Ready in 60 seconds
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ PRICING ═══════ */}
      <section id="pricing" className="px-4 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-px flex-1 max-w-[40px]" style={{ background: C.line }} />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: C.blue }}>Pricing</span>
          </div>
          <h2 className="text-4xl sm:text-5xl font-black tracking-tight mb-3" style={{ fontFamily: "'Fraunces', serif", color: C.navy, letterSpacing: '-0.03em' }}>
            Simple, honest pricing.
          </h2>
          <p className="text-base sm:text-lg mb-12 max-w-2xl" style={{ color: C.mute }}>
            One subscription unlocks unlimited providers, bundles, and orders. No per-order fees, no hidden costs.
          </p>

          <div className="grid md:grid-cols-3 gap-5">
            {/* Monthly */}
            <div className="rounded-2xl p-7 flex flex-col" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <div className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4" style={{ color: C.soft }}>Monthly</div>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="text-5xl font-black tracking-tight" style={{ fontFamily: "'Fraunces', serif", color: C.ink }}>$39</span>
                <span className="text-sm font-medium" style={{ color: C.soft }}>/ month</span>
              </div>
              <p className="text-sm mb-6" style={{ color: C.mute }}>Flexible month-to-month access.</p>
              <ul className="space-y-2.5 mb-8 text-sm flex-1" style={{ color: C.mute }}>
                {['Unlimited providers','Unlimited bundles','Priority rotation','Standard support'].map(f => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: C.blue }} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/subscription" className="w-full h-11 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 transition-colors" style={{ border: `1px solid ${C.ink}`, color: C.ink }}>
                Get started <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {/* Yearly - featured */}
            <div className="rounded-2xl p-7 flex flex-col relative overflow-hidden" style={{ background: C.navy, color: '#fff' }}>
              <div className="absolute top-5 right-5 text-[10px] font-bold uppercase tracking-[0.15em] px-2.5 py-1 rounded-full" style={{ background: C.blue, color: '#fff' }}>
                Most popular
              </div>
              <div className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4" style={{ color: '#8FB0FF' }}>Yearly</div>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="text-5xl font-black tracking-tight" style={{ fontFamily: "'Fraunces', serif" }}>$99</span>
                <span className="text-sm font-medium" style={{ color: '#8FB0FF' }}>/ year</span>
              </div>
              <p className="text-sm mb-6" style={{ color: '#B8C7EE' }}>Save 79% vs monthly. Best value.</p>
              <ul className="space-y-2.5 mb-8 text-sm flex-1" style={{ color: '#D6DEF5' }}>
                {['Everything in Monthly','Priority support','Advanced AI insights','Early feature access'].map(f => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#8FB0FF' }} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/subscription" className="w-full h-11 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2" style={{ background: C.blue, color: '#fff' }}>
                Choose yearly <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {/* Lifetime */}
            <div className="rounded-2xl p-7 flex flex-col" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <div className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4" style={{ color: C.blue }}>Lifetime</div>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="text-5xl font-black tracking-tight" style={{ fontFamily: "'Fraunces', serif", color: C.ink }}>$199</span>
                <span className="text-sm font-medium" style={{ color: C.soft }}>/ once</span>
              </div>
              <p className="text-sm mb-6" style={{ color: C.mute }}>Pay once, use forever.</p>
              <ul className="space-y-2.5 mb-8 text-sm flex-1" style={{ color: C.mute }}>
                {['Everything in Yearly','Lifetime updates','VIP support channel','No recurring fees'].map(f => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: C.blue }} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/subscription" className="w-full h-11 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2" style={{ border: `1px solid ${C.ink}`, color: C.ink }}>
                Go lifetime <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          <p className="text-center text-xs mt-8" style={{ color: C.soft }}>
            All plans include unlimited orders · Cancel anytime · Secure crypto & UPI payments
          </p>
        </div>
      </section>

      {/* ═══════ FOOTER ═══════ */}
      <footer className="px-4 pt-16 pb-10" style={{ borderTop: `1px solid ${C.line}` }}>
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5">
              <img src={logo} alt="Boostly Pro" width={32} height={32} className="w-8 h-8 rounded-full object-cover" />
              <span className="font-extrabold text-[16px]" style={{ color: C.navy }}>Boostly Pro</span>
            </div>
            <p className="mt-4 text-[13.5px] leading-relaxed" style={{ color: C.mute }}>
              Organic social growth for creators. Human-pattern delivery, calibrated for every platform.
            </p>
          </div>

          <div>
            <div className="text-[11px] font-bold tracking-[0.16em] uppercase mb-3" style={{ color: C.soft }}>Product</div>
            <ul className="space-y-2 text-[14px]" style={{ color: C.navy }}>
              <li><Link to="/auth" className="hover:opacity-70">Get started</Link></li>
              <li><a href="#features" className="hover:opacity-70">Features</a></li>
              <li><a href="#how" className="hover:opacity-70">How it works</a></li>
            </ul>
          </div>

          <div>
            <div className="text-[11px] font-bold tracking-[0.16em] uppercase mb-3" style={{ color: C.soft }}>Legal</div>
            <ul className="space-y-2 text-[14px]" style={{ color: C.navy }}>
              <li><Link to="/terms" className="hover:opacity-70">Terms</Link></li>
              <li><Link to="/privacy" className="hover:opacity-70">Privacy</Link></li>
              <li><Link to="/refund" className="hover:opacity-70">Refund</Link></li>
              <li><Link to="/cookies" className="hover:opacity-70">Cookies</Link></li>
            </ul>
          </div>

          <div>
            <div className="text-[11px] font-bold tracking-[0.16em] uppercase mb-3" style={{ color: C.soft }}>Support</div>
            <ul className="space-y-2 text-[14px]" style={{ color: C.navy }}>
              <li><Link to="/about" className="hover:opacity-70">About us</Link></li>
              <li><Link to="/contact" className="hover:opacity-70">Contact</Link></li>
              <li><Link to="/support" className="hover:opacity-70">Help center</Link></li>
            </ul>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-10 pt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-[12.5px]"
          style={{ color: C.soft, borderTop: `1px solid ${C.line}` }}>
          <div>© {new Date().getFullYear()} Boostly Pro. All rights reserved.</div>
          <div>Made for creators who care about their reach.</div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
