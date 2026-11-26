import type { ReactNode } from 'react';

interface SubscriptionGuardProps {
  children: ReactNode;
}

/**
 * Boostly no longer requires a paid subscription for provider, bundle or order tools.
 * Authentication, resource ownership and administrator permissions remain unchanged.
 */
export function SubscriptionGuard({ children }: SubscriptionGuardProps) {
  return <>{children}</>;
}

export default SubscriptionGuard;
