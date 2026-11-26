import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, Timer, CheckCircle2, Play, Clock, AlertTriangle, RefreshCw, TrendingUp, RotateCcw, Loader2, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { providerOrderIds } from "./providerOrderIds";

type RunListKey = "completed" | "started" | "pending";
const LIST_TITLES: Record<RunListKey, string> = { completed: "Completed", started: "In Progress", pending: "Pending" };

export function runToLine(r: any) {
  const type = String(r.engagement_type || "").replace(/^./, (c: string) => c.toUpperCase());
  const parts = [type, `Run #${r.run_number ?? "-"}`, `Qty ${Number(r.quantity_to_send || 0).toLocaleString()}`, `Status ${r.status}`];
  if (r.provider_order_id) parts.push(`Provider order ${r.provider_order_id}`);
  if (r.scheduled_at) parts.push(`Scheduled ${new Date(r.scheduled_at).toLocaleString()}`);
  return parts.join(" | ");
}

interface LiveStatsBoardProps {
  totalRuns: number;
  completedRuns: number;
  startedRuns: number;
  pendingRuns: number;
  failedRuns: number;
  totalDelivered: number;
  totalQuantity: number;
  nextRun?: { scheduled_at: string } | null;
  onRetryFailed?: () => void;
  isRetrying?: boolean;
  runLists?: Partial<Record<RunListKey, any[]>>;
  orderLabel?: string;
}

