"use client"

import { Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { scoreBand, deriveMetrics } from "@/lib/channel-metrics"
import { formatNumber, formatExact } from "@/lib/format"
import type { YouTubeChannelData } from "@/services/youtube"

/**
 * The performance score, with enough context that a reader can decide whether
 * to trust it. The tooltip lists the arithmetic facts behind the channel —
 * never a fabricated percentile (see channel-metrics.ts).
 */
export function ScorePanel({
  score,
  channel,
  loading,
}: {
  score?: number
  channel: YouTubeChannelData
  loading?: boolean
}) {
  if (score === undefined) {
    return (
      <div className="text-center">
        <p className="text-2xl font-bold text-muted-foreground/50 tabular">
          {loading ? "…" : "—"}
        </p>
        <p className="label-caps">Score</p>
      </div>
    )
  }

  const band = scoreBand(score)
  const metrics = deriveMetrics(channel)

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Performance score ${score} out of 100 — ${band.label}. How is this calculated?`}
            className="group text-center rounded-lg px-2 py-1 -mx-2 -my-1 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <p className={cn("text-2xl font-bold tabular", band.text)}>
              {score}
              <span className="text-sm font-medium text-muted-foreground/70">/100</span>
            </p>

            <div className={cn("h-1 w-full rounded-full overflow-hidden mt-1.5", band.track)}>
              <div
                className={cn("h-full rounded-full transition-[width] duration-700 ease-out", band.bar)}
                style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
              />
            </div>

            <p className="label-caps mt-1.5 flex items-center justify-center gap-1">
              {band.label}
              <Info className="h-2.5 w-2.5 opacity-40 group-hover:opacity-100 transition-opacity" />
            </p>
          </button>
        </TooltipTrigger>

        <TooltipContent side="bottom" align="end" className="w-72 p-0 overflow-hidden">
          <div className="p-3 border-b border-border/60">
            <p className={cn("text-sm font-bold", band.text)}>
              {band.label} · {score}/100
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{band.blurb}</p>
          </div>

          {metrics && (
            <div className="p-3 space-y-1.5">
              <p className="label-caps">Measured from this channel</p>
              <Row label="Views per video" value={formatNumber(metrics.viewsPerVideo)} />
              <Row
                label="Views per subscriber"
                value={metrics.viewsPerSubscriber > 0 ? `${metrics.viewsPerSubscriber.toFixed(1)}×` : "—"}
              />
              <Row label="Uploads per month" value={metrics.uploadsPerMonth.toFixed(1)} />
              <Row label="Channel age" value={`${metrics.ageYears.toFixed(1)} yrs`} />
              <Row label="Total uploads" value={formatExact(channel.statistics.videoCount)} />
            </div>
          )}

          <p className="text-micro text-muted-foreground/80 leading-relaxed px-3 pb-3">
            Score weighs reach, subscriber conversion, and upload consistency against
            channel age. It is a model estimate, not a YouTube metric.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular">{value}</span>
    </div>
  )
}
