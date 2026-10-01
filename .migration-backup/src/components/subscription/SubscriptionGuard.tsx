import { Link } from 'react-router-dom';
import { useSubscription } from '@/hooks/useSubscription';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, Clock, ArrowRight } from 'lucide-react';

interface SubscriptionGuardProps {
  children: React.ReactNode;
}

export function SubscriptionGuard({ children }: SubscriptionGuardProps) {
  const { hasActiveSubscription, hasPendingRequest, isLoading } = useSubscription();

  if (isLoading) return <>{children}</>;
  if (hasActiveSubscription) return <>{children}</>;

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="glass-card max-w-lg w-full">
        <CardContent className="p-6 sm:p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-4">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Subscription Required</h2>
          <p className="text-muted-foreground mb-6">
            An active subscription is required to add providers, create bundles and place orders.
            Choose Monthly, Yearly or Lifetime — pay with Crypto (OxaPay), UPI (ZapUPI), or request manual activation.
          </p>

          {hasPendingRequest && (
            <div className="mb-6 p-4 rounded-xl bg-warning/10 border border-warning/30 text-left">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-warning" />
                <div>
                  <p className="font-medium text-warning">Request Pending</p>
                  <p className="text-sm text-muted-foreground">
                    Your manual activation request is being reviewed by admin.
                  </p>
                </div>
              </div>
            </div>
          )}

          <Button asChild className="w-full btn-gradient rounded-full py-6 text-lg">
            <Link to="/subscription">
              View Plans & Subscribe
              <ArrowRight className="h-5 w-5 ml-2" />
            </Link>
          </Button>

          <div className="mt-4">
            <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              ← Back to Dashboard
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
