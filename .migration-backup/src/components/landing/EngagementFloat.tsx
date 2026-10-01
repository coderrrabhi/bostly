import React from 'react';
import { Eye, Heart, MessageCircle, Bookmark, Share2, UserPlus } from 'lucide-react';

const ITEMS = [
  { icon: Eye,           label: 'Views',      color: '#06B6D4', bg: 'rgba(6,182,212,.12)',  delay: '0s',   dur: '5.2s' },
  { icon: Heart,         label: 'Likes',      color: '#EF4444', bg: 'rgba(239,68,68,.12)',  delay: '.6s',  dur: '4.6s' },
  { icon: MessageCircle, label: 'Comments',   color: '#3B82F6', bg: 'rgba(59,130,246,.12)', delay: '1.1s', dur: '5.8s' },
  { icon: Bookmark,      label: 'Saves',      color: '#F59E0B', bg: 'rgba(245,158,11,.12)', delay: '1.7s', dur: '4.9s' },
  { icon: Share2,        label: 'Shares',     color: '#8B5CF6', bg: 'rgba(139,92,246,.12)', delay: '2.2s', dur: '5.4s' },
  { icon: UserPlus,      label: 'Followers',  color: '#10B981', bg: 'rgba(16,185,129,.12)', delay: '2.8s', dur: '5.1s' },
];

export const EngagementFloat: React.FC = () => {
  return (
    <section aria-label="Engagement types" className="py-10 sm:py-16 px-4 sm:px-6 lg:px-8">
      <style>{`
        @keyframes bp-float {
          0%,100% { transform: translateY(0) rotate(0deg); }
          50%     { transform: translateY(-14px) rotate(1.5deg); }
        }
        @keyframes bp-glow {
          0%,100% { box-shadow: 0 0 0 0 var(--bp-glow), 0 10px 30px rgba(11,11,18,.06); }
          50%     { box-shadow: 0 0 0 14px transparent, 0 20px 44px var(--bp-glow); }
        }
        @keyframes bp-ring {
          0%   { transform: scale(.6); opacity: .55; }
          100% { transform: scale(1.9); opacity: 0; }
        }
        @keyframes bp-shine {
          0%   { transform: translateX(-120%) skewX(-18deg); }
          60%,100% { transform: translateX(220%) skewX(-18deg); }
        }
        .bp-tile { animation: bp-float var(--bp-dur,5s) ease-in-out infinite, bp-glow var(--bp-dur,5s) ease-in-out infinite; animation-delay: var(--bp-delay, 0s); }
        .bp-ring { animation: bp-ring 2.6s ease-out infinite; animation-delay: var(--bp-delay, 0s); }
        .bp-shine { animation: bp-shine 4.5s ease-in-out infinite; animation-delay: var(--bp-delay, 0s); }
        @media (prefers-reduced-motion: reduce) {
          .bp-tile, .bp-ring, .bp-shine { animation: none !important; }
        }
      `}</style>

      <div className="max-w-6xl mx-auto text-center mb-8 sm:mb-10">
        <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[11px] sm:text-[12px] font-semibold"
          style={{ background: '#EFF6FF', color: '#2563eb', border: '1px solid rgba(59,130,246,.2)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          Every engagement type, delivered organically
        </span>
        <h2 className="mt-4 text-[1.75rem] sm:text-4xl lg:text-[2.75rem] font-extrabold tracking-tight"
          style={{ color: '#0B0B12', fontFamily: "'Outfit', system-ui" }}>
          Views. Likes. Comments. <span style={{ color: '#2563eb' }}>The full stack.</span>
        </h2>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-5">
        {ITEMS.map(({ icon: Icon, label, color, bg, delay, dur }) => (
          <div key={label} className="relative flex flex-col items-center">
            {/* pulsing rings */}
            <div className="relative">
              <span aria-hidden className="bp-ring absolute inset-0 rounded-2xl"
                style={{ ['--bp-delay' as any]: delay, background: `radial-gradient(closest-side, ${color}55, transparent 70%)` }} />
              <div
                className="bp-tile relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center overflow-hidden"
                style={{
                  ['--bp-glow' as any]: `${color}55`,
                  ['--bp-delay' as any]: delay,
                  ['--bp-dur' as any]: dur,
                  background: `linear-gradient(160deg, #FFFFFF, ${bg})`,
                  border: `1px solid ${color}33`,
                }}
              >
                <Icon className="w-7 h-7 sm:w-8 sm:h-8 relative z-10" style={{ color }} strokeWidth={2.2} />
                {/* moving shine */}
                <span aria-hidden className="bp-shine absolute top-0 left-0 h-full w-1/3 pointer-events-none"
                  style={{ ['--bp-delay' as any]: delay, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent)' }} />
              </div>
            </div>
            <span className="mt-3 text-[12px] sm:text-[13px] font-bold tracking-tight" style={{ color: '#0B0B12' }}>{label}</span>
            <span className="text-[10.5px] sm:text-[11px] font-medium" style={{ color: '#6B6B78' }}>Human-pattern drops</span>
          </div>
        ))}
      </div>
    </section>
  );
};

export default EngagementFloat;
