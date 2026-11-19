// Curve-to-Schedule Converter
// Converts user-drawn control points into delivery runs

import { EngagementType, ENGAGEMENT_CONFIG } from '@/lib/engagement-types';
import { PROVIDER_MINIMUMS } from '@/lib/organic-algorithm';
import { runsForWindow, smoothSchedule } from '@/lib/curve-plan';

export interface ControlPoint {
  id: string;
  x: number; // 0-100% of timeline
  y: number; // 0-100% of target quantity
  type: EngagementType;
}

export interface DrawModeState {
  isEnabled: boolean;
  activeType: EngagementType | null;
  points: Record<EngagementType, ControlPoint[]>;
}

export interface CurveScheduleRun {
  runNumber: number;
  timePercent: number;
  quantity: number;
  cumulativeQuantity: number;
}

// Create initial control points for a type (start + end)
export function createInitialPoints(type: EngagementType, quantity: number): ControlPoint[] {
  return [
    { id: `${type}-start`, x: 0, y: 0, type },
    { id: `${type}-end`, x: 100, y: 100, type },
  ];
}

// Cubic spline interpolation for smooth curves
function catmullRomSpline(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

// Interpolate smooth curve through control points
export function interpolateCurve(
  points: ControlPoint[],
  samples: number = 50
): { x: number; y: number }[] {
  if (points.length < 2) return [];
  
  // Sort points by x position
  const sorted = [...points].sort((a, b) => a.x - b.x);
  
  // Ensure we have start and end points
  if (sorted[0].x > 0) {
    sorted.unshift({ id: 'auto-start', x: 0, y: 0, type: sorted[0].type });
  }
  if (sorted[sorted.length - 1].x < 100) {
    sorted.push({ id: 'auto-end', x: 100, y: 100, type: sorted[0].type });
  }
  
  const result: { x: number; y: number }[] = [];
  
  // Simple linear interpolation for 2 points
  if (sorted.length === 2) {
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      result.push({
        x: sorted[0].x + t * (sorted[1].x - sorted[0].x),
        y: sorted[0].y + t * (sorted[1].y - sorted[0].y),
      });
    }
    return result;
  }
  
  // Catmull-Rom spline for 3+ points
  const samplesPerSegment = Math.ceil(samples / (sorted.length - 1));
  
  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[Math.max(0, i - 1)];
    const p1 = sorted[i];
    const p2 = sorted[i + 1];
    const p3 = sorted[Math.min(sorted.length - 1, i + 2)];
    
    for (let j = 0; j < samplesPerSegment; j++) {
      const t = j / samplesPerSegment;
      result.push({
        x: catmullRomSpline(p0.x, p1.x, p2.x, p3.x, t),
        y: Math.max(0, Math.min(100, catmullRomSpline(p0.y, p1.y, p2.y, p3.y, t))),
      });
    }
  }
  
  // Add final point
  result.push({ x: 100, y: sorted[sorted.length - 1].y });
  
  return result;
}

// Convert drawn curve to a smooth delivery schedule. The number of runs is
// planned from the quantity and window (see curve-plan.ts) so the selected
// curve is drawn without spikes and every run finishes inside the window.
export function curveToSchedule(
  points: ControlPoint[],
  type: EngagementType,
  totalQuantity: number,
  totalDurationHours: number = 24,
  _numRunsHint: number = 20,
  minQuantity?: number,
): CurveScheduleRun[] {
  const providerMin = Math.max(1, minQuantity || PROVIDER_MINIMUMS[type] || 1);
  if (totalQuantity <= 0) return [];
  if (totalQuantity < providerMin * 2) {
    return [{ runNumber: 1, timePercent: 0, quantity: totalQuantity, cumulativeQuantity: totalQuantity }];
  }
  const curve = interpolateCurve(points, 200);
  if (curve.length === 0) return [];
  const runs = runsForWindow(type, totalQuantity, totalDurationHours, providerMin);
  return smoothSchedule((x) => getCurveValueAtX(curve, x), totalQuantity, runs, providerMin);
}

// Calculate optimal number of runs based on quantity and type
function calculateOptimalRunCount(type: EngagementType, quantity: number, minBatch: number): number {
  // Base run count ranges by type
  const baseRuns: Record<string, { min: number; max: number }> = {
    views: { min: 15, max: 60 },
    likes: { min: 12, max: 45 },
    comments: { min: 8, max: 30 },
    saves: { min: 8, max: 25 },
    shares: { min: 10, max: 35 },
  };
  
  const range = baseRuns[type] || { min: 10, max: 40 };
  
  // Scale runs based on quantity
  const maxPossibleRuns = Math.floor(quantity / minBatch);
  const scaledRuns = Math.min(
    range.max,
    Math.max(range.min, Math.round(quantity / (minBatch * 3)))
  );
  
  // Add randomness
  const variance = Math.floor(Math.random() * 5) - 2;
  return Math.min(maxPossibleRuns, Math.max(3, scaledRuns + variance));
}

