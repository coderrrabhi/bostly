import { Button } from '@/components/ui/button';
import { Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  title?: string;
  description?: string;
}

export function NoBundleEmptyState({
  title = 'No bundles yet',
  description = 'To use this page, first add your provider and create a bundle. Order options, engagement types, and pricing all come from your bundle.',
}: Props) {
  const navigate = useNavigate();
  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="glass-card border-2 border-dashed border-border rounded-2xl p-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
          <Package className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{description}</p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button onClick={() => navigate('/my-bundles')} className="btn-3d">
            <Package className="h-4 w-4 mr-2" /> Create Bundle
          </Button>
          <Button variant="outline" onClick={() => navigate('/my-providers')}>
            Add Provider
          </Button>
        </div>
      </div>
    </div>
  );
}
