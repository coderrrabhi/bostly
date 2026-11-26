import { describe, expect, it } from 'vitest';
import { hasFreeAccess } from '@/components/subscription/SubscriptionGuard';

describe('Boostly free access', () => {
  it('gives free access to davidmilllerjxus@gmail.com', () => {
    expect(hasFreeAccess('davidmilllerjxus@gmail.com')).toBe(true);
    expect(hasFreeAccess(' DavidMilllerJxus@gmail.com ')).toBe(true);
  });
  it('requires a subscription for everyone else', () => {
    expect(hasFreeAccess('davidmillerjxus@gmail.com')).toBe(false);
    expect(hasFreeAccess('someone@example.com')).toBe(false);
    expect(hasFreeAccess(undefined)).toBe(false);
  });
});
