import { describe, expect, it } from 'vitest';
import { countComments, simulateQuantity } from './safe-demo';
describe('isolated demo quantities', () => {
  it('counts ten nonempty custom comments as ten comments', () => {
    expect(countComments(Array.from({ length: 10 }, (_, i) => `Comment ${i}`).join('\n') + '\n\n')).toBe(10);
  });
  it('never simulates views below configured 101', () => {
    expect(simulateQuantity('100', '101', 4).error).toBeTruthy();
    const result = simulateQuantity('1000', '101', 20);
    expect(result.runs.length).toBe(9);
    expect(result.runs.every(value => value >= 101)).toBe(true);
    expect(result.runs.reduce((sum, value) => sum + value, 0)).toBe(1000);
  });
  it('never simulates likes below customized 4', () => {
    expect(simulateQuantity('3', '4', 2).error).toBeTruthy();
    expect(simulateQuantity('11', '4', 5).runs).toEqual([6, 5]);
  });
  it('skips zero without generating an order', () => {
    expect(simulateQuantity('0', '4', 3).runs).toEqual([]);
  });
  it('rejects fractions, empty inputs, negative values, and invalid run counts', () => {
    for (const value of ['', '-1', '1.5', 'NaN']) expect(simulateQuantity(value, '1', 2).error).toBeTruthy();
    expect(simulateQuantity('10', '0', 2).error).toBeTruthy();
    expect(simulateQuantity('10', '1', 0).error).toBeTruthy();
  });
});