// ===============================================
// ULTRA ORGANIC ALGORITHM v3.0 - DEEP ANTI-BOT SYSTEM
// Each engagement type has completely independent, multi-layer randomization
// Designed to be 100% undetectable by platform algorithms
// ===============================================

import { minOrderFor, usPeakOffsetMs } from "./organic-extras";
export interface OrganicRunConfig {
  runNumber: number;
  scheduledAt: Date;
  quantity: number;
  baseQuantity: number;
  varianceApplied: number;
  peakMultiplier: number;
  // Deep anti-detection metrics
  dayOfWeek: number;           // 0-6, affects patterns
  hourOfDay: number;           // 0-23, IST
  sessionType: 'megaBurst' | 'burst' | 'normal' | 'slow' | 'pause' | 'deadZone';
  humanBehaviorScore: number;  // 0-100, how "human" this batch looks
  patternBreaker: boolean;     // True if this intentionally breaks a pattern
}

export interface FullOrganicConfig {
  engagementType: string;
  totalQuantity: number;
  runs: OrganicRunConfig[];
  totalDuration: number;
  warnings: string[];
  // NEW: Anti-detection metrics
  patternBreakCount: number;
  avgHumanScore: number;
  varietyIndex: number;        // How varied the delivery is (higher = more organic)
}

const ENGAGEMENT_REACTION_TIMING: Record<string, { startViewIndex: number; minDelay: number; maxDelay: number }> = {
  likes: { startViewIndex: 0, minDelay: 8, maxDelay: 18 },
  comments: { startViewIndex: 1, minDelay: 18, maxDelay: 40 },
  shares: { startViewIndex: 1, minDelay: 15, maxDelay: 35 },
  saves: { startViewIndex: 1, minDelay: 22, maxDelay: 48 },
  reposts: { startViewIndex: 2, minDelay: 28, maxDelay: 60 },
  retweets: { startViewIndex: 2, minDelay: 25, maxDelay: 55 },
  followers: { startViewIndex: 2, minDelay: 35, maxDelay: 75 },
  subscribers: { startViewIndex: 2, minDelay: 35, maxDelay: 75 },
  watch_hours: { startViewIndex: 0, minDelay: 10, maxDelay: 25 },
};

// Max quantity per single run for very sparse types (comments: 1, sometimes 2; never above 2).
const PER_RUN_CAP: Record<string, number> = { comments: 2 };

/**
 * Coordinate a full-engagement order around its Views reach curve.
 * Every reaction run is tied to one Views run: its quantity follows that run's
 * views (e.g. ~4–5 likes per 250 views at a 1.5–2% ratio), comments go out
 * 1 at a time (sometimes 2), and everything settles inside the Views window.
 * The per-type TOTAL (from the bundle Min%–Max%) is never changed.
 */
/**
 * Generates truly random, varying quantities across multiple runs for any engagement type
 * (shares, saves, reposts, comments, likes, views).
 * 
 * Rules:
 * 1. Every run quantity is ALWAYS >= min (never below provider/configured minimum).
 * 2. Sum of all runs EXACTLY equals total.
 * 3. Quantities are organically varied (no robotic repeating identical numbers like 10, 10, 10, 10).
 * 4. Number of runs adapts so there is always variance budget.
 */