// Generate organic time slots with natural variance
function generateOrganicTimeSlots(count: number, durationHours: number): number[] {
  const slots: number[] = [];
  const baseInterval = 100 / count;
  
  let currentTime = 0;
  
  for (let i = 0; i < count; i++) {
    // Add variance to interval (±30%)
    const variance = (Math.random() - 0.5) * 0.6;
    const interval = baseInterval * (1 + variance);
    
    // Random micro-gaps (organic pauses)
    const microGap = Math.random() < 0.15 ? baseInterval * 0.3 : 0;
    
    currentTime += interval + microGap;
    
    // Clamp to valid range
    const timePercent = Math.min(100, Math.max(0, currentTime));
    slots.push(timePercent);
    
    if (timePercent >= 100) break;
  }
  
  // Ensure we end at or near 100%
  if (slots.length > 0 && slots[slots.length - 1] < 95) {
    slots.push(100);
  }
  
  return slots;
}

// Get interpolated Y value at a given X position on the curve
function getCurveValueAtX(curve: { x: number; y: number }[], targetX: number): number {
  if (curve.length === 0) return 0;
  if (curve.length === 1) return curve[0].y;
  
  // Find surrounding points
  let left = curve[0];
  let right = curve[curve.length - 1];
  
  for (let i = 0; i < curve.length - 1; i++) {
    if (curve[i].x <= targetX && curve[i + 1].x >= targetX) {
      left = curve[i];
      right = curve[i + 1];
      break;
    }
  }
  
  // Linear interpolation between points
  if (right.x === left.x) return left.y;
  
  const t = (targetX - left.x) / (right.x - left.x);
  return left.y + t * (right.y - left.y);
}

// Calculate schedule quantities from curve (for updating EngagementConfig)
export function calculateQuantitiesFromCurve(
  points: Record<EngagementType, ControlPoint[]>,
  baseQuantities: Record<EngagementType, number>
): Record<EngagementType, number> {
  const result: Partial<Record<EngagementType, number>> = {};
  
  for (const [type, pts] of Object.entries(points)) {
    const engType = type as EngagementType;
    if (pts.length >= 2) {
      // Use the final Y value as the target percentage
      const sorted = [...pts].sort((a, b) => a.x - b.x);
      const finalY = sorted[sorted.length - 1].y;
      result[engType] = Math.round((finalY / 100) * baseQuantities[engType]);
    }
  }
  
  return result as Record<EngagementType, number>;
}

// Generate chart data from drawn curve
export function generateChartDataFromCurve(
  points: ControlPoint[],
  type: EngagementType,
  totalQuantity: number,
  samples: number = 50
): { time: number; value: number }[] {
  const curve = interpolateCurve(points, samples);
  
  return curve.map(point => ({
    time: point.x,
    value: Math.round((point.y / 100) * totalQuantity),
  }));
}

// Presets for common growth patterns
export interface CurvePreset {
  id: string;
  name: string;
  emoji: string;
  tag?: string;
  description: string;
  timeFactor?: number;
  getPoints: (type: EngagementType) => ControlPoint[];
}

