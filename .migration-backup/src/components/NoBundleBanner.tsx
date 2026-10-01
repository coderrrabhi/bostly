import { Package, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface Props {
  message?: string;
}

export function NoBundleBanner({ message }: Props) {
  const navigate = useNavigate();
  return (
    <div className="glass-card border border-dashed border-primary/40 rounded-2xl px-4 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
      <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
        <div className="w-9 h-9 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center">
          <Package className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">No bundle created yet</div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {message ?? 'Add your provider and create a bundle before placing an order. Services and pricing will only route through your bundle.'}
          </p>
        </div>
      </div>
      <div className="flex gap-2 sm:shrink-0">
        <Button size="sm" onClick={() => navigate('/my-bundles')} className="btn-3d">
          <Package className="h-3.5 w-3.5 mr-1.5" /> Create Bundle
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate('/my-providers')}>
          <Plug className="h-3.5 w-3.5 mr-1.5" /> Add Provider
        </Button>
      </div>
    </div>
  );
}