export function generateRandomVaryingRuns(total: number, min: number, maxSlots: number): number[] {
  if (total <= 0) return [];
  const effectiveMin = Math.max(1, min);
  if (total <= effectiveMin) return [total];

  const absoluteMaxRuns = Math.floor(total / effectiveMin);
  if (absoluteMaxRuns <= 1) return [total];

  // We want healthy variance so runs don't degenerate into all identical minimums.
  // Leave a variance buffer: target average >= effectiveMin * 1.35 whenever possible.
  const idealRuns = Math.max(2, Math.floor(total / (effectiveMin * 1.35)));
  let targetRuns = Math.max(2, Math.min(maxSlots, absoluteMaxRuns, idealRuns));

  // If targetRuns * effectiveMin == total, there is 0 remaining quantity to vary!
  // In that case, reduce targetRuns by at least 1 (if targetRuns > 2) so we have variance budget.
  if (targetRuns > 2 && targetRuns * effectiveMin === total) {
    targetRuns = targetRuns - 1;
  }

  const runQuantities = new Array(targetRuns).fill(effectiveMin);
  let remaining = total - (targetRuns * effectiveMin);

  if (remaining > 0) {
    // Generate distinct random variance weights
    const randWeights = Array.from({ length: targetRuns }, (_, i) => {
      const pos = i / Math.max(1, targetRuns - 1);
      const wave = Math.sin(pos * Math.PI) * 0.8 + 0.6; // gentle natural curve
      const noise = 0.4 + Math.random() * 1.2;          // natural noise
      return Math.max(0.1, wave * noise);
    });
    const sumW = randWeights.reduce((a, b) => a + b, 0);

    let distributed = 0;
    for (let i = 0; i < targetRuns; i++) {
      const share = Math.floor((remaining * randWeights[i]) / sumW);
      runQuantities[i] += share;
      distributed += share;
    }

    let leftover = remaining - distributed;
    while (leftover > 0) {
      const idx = Math.floor(Math.random() * targetRuns);
      runQuantities[idx] += 1;
      leftover -= 1;
    }
  }

  // PASS: Anti-repetition pass to break any adjacent or repeating identical quantities
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < targetRuns - 1; i++) {
      if (runQuantities[i] === runQuantities[i + 1]) {
        if (runQuantities[i] > effectiveMin + 1) {
          runQuantities[i] -= 1;
          runQuantities[i + 1] += 1;
        } else {
          const donorIdx = runQuantities.findIndex((q, idx) => idx !== i && idx !== i + 1 && q > effectiveMin + 1);
          if (donorIdx !== -1) {
            runQuantities[donorIdx] -= 1;
            runQuantities[i] += 1;
          }
        }
      }
    }
  }

  // Final check: sum === total without any run dropping below effectiveMin
  let currentSum = runQuantities.reduce((a, b) => a + b, 0);
  if (currentSum !== total) {
    let diff = total - currentSum;
    for (let i = 0; i < runQuantities.length && diff !== 0; i++) {
      if (diff > 0) {
        runQuantities[i] += 1;
        diff -= 1;
      } else if (diff < 0 && runQuantities[i] > effectiveMin) {
        runQuantities[i] -= 1;
        diff += 1;
      }
    }
  }

  return runQuantities;
}

