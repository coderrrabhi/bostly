export const engagementTypes = ['Views', 'Likes', 'Comments', 'Shares', 'Saves', 'Reposts'] as const;
export type Engagement = typeof engagementTypes[number];
export type DemoValues = Record<Engagement, string>;
export const demoMinimums: DemoValues = { Views: '101', Likes: '2', Comments: '1', Shares: '2', Saves: '10', Reposts: '1' };
export const demoQuantities: DemoValues = { Views: '1000', Likes: '20', Comments: '0', Shares: '10', Saves: '20', Reposts: '5' };
export const countComments = (text: string) => text.split(/\r?\n/).filter(line => line.trim()).length;
export function simulateQuantity(quantity: string, minimum: string, requestedRuns: number) {
  const total = Number(quantity), min = Number(minimum);
  if (!quantity.trim() || !Number.isSafeInteger(total) || total < 0 || total > 1_000_000) return { error: 'Enter a whole quantity from 0 to 1,000,000.', runs: [] as number[] };
  if (!minimum.trim() || !Number.isSafeInteger(min) || min < 1 || min > 1_000_000) return { error: 'Minimum must be a whole number from 1 to 1,000,000.', runs: [] as number[] };
  if (!Number.isInteger(requestedRuns) || requestedRuns < 1 || requestedRuns > 100) return { error: 'Runs must be between 1 and 100.', runs: [] as number[] };
  if (total === 0) return { error: null, runs: [] as number[] };
  if (total < min) return { error: `Blocked: ${total} is below minimum ${min}.`, runs: [] as number[] };
  const count = Math.min(requestedRuns, Math.floor(total / min));
  const base = Math.floor(total / count), remainder = total % count;
  return { error: null, runs: Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0)) };
}