"use client"

import { ArrowRight, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { scoreBand } from "@/lib/channel-metrics"
import { formatNumber } from "@/lib/format"
import { timeAgo } from "@/lib/video-utils"
import type { ChannelHistoryEntry } from "@/lib/history"

/**
 * Recently analyzed channels. Every field shown here was already being written
 * to localStorage or is now captured alongside it — the card exists to spend
 * that data rather than store it and display a title.
 *
 * Score and niche arrive on a later pass than the channel facts, so each cell
 * degrades independently when absent.
 */
export function RecentAnalyses({
  entries,
  onSelect,
  onClear,
}: {
  entries: ChannelHistoryEntry[]
  onSelect: (id: string) => void
  onClear: () => void
}) {
  if (entries.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="label-caps">Recently Analyzed</h3>
        <button
          onClick={onClear}
          className="text-micro font-semibold text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          Clear
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map((e) => {
          const band = e.performanceScore !== undefined ? scoreBand(e.performanceScore) : null
          return (
            <Card
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(e.id)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault()
                  onSelect(e.id)
                }
              }}
              className={cn(
                "group cursor-pointer border-border/60 shadow-sm",
                "transition-all duration-200 hover:shadow-md hover:border-primary/40 hover:-translate-y-0.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              <CardContent className="p-4 flex items-center gap-3.5">
                <img
                  src={e.thumbnail}
                  alt=""
                  aria-hidden="true"
                  className="h-11 w-11 rounded-full object-cover shrink-0 ring-1 ring-border"
                />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate text-foreground">{e.title}</p>

                  {/* Each stat is atomic — the row wraps between them rather than
                      breaking "11.2M subs" across two lines. */}
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1 text-micro text-muted-foreground">
                    {e.subscriberCount && (
                      <span className="font-semibold tabular text-foreground/70 whitespace-nowrap">
                        {formatNumber(e.subscriberCount)} subs
                      </span>
                    )}
                    {e.subscriberCount && band && <Dot />}
                    {band && (
                      <span className={cn("font-bold tabular whitespace-nowrap", band.text)}>
                        {e.performanceScore}
                        <span className="opacity-50">/100</span>
                      </span>
                    )}
                    {(e.subscriberCount || band) && <Dot />}
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <Clock className="h-2.5 w-2.5 shrink-0" />
                      {timeAgo(e.analyzedAt) || "just now"}
                    </span>
                  </div>

                  {e.niche && (
                    <p className="text-micro text-muted-foreground/70 truncate mt-0.5">
                      {e.niche}
                    </p>
                  )}
                </div>

                <ArrowRight className="h-4 w-4 ml-1 text-muted-foreground/30 shrink-0 self-center transition-all group-hover:text-primary group-hover:translate-x-0.5" />
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

const Dot = () => <span className="text-muted-foreground/40">·</span>
