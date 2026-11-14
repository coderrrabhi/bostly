import { useMemo } from "react";
import { format } from "date-fns";
import { Activity, Clock, RefreshCw, TrendingUp, Waves, Zap } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ENGAGEMENT_CONFIG, EngagementConfig, EngagementType } from "@/lib/engagement-types";
import {
  buildLiveGrowthPreview,
  formatPreviewDuration,
  type LivePreviewSchedules,
} from "@/lib/live-growth-preview";

type Platform = "instagram" | "tiktok" | "youtube" | "twitter" | "facebook";

interface LiveGrowthChartProps {
  engagements: Record<EngagementType, EngagementConfig>;
  previewSchedules?: LivePreviewSchedules;
  curveName?: string;
  refreshKey?: number;
  onRefresh?: () => void;
  platform?: Platform;
}

const TYPE_COLORS: Record<string, string> = {
  views: "#60a5fa",
  comments: "#93c5fd",
  likes: "#f472b6",
  saves: "#fbbf24",
  shares: "#a78bfa",
  reposts: "#34d399",
};

const FALLBACK_COLORS = ["#38bdf8", "#fb7185", "#facc15", "#c084fc", "#4ade80"];
const STROKE_DASH: Record<string, string | undefined> = {
  comments: "6 3",
  likes: "2 2",
  saves: "10 4",
  shares: "4 6",
  reposts: "8 3",
};

const colorFor = (type: string, index: number) => TYPE_COLORS[type] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
const labelFor = (type: string) => ENGAGEMENT_CONFIG[type as EngagementType]?.label ?? type.replace(/_/g, " ");
const emojiFor = (type: string) => ENGAGEMENT_CONFIG[type as EngagementType]?.emoji ?? "📈";
const compactNumber = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K` : String(value);

export function LiveGrowthChart({
  previewSchedules = {},
  curveName = "Selected curve",
  refreshKey = 0,
  onRefresh,
}: LiveGrowthChartProps) {
  const { chartData, stats, typeBreakdown, activeTypes } = useMemo(
    () => buildLiveGrowthPreview(previewSchedules),
    [previewSchedules, refreshKey],
  );

  return (
    <Card className="border-2 border-border bg-gradient-to-br from-background to-secondary/20 overflow-hidden">
      <CardHeader className="pb-2 px-3 sm:px-6">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-[190px]">
            <span className="text-foreground">Live Organic Growth Preview</span>
            <p className="text-xs text-muted-foreground font-normal mt-0.5">
              Selected curve • Exact planned runs and quantities
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onRefresh && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRefresh}
                className="h-8 px-3 gap-1.5 border-border hover:bg-secondary text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            )}
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary gap-1">
              <Waves className="h-3 w-3" />
              {curveName}
            </Badge>
          </div>
        </CardTitle>

        <div className="flex flex-wrap gap-2 mt-3">
          <Badge className="bg-primary text-primary-foreground font-bold gap-1">
            <Zap className="h-3 w-3" />
            {stats.totalEngagements.toLocaleString()} total
          </Badge>
          <Badge variant="outline" className="border-border text-foreground gap-1">
            <TrendingUp className="h-3 w-3" />
            {stats.totalRuns} runs
          </Badge>
          <Badge variant="outline" className="border-border text-foreground gap-1">
            <Clock className="h-3 w-3" />
            ~{formatPreviewDuration(stats.durationMs)}
          </Badge>
        </div>

        {typeBreakdown.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {typeBreakdown.map(({ type, quantity, runs }, index) => (
              <div
                key={type}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-secondary/50 border border-border"
                title={`${labelFor(type)}: ${quantity.toLocaleString()} in ${runs} runs`}
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colorFor(type, index) }} />
                <span className="text-xs">{emojiFor(type)}</span>
                <span className="text-xs font-bold text-foreground">{quantity.toLocaleString()}</span>
                <span className="text-[10px] text-muted-foreground">· {runs} runs</span>
              </div>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="p-3 sm:p-6">
        {chartData.length <= 1 ? (
          <div className="h-[240px] rounded-xl border border-dashed border-border bg-secondary/20 flex items-center justify-center px-6 text-center">
            <p className="text-sm text-muted-foreground">Your selected curve schedule is being calculated…</p>
          </div>
        ) : (
          <>
            <div className="h-[300px] sm:h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    {activeTypes.map((type, index) => (
                      <linearGradient key={type} id={`live-growth-${type}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={colorFor(type, index)} stopOpacity={0.45} />
                        <stop offset="55%" stopColor={colorFor(type, index)} stopOpacity={0.12} />
                        <stop offset="100%" stopColor={colorFor(type, index)} stopOpacity={0.01} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} vertical={false} />
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={9}
                    tickLine={false}
                    axisLine={false}
                    tickCount={6}
                    minTickGap={28}
                    tickFormatter={(timestamp) => format(new Date(Number(timestamp)), "HH:mm")}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    width={45}
                    tickFormatter={compactNumber}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const timestamp = Number(label);
                      return (
                        <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-xl">
                          <p className="text-xs text-muted-foreground mb-2 font-mono">
                            {Number.isFinite(timestamp) ? format(new Date(timestamp), "dd MMM, HH:mm") : String(label)}
                          </p>
                          {payload.filter((entry) => Number(entry.value) > 0).map((entry) => {
                            const type = String(entry.dataKey);
                            return (
                              <div key={type} className="flex items-center gap-2 text-sm">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: String(entry.color) }} />
                                <span>{emojiFor(type)}</span>
                                <span className="text-muted-foreground">{labelFor(type)}</span>
                                <span className="font-bold text-foreground ml-auto">{Number(entry.value).toLocaleString()}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }}
                  />
                  {activeTypes.map((type, index) => (
                    <Area
                      key={type}
                      type="linear"
                      dataKey={type}
                      stroke={colorFor(type, index)}
                      strokeDasharray={STROKE_DASH[type]}
                      strokeWidth={type === "views" ? 2.5 : 1.8}
                      fill={`url(#live-growth-${type})`}
                      fillOpacity={1}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: colorFor(type, index), fill: "hsl(var(--background))" }}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-4 pt-4 border-t border-border">
              {activeTypes.map((type, index) => (
                <div key={type} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colorFor(type, index) }} />
                  <span className="text-xs text-muted-foreground capitalize">{labelFor(type)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