export function LiveStatsBoard({
  totalRuns,
  completedRuns,
  startedRuns,
  pendingRuns,
  failedRuns,
  totalDelivered,
  totalQuantity,
  nextRun,
  onRetryFailed,
  isRetrying = false,
  runLists,
}: LiveStatsBoardProps) {
  const [openList, setOpenList] = useState<RunListKey | null>(null);
  const listRuns = openList ? [...(runLists?.[openList] ?? [])].sort((a, b) =>
    new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()) : [];
  async function copyAll() {
    const ids = providerOrderIds(listRuns);
    if (!ids) { toast.error("No provider order numbers in this section yet"); return; }
    try { await navigator.clipboard.writeText(ids); toast.success(`Copied ${ids.split(",").length} provider order numbers`); }
    catch { toast.error("Copy failed - select the list and copy manually"); }
  }
  const tileProps = (key: RunListKey) => runLists ? {
    role: "button" as const, tabIndex: 0, title: `Show all ${LIST_TITLES[key]} orders`,
    onClick: () => setOpenList(key),
    onKeyDown: (e: any) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenList(key); } },
  } : {};
  const progressPercent = totalQuantity > 0 ? (totalDelivered / totalQuantity) * 100 : 0;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-background via-background to-secondary/20">
      {/* Decorative gradient orbs */}
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-foreground/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-primary/10 rounded-full blur-3xl" />
      
      {/* Header */}
      <div className="relative px-4 py-2.5 border-b border-border/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="absolute inset-0 animate-ping rounded-full bg-foreground/40"></span>
            <span className="relative flex h-3 w-3 rounded-full bg-foreground shadow-lg shadow-foreground/50"></span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/50 border border-border">
            <Zap className="h-3.5 w-3.5 text-foreground" />
            <span className="font-bold text-xs uppercase tracking-widest text-foreground">Live Tracking</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" style={{ animationDuration: '10s' }} />
            <span>Auto-updating</span>
          </div>
          {nextRun && (
            <Badge className="bg-secondary/50 text-foreground border-border px-3 py-1.5">
              <Timer className="h-4 w-4 mr-1.5" />
              Next: {new Date(nextRun.scheduled_at).getTime() <= Date.now() ? 'due now' : formatDistanceToNow(new Date(nextRun.scheduled_at))}
            </Badge>
          )}
        </div>
      </div>

      {/* Big Stats Grid */}
      <div className="relative grid grid-cols-3 sm:grid-cols-5 divide-x divide-border/50">
        {/* Total Runs */}
        <div className="p-3 text-center group hover:bg-secondary/30 transition-colors">
          <div className="w-8 h-8 mx-auto mb-1.5 rounded-lg bg-secondary/50 flex items-center justify-center border border-border">
            <TrendingUp className="h-4 w-4 text-foreground" />
          </div>
          <p className="text-2xl font-bold text-foreground leading-none mb-1">{totalRuns}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Total Runs</p>
        </div>

        {/* Completed */}
        <div {...tileProps("completed")} className="p-3 text-center group hover:bg-secondary/30 transition-colors cursor-pointer">
          <div className="w-8 h-8 mx-auto mb-1.5 rounded-lg bg-foreground/10 flex items-center justify-center border border-foreground/20">
            <CheckCircle2 className="h-4 w-4 text-foreground" />
          </div>
          <p className="text-2xl font-bold text-foreground leading-none mb-1">{completedRuns}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Completed</p>
        </div>

        {/* In Progress */}
        <div {...tileProps("started")} className="p-3 text-center group hover:bg-secondary/30 transition-colors cursor-pointer">
          <div className="w-8 h-8 mx-auto mb-1.5 rounded-lg bg-foreground/10 flex items-center justify-center border border-foreground/20">
            <Play className="h-4 w-4 text-foreground" />
          </div>
          <p className="text-2xl font-bold text-foreground leading-none mb-1">{startedRuns}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">In Progress</p>
        </div>

        {/* Pending */}
        <div {...tileProps("pending")} className="p-3 text-center group hover:bg-secondary/30 transition-colors cursor-pointer">
          <div className="w-8 h-8 mx-auto mb-1.5 rounded-lg bg-muted flex items-center justify-center border border-border">
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold text-foreground leading-none mb-1">{pendingRuns}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Pending</p>
        </div>

        {/* Delivered */}
        <div className="p-3 text-center group hover:bg-secondary/30 transition-colors">
          <div className="w-8 h-8 mx-auto mb-1.5 rounded-lg bg-foreground/10 flex items-center justify-center border border-foreground/20">
            <Zap className="h-4 w-4 text-foreground" />
          </div>
          <p className="text-2xl font-bold text-foreground leading-none mb-1">
            {totalDelivered.toLocaleString()}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">Delivered</p>
        </div>
      </div>

      {/* Failed Runs Warning with Retry Button */}
      {failedRuns > 0 && (
        <div className="mx-4 mt-3 bg-muted border border-border rounded-lg p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <span className="text-foreground font-bold">{failedRuns} runs failed</span>
              <p className="text-xs text-muted-foreground">Only safe, unaccepted failures can retry; late or uncertain orders stay stopped</p>
            </div>
          </div>
          {onRetryFailed && (
            <Button 
              onClick={onRetryFailed} 
              disabled={isRetrying}
              variant="outline"
              className="gap-2 border-primary/30 hover:bg-primary/10"
            >
              {isRetrying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Retry Safe Failed
            </Button>
          )}
        </div>
      )}

      {/* Overall Progress Bar */}
      <div className="relative p-3 sm:px-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-secondary/50 flex items-center justify-center border border-border">
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <span className="font-semibold text-foreground">Overall Progress</span>
          </div>
          <div className="text-right">
            <span className="text-lg font-bold text-foreground">
              {totalDelivered.toLocaleString()}
            </span>
            <span className="text-muted-foreground"> / {totalQuantity.toLocaleString()}</span>
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="relative h-2.5 bg-secondary/50 rounded-full overflow-hidden border border-border/50">
          <div 
            className="absolute inset-y-0 left-0 bg-foreground rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progressPercent}%` }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
          </div>
        </div>
        
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{completedRuns}</span> of {totalRuns} runs complete
          </span>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-secondary border border-border">
            <Zap className="h-4 w-4 text-foreground" />
            <span className="text-foreground font-bold">{progressPercent.toFixed(0)}% done</span>
          </div>
        </div>
      </div>
    <Dialog open={!!openList} onOpenChange={(o) => { if (!o) setOpenList(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{openList ? LIST_TITLES[openList] : ""} orders ({listRuns.length})</DialogTitle>
            <DialogDescription>Every run in this section. Copy all gives the provider order numbers, like 81701884,81704009,23173940.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button size="sm" onClick={copyAll} disabled={!listRuns.length}><Copy className="h-4 w-4 mr-1.5" />Copy all</Button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border divide-y divide-border">
            {listRuns.length ? listRuns.map((r) => (
              <div key={r.id} className="px-3 py-2 text-xs sm:text-sm text-foreground break-words select-text">{runToLine(r)}</div>
            )) : <p className="p-4 text-sm text-muted-foreground">No orders in this section</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