export const CURVE_PRESETS: CurvePreset[] = [
  {
    id: 'viral-spike',
    name: 'Viral Surge',
    emoji: '⚡',
    tag: 'Highest Approval',
    description: 'Slow natural buildup, explosive viral peak',
    timeFactor: 0.8,
    getPoints: (type) => [
      { id: `${type}-0`, x: 0, y: 0, type },
      { id: `${type}-1`, x: 25, y: 5, type },
      { id: `${type}-2`, x: 55, y: 25, type },
      { id: `${type}-3`, x: 75, y: 80, type },
      { id: `${type}-4`, x: 100, y: 100, type },
    ],
  },
  {
    id: 'steady-growth',
    name: 'Steady Growth',
    emoji: '📈',
    tag: 'Safest',
    description: 'Consistent linear distribution, ultra-low detection',
    timeFactor: 1.0,
    getPoints: (type) => [
      { id: `${type}-0`, x: 0, y: 0, type },
      { id: `${type}-1`, x: 50, y: 50, type },
      { id: `${type}-2`, x: 100, y: 100, type },
    ],
  },
  {
    id: 's-curve',
    name: 'Natural S-Curve',
    emoji: '🌊',
    tag: 'Natural',
    description: 'Classic organic growth, gentle ramp-up to peak',
    timeFactor: 1.0,
    getPoints: (type) => [
      { id: `${type}-0`, x: 0, y: 0, type },
      { id: `${type}-1`, x: 20, y: 6, type },
      { id: `${type}-2`, x: 50, y: 50, type },
      { id: `${type}-3`, x: 80, y: 94, type },
      { id: `${type}-4`, x: 100, y: 100, type },
    ],
  },
  {
    id: 'early-boost',
    name: 'Early Boost',
    emoji: '🚀',
    tag: 'Explore / FYP Push',
    description: 'Fast launch in first 2h, then sustained trickle',
    timeFactor: 0.85,
    getPoints: (type) => [
      { id: `${type}-0`, x: 0, y: 0, type },
      { id: `${type}-1`, x: 20, y: 45, type },
      { id: `${type}-2`, x: 50, y: 70, type },
      { id: `${type}-3`, x: 100, y: 100, type },
    ],
  },
  {
    id: 'evening-prime',
    name: 'Evening Prime',
    emoji: '🔥',
    tag: 'Peak Hours Wave',
    description: 'Late surge simulating peak active social media hours',
    timeFactor: 0.9,
    getPoints: (type) => [
      { id: `${type}-0`, x: 0, y: 0, type },
      { id: `${type}-1`, x: 35, y: 15, type },
      { id: `${type}-2`, x: 65, y: 65, type },
      { id: `${type}-3`, x: 85, y: 92, type },
      { id: `${type}-4`, x: 100, y: 100, type },
    ],
  },
  {
    id: 'double-peak',
    name: 'Double Wave Peak',
    emoji: '⚡⚡',
    tag: 'Viral Reshare',
    description: 'Two separate surges (initial views + secondary wave)',
    timeFactor: 1.1,
    getPoints: (type) => [
      { id: `${type}-0`, x: 0, y: 0, type },
      { id: `${type}-1`, x: 25, y: 40, type },
      { id: `${type}-2`, x: 45, y: 35, type },
      { id: `${type}-3`, x: 75, y: 85, type },
      { id: `${type}-4`, x: 100, y: 100, type },
    ],
  },
  {
    id: 'slow-burn',
    name: 'Slow Burn',
    emoji: '🐢',
    tag: 'Max Stealth',
    description: 'Very gradual, extended delivery for brand accounts',
    timeFactor: 1.35,
    getPoints: (type) => [
      { id: `${type}-0`, x: 0, y: 0, type },
      { id: `${type}-1`, x: 40, y: 18, type },
      { id: `${type}-2`, x: 70, y: 48, type },
      { id: `${type}-3`, x: 100, y: 100, type },
    ],
  },
  {
    id: 'algo-drip',
    name: 'Algorithmic Drip',
    emoji: '🎯',
    tag: 'Smart Pacing',
    description: 'Micro-bursts with resting pauses mimicking shares',
    timeFactor: 1.1,
    getPoints: (type) => [
      { id: `${type}-0`, x: 0, y: 0, type },
      { id: `${type}-1`, x: 20, y: 22, type },
      { id: `${type}-2`, x: 40, y: 30, type },
      { id: `${type}-3`, x: 60, y: 65, type },
      { id: `${type}-4`, x: 80, y: 75, type },
      { id: `${type}-5`, x: 100, y: 100, type },
    ],
  },
  {
    id: 'morning-kick',
    name: 'Morning Kick',
    emoji: '🌅',
    tag: 'Morning Prime',
    description: 'Early morning momentum with steady afternoon flow',
    timeFactor: 0.95,
    getPoints: (type) => [
      { id: `${type}-0`, x: 0, y: 0, type },
      { id: `${type}-1`, x: 15, y: 35, type },
      { id: `${type}-2`, x: 45, y: 55, type },
      { id: `${type}-3`, x: 75, y: 80, type },
      { id: `${type}-4`, x: 100, y: 100, type },
    ],
  },
  {
    id: 'high-velocity',
    name: 'High-Velocity Explode',
    emoji: '🏆',
    tag: 'Trend Booster',
    description: 'Aggressive rapid acceleration for trending audio & challenges',
    timeFactor: 0.75,
    getPoints: (type) => [
      { id: `${type}-0`, x: 0, y: 0, type },
      { id: `${type}-1`, x: 15, y: 50, type },
      { id: `${type}-2`, x: 35, y: 85, type },
      { id: `${type}-3`, x: 70, y: 96, type },
      { id: `${type}-4`, x: 100, y: 100, type },
    ],
  },
  {
    id: 'earthquake-323',
    name: '#323 · Earthquake',
    emoji: '🌋',
    tag: 'Aftershock Waves',
    description: 'Sudden disruption with aftershocks, natural tremor pattern',
    timeFactor: 1.0,
    getPoints: (type) => [
      { id: `${type}-0`, x: 0, y: 0, type },
      { id: `${type}-1`, x: 10, y: 4, type },
      { id: `${type}-2`, x: 20, y: 50, type },
      { id: `${type}-3`, x: 30, y: 40, type },
      { id: `${type}-4`, x: 42, y: 65, type },
      { id: `${type}-5`, x: 52, y: 57, type },
      { id: `${type}-6`, x: 64, y: 82, type },
      { id: `${type}-7`, x: 74, y: 76, type },
      { id: `${type}-8`, x: 86, y: 93, type },
      { id: `${type}-9`, x: 100, y: 100, type },
    ],
  },
];
