import { describe, it, expect } from 'vitest';
import { defaultRatios, ratioRange, fillRatios, demoTiming, shapedQuantity } from './demo-planning';
describe('safe demo planning', () => {
  const examples = [ ['Likes', 210, 500], ['Shares', 10, 50], ['Saves', 20, 60], ['Comments', 3, 20], ['Reposts', 3, 25] ] as const;
  for (const [type, min, max] of examples) it(`${type} matches uploaded percentages at 10,000 views`, () => {
    expect(ratioRange('10000', defaultRatios[type].min, defaultRatios[type].max)).toEqual({ min, max });
  });
  it('fills lower and upper boundaries without exceeding ranges', () => {
    expect(fillRatios('10000', defaultRatios, () => 0).Likes).toBe('210');
    expect(fillRatios('10000', defaultRatios, () => .999999).Reposts).toBe('25');
  });
  it('does not fabricate an integer outside a fractional range', () => {
    expect(() => fillRatios('120', defaultRatios)).toThrow('no whole quantity');
    expect(() => ratioRange('1000', '5', '2')).toThrow();
  });
  it('calculates demo-only auto timeframe and custom 6 hours as 18 runs', () => {
    expect(demoTiming('1000', 1).hours).toBe(2.5);
    expect(demoTiming('5000', 1).hours).toBe(6);
    expect(demoTiming('10000', 1).hours).toBe(10);
    expect(demoTiming('10000', 1, '6')).toEqual({ hours: 6, runs: 18, intervalMinutes: 20 });
  });
  it('preserves totals and configured minima for all local curves', () => {
    for (let p = 0; p < 10; p++) {
      const result = shapedQuantity('1000', '101', 18, p, 7);
      expect(result.runs.every(v => v >= 101 && Number.isInteger(v))).toBe(true);
      expect(result.runs.reduce((a,b) => a+b,0)).toBe(1000);
    }
    expect(shapedQuantity('3', '4', 5, 0, 1).error).toBeTruthy();
    expect(shapedQuantity('11', '4', 5, 0, 1).runs.reduce((a,b)=>a+b,0)).toBe(11);
  });
});