export function coordinateEngagementSchedules(
  schedules: FullOrganicConfig[],
  minimums: Record<string, number | undefined> = {},
): FullOrganicConfig[] {
  const viewsSchedule = schedules.find((schedule) => schedule.engagementType.toLowerCase() === 'views');
  if (!viewsSchedule?.runs.length) return schedules;

  const viewRuns = [...viewsSchedule.runs].sort(
    (left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime(),
  );
  const viewTimes = viewRuns.map((run) => run.scheduledAt.getTime());
  const slotCount = viewRuns.length;
  const avgGap = slotCount > 1 ? (viewTimes[slotCount - 1] - viewTimes[0]) / (slotCount - 1) : 30 * 60_000;
  const tailMs = slotCount > 1 ? Math.min(10 * 60_000, Math.max(2 * 60_000, avgGap * 0.5)) : 30 * 60_000;

  return schedules.map((schedule) => {
    const type = schedule.engagementType.toLowerCase();
    if (type === 'views' || schedule.runs.length === 0) return schedule;

    const runSum = schedule.runs.reduce((sum, run) => sum + Math.max(0, run.quantity), 0);
    // Keep the exact requested amount (bundle Min%–Max% of views), not the generator's rounded run sum.
    const total = Math.round(schedule.totalQuantity) > 0 ? Math.round(schedule.totalQuantity) : runSum;
    if (total <= 0) return schedule;
    const min = Math.max(1, minOrderFor(type, Math.floor(Number(minimums[type] ?? minimums[schedule.engagementType]) || 1)) ?? 1);
    // Organic weight of every Views run (bigger views run = bigger reaction run, with noise).
    const weights = viewRuns.map((run) => Math.max(1, run.quantity) * (0.6 + Math.random() * 0.8));
    const meanW = weights.reduce((a, b) => a + b, 0) / Math.max(1, weights.length);
    const sizes: { slot: number; qty: number }[] = [];

    // Generate random varying runs across all engagement types (shares, saves, reposts, comments, likes)
    // Every run is >= min (never below provider/user minimum) and has natural random variations
    const runQuantities = generateRandomVaryingRuns(total, min, slotCount);
    const targetRuns = runQuantities.length;

    // Pick which Views slots carry these reaction runs
    const chosenSlots = [...Array(slotCount).keys()]
      .map((slot) => ({ slot, key: Math.pow(Math.random(), meanW / Math.max(1, weights[slot])) }))
      .sort((a, b) => b.key - a.key)
      .slice(0, targetRuns)
      .map((x) => x.slot)
      .sort((a, b) => a - b);

    runQuantities.forEach((qty, i) => {
      sizes.push({ slot: chosenSlots[i] ?? (i % slotCount), qty });
    });

    // 4) Time each run after its Views run and before the next one.
    const template = schedule.runs[0];
    let previousTime = -Infinity;
    const bySlot = new Map<number, number[]>();
    sizes.forEach((s, idx) => bySlot.set(s.slot, [...(bySlot.get(s.slot) ?? []), idx]));
    const times: number[] = new Array(sizes.length);
    bySlot.forEach((indexes, slot) => {
      const from = viewTimes[slot];
      const to = slot < slotCount - 1 ? viewTimes[slot + 1] : from + tailMs;
      const span = Math.max(60_000, to - from);
      const points = indexes
        .map(() => from + span * (0.1 + Math.random() * 0.8))
        .sort((a, b) => a - b);
      indexes.forEach((idx, k) => { times[idx] = points[k]; });
    });

    const coordinatedRuns: OrganicRunConfig[] = sizes
      .map((s, idx) => ({ ...s, time: times[idx] }))
      .sort((a, b) => a.time - b.time)
      .map((s, index) => {
        const time = Math.max(s.time, previousTime + 60_000);
        previousTime = time;
        const scheduledAt = new Date(time);
        return {
          ...template,
          runNumber: index + 1,
          scheduledAt,
          quantity: s.qty,
          baseQuantity: s.qty,
          varianceApplied: 0,
          dayOfWeek: scheduledAt.getDay(),
          hourOfDay: scheduledAt.getHours(),
        };
      });

    return {
      ...schedule,
      totalQuantity: total,
      runs: coordinatedRuns,
      totalDuration: coordinatedRuns.length > 1
        ? coordinatedRuns[coordinatedRuns.length - 1].scheduledAt.getTime() - coordinatedRuns[0].scheduledAt.getTime()
        : 0,
      warnings: [...schedule.warnings, 'Follows the Views curve: each run is sized by the views delivered just before it'],
    };
  });
}

// Provider minimum order quantity FALLBACKS (actual values come from service table via minQuantity prop)
// These are last-resort defaults only — real min comes from DB service.min_quantity
export const PROVIDER_MINIMUMS: Record<string, number> = {
  views: 101,
  likes: 2,
  comments: 1,
  reposts: 1,
  saves: 10,
  shares: 2,
};

// Provider maximum order quantity
export const PROVIDER_MAXIMUMS: Record<string, number> = {
  views: 10000000,    // 10M
  likes: 500000,      // 500K
  comments: 100000,   // 100K
  saves: 50000,       // 50K
  shares: 100000,     // 100K
};

// ULTRA ORGANIC: Longer intervals spread across more time for natural delivery
// Each type has wildly different timing to look completely natural
const TYPE_BASE_INTERVALS: Record<string, { min: number; max: number; jitter: number; chaosMultiplier: number }> = {
  views: { min: 15, max: 120, jitter: 40, chaosMultiplier: 2.2 },     // Views: spread out, natural gaps
  likes: { min: 25, max: 180, jitter: 50, chaosMultiplier: 2.5 },     // Likes: very unpredictable
  comments: { min: 60, max: 360, jitter: 80, chaosMultiplier: 3.0 },  // Comments: extremely sparse
  saves: { min: 90, max: 480, jitter: 100, chaosMultiplier: 3.2 },    // Saves: very sparse and chaotic
  shares: { min: 50, max: 240, jitter: 60, chaosMultiplier: 2.8 },    // Shares: medium chaos
};

// ORGANIC BATCH SIZES - realistic human-like quantities per run
// Views: real humans see 100-300 views in organic bursts, NOT 1000+
// KEY: Keep ranges tight enough to look human, wide enough for variance
const TYPE_RUN_SIZE: Record<string, { min: number; max: number; variance: number; spikeMax: number; maxMultiplier: number; hardCap: number }> = {
  views: { min: 100, max: 250, variance: 0.65, spikeMax: 350, maxMultiplier: 2.5, hardCap: 400 },     // Views: 100-350 range (human-like)
  likes: { min: 10, max: 45, variance: 0.70, spikeMax: 80, maxMultiplier: 4.0, hardCap: 100 },        // Likes: small batches
  comments: { min: 10, max: 20, variance: 0.60, spikeMax: 35, maxMultiplier: 3.0, hardCap: 50 },      // Comments: very small
  saves: { min: 10, max: 25, variance: 0.65, spikeMax: 45, maxMultiplier: 3.0, hardCap: 60 },         // Saves: small
  shares: { min: 10, max: 30, variance: 0.68, spikeMax: 55, maxMultiplier: 3.5, hardCap: 70 },        // Shares: small
};

/**
 * DYNAMIC SCALING: For large orders (50K+), scale up batch sizes to keep runs manageable.
 * Without this, 600K views at 250/run = 2400 runs which hits the 500 cap.
 * Target: ~150-300 runs for ANY quantity for optimal organic delivery.
 */
function getScaledRunSize(
  engagementType: string,
  totalQuantity: number,
  providerMin: number
): { min: number; max: number; spikeMax: number; ultraMax: number } {
  const base = TYPE_RUN_SIZE[engagementType] || { min: 10, max: 50, spikeMax: 150, maxMultiplier: 2.5, hardCap: 200 };

  // Use hardCap as absolute maximum - never exceed this per run
  const hardCap = (base as any).hardCap || 400;

  // Dynamic max relative to providerMin, but NEVER exceeds hardCap
  const dynamicMax = Math.min(hardCap, Math.max(base.max, Math.round(providerMin * (base.maxMultiplier || 2.5))));
  const dynamicSpikeMax = Math.min(hardCap, Math.max(base.spikeMax, Math.round(dynamicMax * 1.3)));

  // Target 150-300 runs for organic feel
  const targetRuns = 250;
  const idealBatchSize = Math.ceil(totalQuantity / targetRuns);

  // Scale thresholds per type
  const scaleThresholds: Record<string, number> = {
    views: 50000,    // Scale up after 50K
    likes: 5000,     // Scale up after 5K
    comments: 500,   // Scale up after 500
    saves: 1000,     // Scale up after 1K
    shares: 2000,    // Scale up after 2K
  };

  const threshold = scaleThresholds[engagementType] || 10000;

  if (totalQuantity <= threshold) {
    return {
      min: Math.max(base.min, providerMin),
      max: dynamicMax,
      spikeMax: dynamicSpikeMax,
      ultraMax: Math.min(hardCap, dynamicMax * 1.2),
    };
  }

  // DYNAMIC SCALING for large orders - still respects hardCap
  const scaleFactor = Math.max(1, totalQuantity / threshold);
  const sqrtScale = Math.sqrt(scaleFactor); // Gentle scaling curve

  const scaledMin = Math.max(providerMin, Math.round(base.min * sqrtScale));
  // Scale up but NEVER exceed hardCap
  const scaledMax = Math.min(hardCap * 1.5, Math.round(dynamicMax * sqrtScale));
  const scaledSpikeMax = Math.min(hardCap * 2, Math.round(dynamicSpikeMax * sqrtScale));
  // Ultra max for finishing large orders, but still capped
  const ultraMax = Math.min(hardCap * 2.5, Math.max(scaledMax * 1.5, Math.ceil(totalQuantity / 400)));

  return {
    min: scaledMin,
    max: scaledMax,
    spikeMax: scaledSpikeMax,
    ultraMax,
  };
}

// VERY WIDE initial delays - types start at completely different times
const TYPE_START_DELAYS: Record<string, { min: number; max: number }> = {
  views: { min: 1, max: 25 },        // Views: quick start, random
  likes: { min: 8, max: 90 },        // Likes: delayed, very random
  comments: { min: 20, max: 180 },   // Comments: much later
  saves: { min: 40, max: 280 },      // Saves: very late start
  shares: { min: 25, max: 200 },     // Shares: wide range
};

// CHAOTIC S-Curve profiles - more extreme spikes and dips
const TYPE_CURVE_PROFILES: Record<string, {
  rampUpPercent: number;
  peakPercent: number;
  declinePercent: number;
  viralChance: number;     // Higher = more viral spikes
  dipChance: number;       // Higher = more natural dips  
  microPauseChance: number; // Chance of short pause/gap
  megaSpikeChance: number;  // Chance of huge viral spike
}> = {
  views: { rampUpPercent: 12, peakPercent: 55, declinePercent: 33, viralChance: 0.18, dipChance: 0.12, microPauseChance: 0.08, megaSpikeChance: 0.04 },
  likes: { rampUpPercent: 20, peakPercent: 48, declinePercent: 32, viralChance: 0.15, dipChance: 0.15, microPauseChance: 0.10, megaSpikeChance: 0.03 },
  comments: { rampUpPercent: 30, peakPercent: 38, declinePercent: 32, viralChance: 0.08, dipChance: 0.20, microPauseChance: 0.15, megaSpikeChance: 0.02 },
  saves: { rampUpPercent: 35, peakPercent: 32, declinePercent: 33, viralChance: 0.05, dipChance: 0.22, microPauseChance: 0.18, megaSpikeChance: 0.01 },
  shares: { rampUpPercent: 25, peakPercent: 42, declinePercent: 33, viralChance: 0.12, dipChance: 0.18, microPauseChance: 0.12, megaSpikeChance: 0.025 },
};

// DEEP RANDOM: Day of week patterns (real engagement varies by day)
const DAY_OF_WEEK_MULTIPLIERS: Record<string, number[]> = {
  // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
  views: [1.3, 0.85, 0.9, 0.95, 1.0, 1.15, 1.35],    // Weekend heavy
  likes: [1.25, 0.8, 0.88, 0.92, 0.98, 1.1, 1.28],   // Weekend heavy
  comments: [1.1, 0.75, 0.85, 0.9, 0.95, 1.05, 1.15], // Slight weekend boost
  saves: [1.0, 0.9, 0.95, 0.98, 1.0, 1.02, 1.05],    // Fairly consistent
  shares: [1.2, 0.78, 0.85, 0.9, 0.95, 1.1, 1.25],   // Weekend heavy for shares
};

// DEEP RANDOM: Hourly patterns with micro-variations
// Each hour has a BASE multiplier plus random micro-adjustments
const TYPE_DAILY_PATTERNS: Record<string, number[]> = {
  views: [
    0.18, 0.12, 0.08, 0.07, 0.12, 0.28,   // 0-5 AM (deep night)
    0.48, 0.68, 0.82, 0.93, 0.98, 1.08,   // 6-11 AM (morning)
    0.98, 0.88, 0.83, 0.88, 0.93, 1.08,   // 12-5 PM (afternoon)
    1.38, 1.58, 1.72, 1.52, 1.18, 0.68,   // 6-11 PM (PEAK evening)
  ],
  likes: [
    0.13, 0.08, 0.06, 0.06, 0.10, 0.23,   // 0-5 AM
    0.38, 0.58, 0.73, 0.83, 0.93, 1.03,   // 6-11 AM
    0.93, 0.83, 0.78, 0.83, 0.88, 0.98,   // 12-5 PM
    1.28, 1.48, 1.63, 1.58, 1.28, 0.78,   // 6-11 PM
  ],
  comments: [
    0.08, 0.06, 0.04, 0.04, 0.08, 0.18,   // 0-5 AM
    0.33, 0.48, 0.63, 0.73, 0.83, 0.93,   // 6-11 AM
    0.88, 0.78, 0.73, 0.78, 0.83, 0.93,   // 12-5 PM
    1.18, 1.38, 1.53, 1.68, 1.48, 0.88,   // 6-11 PM (PEAK later)
  ],
  saves: [
    0.28, 0.23, 0.18, 0.18, 0.23, 0.33,   // 0-5 AM
    0.48, 0.58, 0.68, 0.78, 0.88, 0.98,   // 6-11 AM
    0.93, 0.88, 0.83, 0.88, 0.93, 0.98,   // 12-5 PM
    1.13, 1.23, 1.28, 1.23, 1.08, 0.68,   // 6-11 PM (mild peak)
  ],
  shares: [
    0.10, 0.06, 0.04, 0.04, 0.08, 0.18,   // 0-5 AM
    0.38, 0.53, 0.68, 0.83, 0.98, 1.18,   // 6-11 AM
    1.28, 1.08, 0.88, 0.83, 0.88, 0.98,   // 12-5 PM (lunch peak)
    1.33, 1.53, 1.58, 1.43, 1.18, 0.73,   // 6-11 PM (evening peak)
  ],
};

// CHAOTIC session types - humans have very unpredictable patterns
const SESSION_TYPES = ['megaBurst', 'burst', 'normal', 'slow', 'pause', 'deadZone'] as const;
const SESSION_PROBABILITIES: Record<string, Record<typeof SESSION_TYPES[number], number>> = {
  views: { megaBurst: 0.06, burst: 0.18, normal: 0.48, slow: 0.18, pause: 0.07, deadZone: 0.03 },
  likes: { megaBurst: 0.04, burst: 0.15, normal: 0.45, slow: 0.22, pause: 0.10, deadZone: 0.04 },
  comments: { megaBurst: 0.02, burst: 0.08, normal: 0.40, slow: 0.30, pause: 0.15, deadZone: 0.05 },
  saves: { megaBurst: 0.02, burst: 0.06, normal: 0.38, slow: 0.32, pause: 0.16, deadZone: 0.06 },
  shares: { megaBurst: 0.03, burst: 0.12, normal: 0.42, slow: 0.25, pause: 0.13, deadZone: 0.05 },
};

// EXTREME session multipliers for visible chart chaos
const SESSION_MULTIPLIERS: Record<typeof SESSION_TYPES[number], { interval: number; quantity: number }> = {
  megaBurst: { interval: 0.2, quantity: 3.0 },   // Very fast, huge batches (viral moment)
  burst: { interval: 0.35, quantity: 2.0 },      // Fast intervals, big batches
  normal: { interval: 1.0, quantity: 1.0 },      // Normal behavior
  slow: { interval: 2.2, quantity: 0.6 },        // Long intervals, smaller batches
  pause: { interval: 4.0, quantity: 0.35 },      // Long gap, tiny batch
  deadZone: { interval: 8.0, quantity: 0.2 },    // Very long gap (user sleeping/busy)
};

/**
 * Generate a random session type based on engagement type probabilities
 */
function getRandomSessionType(engagementType: string): typeof SESSION_TYPES[number] {
  const probs = SESSION_PROBABILITIES[engagementType] || SESSION_PROBABILITIES.views;
  const rand = Math.random();
  let cumulative = 0;

  for (const type of SESSION_TYPES) {
    cumulative += probs[type];
    if (rand < cumulative) return type;
  }
  return 'normal';
}

/**
 * Calculate human behavior score (0-100) for anti-detection analysis
 * Higher scores = more human-like behavior
 */
function calculateHumanScore(
  quantity: number,
  interval: number,
  hour: number,
  dayOfWeek: number,
  sessionType: typeof SESSION_TYPES[number],
  engagementType: string
): number {
  let score = 50; // Base score

  // Penalize consistent quantities
  const avgBatch = (TYPE_RUN_SIZE[engagementType]?.min || 10 + TYPE_RUN_SIZE[engagementType]?.max || 100) / 2;
  const quantityVariance = Math.abs(quantity - avgBatch) / avgBatch;
  score += quantityVariance * 20; // More variance = more human

  // Reward natural hour patterns
  const hourPattern = TYPE_DAILY_PATTERNS[engagementType] || TYPE_DAILY_PATTERNS.views;
  if (hourPattern[hour] > 1.0) score += 10; // Peak hour activity
  if (hour >= 2 && hour <= 5 && quantity < avgBatch) score += 15; // Low night activity

  // Reward weekend/weekday consistency
  const dayMultiplier = DAY_OF_WEEK_MULTIPLIERS[engagementType]?.[dayOfWeek] || 1.0;
  if ((dayOfWeek === 0 || dayOfWeek === 6) && dayMultiplier > 1.0) score += 8;

  // Session type affects score
  if (sessionType === 'pause') score += 12; // Pauses are very human
  if (sessionType === 'burst') score += 5;  // Bursts happen naturally

  // Interval randomness
  const baseInterval = TYPE_BASE_INTERVALS[engagementType]?.min || 30;
  const intervalVariance = Math.abs(interval - baseInterval) / baseInterval;
  score += Math.min(intervalVariance * 15, 15);

  return Math.min(100, Math.max(0, score));
}

function pickUniqueQuantity(
  preferredQuantity: number,
  minQuantity: number,
  maxQuantity: number,
  usedQuantities: Set<number>,
  previousQuantity?: number | null
): number {
  const safeMin = Math.round(Math.min(minQuantity, maxQuantity));
  const safeMax = Math.round(Math.max(minQuantity, maxQuantity));
  const preferred = Math.round(Math.max(safeMin, Math.min(safeMax, preferredQuantity)));
  const minGap = previousQuantity != null
    ? Math.max(2, Math.floor(Math.max(safeMin, previousQuantity) * 0.02))
    : 0;

  let fallback = preferred;

  for (let step = 0; step <= safeMax - safeMin; step++) {
    const candidates = step === 0 ? [preferred] : [preferred + step, preferred - step];

    for (const candidate of candidates) {
      if (candidate < safeMin || candidate > safeMax) continue;

      const isDuplicate = usedQuantities.has(candidate);
      const isTooClose = previousQuantity != null && Math.abs(candidate - previousQuantity) < minGap;
      const isRoundNumber = candidate % 5 === 0 && candidate !== safeMin;

      if (!isDuplicate && !isTooClose && !isRoundNumber) {
        return candidate;
      }

      if (!isDuplicate && !isTooClose && fallback === preferred) {
        fallback = candidate;
      } else if (!isDuplicate && fallback === preferred) {
        fallback = candidate;
      }
    }
  }

  return fallback;
}

function finalizeUniqueRuns(
  runs: OrganicRunConfig[],
  totalQuantity: number,
  minQuantity: number,
  maxQuantity: number
): OrganicRunConfig[] {
  if (runs.length <= 1) return runs;

  const adjustedRuns = runs.map((run) => ({ ...run }));
  const hardMax = Math.max(minQuantity, maxQuantity);
  const usedQuantities = new Set<number>();

  adjustedRuns.forEach((run, index) => {
    const previousQuantity = index > 0 ? adjustedRuns[index - 1].quantity : undefined;
    run.quantity = pickUniqueQuantity(run.quantity, minQuantity, hardMax, usedQuantities, previousQuantity);
    usedQuantities.add(run.quantity);
  });

  let drift = totalQuantity - adjustedRuns.reduce((sum, run) => sum + run.quantity, 0);
  let guard = 0;

  while (drift !== 0 && guard < 10000) {
    let changed = false;
    const candidateIndexes = adjustedRuns
      .map((run, index) => ({ index, quantity: run.quantity }))
      .sort((a, b) => (drift > 0 ? a.quantity - b.quantity : b.quantity - a.quantity))
      .map((item) => item.index);

    for (const index of candidateIndexes) {
      const step = drift > 0 ? 1 : -1;
      const candidateQuantity = adjustedRuns[index].quantity + step;
      const previousQuantity = index > 0 ? adjustedRuns[index - 1].quantity : undefined;

      if (candidateQuantity < minQuantity || candidateQuantity > hardMax) continue;
      if (adjustedRuns.some((run, runIndex) => runIndex !== index && run.quantity === candidateQuantity)) continue;
      if (previousQuantity != null && Math.abs(candidateQuantity - previousQuantity) < 2) continue;

      adjustedRuns[index].quantity = candidateQuantity;
      drift += drift > 0 ? -1 : 1;
      changed = true;

      if (drift === 0) break;
    }

    if (!changed) break;
    guard++;
  }

  if (drift !== 0 && adjustedRuns.length > 0) {
    adjustedRuns[adjustedRuns.length - 1].quantity += drift;
  }

  adjustedRuns.forEach((run) => {
    run.baseQuantity = run.quantity;
    run.varianceApplied = 0;
  });

  return adjustedRuns;
}

/**
 * Generate fully organic schedule for a single engagement type
 * Each type has completely independent, randomized timing
 * CRITICAL: All batches MUST be >= provider minimum (10)
 * NEW: Supports time limit constraint for user-specified delivery duration
 */
export function generateOrganicSchedule(
  engagementType: string,
  totalQuantity: number,
  variancePercent: number,
  peakEnabled: boolean,
  startTime: Date,
  serviceMinimum?: number,
  timeLimitHours?: number, // NEW: Optional time limit in hours
  forcedRunCount?: number   // NEW: User-specified exact run count
): FullOrganicConfig {
  // FORCED RUN COUNT BRANCH: user explicitly chose how many runs
  if (forcedRunCount && forcedRunCount > 0) {
    return generateForcedRunCountSchedule(
      engagementType,
      totalQuantity,
      forcedRunCount,
      variancePercent,
      startTime,
      serviceMinimum,
      timeLimitHours,
    );
  }

  const runs: OrganicRunConfig[] = [];
  const warnings: string[] = [];
  let patternBreakCount = 0;

  const providerMin = serviceMinimum || PROVIDER_MINIMUMS[engagementType] || 10;
  const typeIntervalConfig = TYPE_BASE_INTERVALS[engagementType] || { min: 40, max: 100, jitter: 15, chaosMultiplier: 2.5 };
  let typeInterval = { min: typeIntervalConfig.min, max: typeIntervalConfig.max };
  const typeRunSizeConfig = TYPE_RUN_SIZE[engagementType] || { min: 10, max: 50, variance: 0.4, spikeMax: 150 };

  // DYNAMIC SCALING: scale batch sizes for large orders
  const scaled = getScaledRunSize(engagementType, totalQuantity, providerMin);
  let typeRunSize = { min: scaled.min, max: scaled.max };
  const jitterAmount = typeIntervalConfig.jitter || 10;

  // Ensure minimum batch size respects provider minimum
  const effectiveMinBatch = Math.max(typeRunSize.min, providerMin);

  // DYNAMIC ULTRA MAX: scales with order size (no longer static 250 for views!)
  const ULTRA_MAX_PER_RUN: Record<string, number> = {
    views: scaled.ultraMax,
    likes: scaled.ultraMax,
    comments: scaled.ultraMax,
    saves: scaled.ultraMax,
    shares: scaled.ultraMax,
  };

  // NEW: Calculate time-constrained intervals if time limit is specified
  if (timeLimitHours && timeLimitHours > 0) {
    const timeLimitMinutes = timeLimitHours * 60;

    // Calculate how many runs we'll need with current batch sizes
    const avgBatchSize = (effectiveMinBatch + typeRunSize.max) / 2;
    const estimatedRuns = Math.ceil(totalQuantity / avgBatchSize);

    // Calculate what interval we need to fit within time limit
    // Leave some buffer (15%) for variance and jitter
    const availableMinutes = timeLimitMinutes * 0.85;
    const requiredInterval = availableMinutes / Math.max(estimatedRuns - 1, 1);

    // Adjust intervals to fit time limit while keeping randomness
    const intervalVariation = Math.min(requiredInterval * 0.3, 15);
    typeInterval = {
      min: Math.max(5, requiredInterval - intervalVariation),
      max: Math.max(10, requiredInterval + intervalVariation),
    };

    // If time is very tight, increase batch sizes to reduce number of runs
    if (requiredInterval < 15) {
      const minBatchForTime = Math.ceil(totalQuantity / (estimatedRuns * 0.5));
      typeRunSize = {
        min: Math.max(effectiveMinBatch, Math.min(minBatchForTime, 100)),
        max: Math.max(typeRunSize.max, Math.min(minBatchForTime * 2, 500)),
      };
      warnings.push(`Increased batch sizes to meet ${timeLimitHours}h time limit`);
    }

    warnings.push(`Time-constrained: ~${Math.round(requiredInterval)}min intervals for ${timeLimitHours}h delivery`);
  }

  // Check if total quantity is too low for organic pattern
  // For organic behavior, even small quantities should have 2-3 runs when possible
  if (totalQuantity < providerMin) {
    warnings.push(`Total quantity ${totalQuantity} is below provider minimum ${providerMin}`);
    const now = startTime;
    const istOffset = usPeakOffsetMs();
    const istTime = new Date(now.getTime() + istOffset);

    runs.push({
      runNumber: 1,
      scheduledAt: startTime,
      quantity: totalQuantity,
      baseQuantity: totalQuantity,
      varianceApplied: 0,
      peakMultiplier: 1.0,
      dayOfWeek: istTime.getUTCDay(),
      hourOfDay: istTime.getUTCHours(),
      sessionType: 'normal',
      humanBehaviorScore: 60,
      patternBreaker: false,
    });

    return {
      engagementType,
      totalQuantity,
      runs,
      totalDuration: 0,
      warnings,
      patternBreakCount: 0,
      avgHumanScore: 60,
      varietyIndex: 0,
    };
  }

  // Small-quantity organic mode (still respects provider minimum)
  const maxRunsByMin = Math.floor(totalQuantity / providerMin);

  // Get type delays early (used by both small + normal modes)
  const typeDelays = TYPE_START_DELAYS[engagementType] || { min: 5, max: 40 };

  // For totals up to 25x the provider minimum, we use a denser splitting logic
  const shouldSmallQuantitySplit = maxRunsByMin >= 2 && totalQuantity < providerMin * 25;
  if (shouldSmallQuantitySplit) {
    // Generate random varying runs: each >= providerMin, sum === totalQuantity, naturally varied
    const runQuantities = generateRandomVaryingRuns(totalQuantity, providerMin, Math.min(8, maxRunsByMin));
    const numRuns = runQuantities.length;

    const istOffset = usPeakOffsetMs();

    // Interval based on time limit or type defaults
    const targetIntervalMinutes = timeLimitHours && timeLimitHours > 0
      ? (timeLimitHours * 60 * 0.8) / Math.max(1, numRuns - 1)
      : typeInterval.min + Math.random() * (typeInterval.max - typeInterval.min);

    for (let i = 0; i < numRuns; i++) {
      const batchQty = runQuantities[i];

      // Schedule time with jitter
      let scheduleTime: Date;
      if (i === 0) {
        const initialDelay = (typeDelays.min + Math.random() * (typeDelays.max - typeDelays.min)) * 60 * 1000;
        scheduleTime = new Date(startTime.getTime() + initialDelay);
      } else {
        const prevTime = runs[runs.length - 1].scheduledAt;
        const intervalMs = Math.max(60_000, targetIntervalMinutes * 60 * 1000);
        const jitterMs = (Math.random() - 0.5) * intervalMs * 0.4;
        scheduleTime = new Date(prevTime.getTime() + intervalMs + jitterMs);
      }

      const istTime = new Date(scheduleTime.getTime() + istOffset);

      runs.push({
        runNumber: i + 1,
        scheduledAt: scheduleTime,
        quantity: batchQty,
        baseQuantity: batchQty,
        varianceApplied: 0,
        peakMultiplier: 1.0,
        dayOfWeek: istTime.getUTCDay(),
        hourOfDay: istTime.getUTCHours(),
        sessionType: i === 0 ? "burst" : (Math.random() > 0.55 ? "norm