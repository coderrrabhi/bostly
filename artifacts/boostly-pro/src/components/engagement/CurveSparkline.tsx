import { useMemo } from 'react';
import { curvePoints, type PlainRun } from '@/lib/organic-extras';

interface Props {
  runs: PlainRun[];
  height?: number;
  className?: string;
}

/** Small cumulative delivery curve used in Mass Order preview and Refill dialog. */
export function CurveSparkline({ runs, height = 44, className }: Props) {
  const { line, area, bars } = useMemo(() => {
    const pts = curvePoints(runs);
    const w = 100;
    const h = 40;
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * w).toFixed(2)},${(h - p.y * h).toFixed(2)}`).join(' ');
    const area = pts.length ? `${line} L${w},${h} L0,${h} Z` : '';
    const max = Math.max(1, ...runs.map((r) => Number(r.quantity_to_send)));
    const sorted = [...runs].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    const t0 = sorted.length ? new Date(sorted[0].scheduled_at).getTime() : 0;
    const t1 = sorted.length ? new Date(sorted[sorted.length - 1].scheduled_at).getTime() : 0;
    const bars = sorted.map((r) => ({
      x: t1 > t0 ? ((new Date(r.scheduled_at).getTime() - t0) / (t1 - t0)) * w : w / 2,
      h: (Number(r.quantity_to_send) / max) * (h * 0.45),
    }));
    return { line, area, bars };
  }, [runs]);

  if (!runs.length) return null;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={className} style={{ height, width: '100%' }} aria-label="Delivery curve">
      {bars.map((b, i) => (
        <rect key={i} x={Math.max(0, Math.min(99, b.x - 0.4))} y={40 - b.h} width={0.8} height={b.h} className="fill-primary/25" />
      ))}
      <path d={area} className="fill-primary/10" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.4} vectorEffect="non-scaling-stroke" className="text-primary" />
    </svg>
  );
}
