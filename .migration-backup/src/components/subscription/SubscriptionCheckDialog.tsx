import { Link } from 'react-router-dom';
import { useSubscription } from '@/hooks/useSubscription';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Lock, Clock, ArrowRight, Sparkles } from 'lucide-react';

interface SubscriptionCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SubscriptionCheckDialog({ open, onOpenChange }: SubscriptionCheckDialogProps) {
  const { hasPendingRequest } = useSubscription();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            Subscription Required
          </DialogTitle>
          <DialogDescription>
            Choose Monthly, Yearly or Lifetime to unlock providers, bundles and orders.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <p className="text-sm font-semibold text-foreground/80">
            Pay with Crypto (OxaPay), UPI (ZapUPI), or request manual admin activation.
          </p>
        </div>

        {hasPendingRequest && (
          <div className="p-4 rounded-xl bg-warning/10 border border-warning/30">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-warning" />
              <div>
                <p className="font-medium text-warning">Request Pending</p>
                <p className="text-sm text-foreground/80">
                  Your manual activation request is being reviewed.
                </p>
              </div>
            </div>
          </div>
        )}

        <Button asChild className="w-full btn-gradient rounded-xl py-5 text-base">
          <Link to="/subscription" onClick={() => onOpenChange(false)}>
            View Plans & Subscribe
            <ArrowRight className="h-4 w-4 ml-2" />
          </Link>
        </Button>

        <button
          onClick={() => onOpenChange(false)}
          className="text-sm text-muted-foreground hover:text-foreground mx-auto"
        >
          ← Continue browsing
        </button>
      </DialogContent>
    </Dialog>
  );
}
