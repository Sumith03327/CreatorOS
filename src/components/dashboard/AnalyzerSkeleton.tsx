"use client"

import { Check, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * Which phase of the fetch is in flight. The page already loads in stages —
 * channel facts, then uploads, then AI analysis — so we narrate that rather
 * than hiding it behind one opaque spinner.
 */
export type LoadStage = "channel" | "videos" | "insights"

const STAGES: Array<{ key: LoadStage; label: string }> = [
  { key: "channel", label: "Finding channel" },
  { key: "videos", label: "Reading uploads" },
  { key: "insights", label: "Analyzing identity" },
]

function StageStrip({ stage }: { stage: LoadStage }) {
  const activeIdx = STAGES.findIndex((s) => s.key === stage)

  return (
    <div className="flex items-center gap-2 flex-wrap" aria-live="polite">
      {STAGES.map((s, i) => {
        const done = i < activeIdx
        const active = i === activeIdx
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
                done && "bg-emerald-50 text-emerald-700",
                active && "bg-primary/10 text-primary",
                !done && !active && "bg-muted text-muted-foreground/70"
              )}
            >
              {done ? (
                <Check className="h-3 w-3" />
              ) : active ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-40" />
              )}
              <span className="text-micro font-semibold uppercase">{s.label}</span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={cn("h-px w-4 sm:w-6", done ? "bg-emerald-200" : "bg-border")} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * A structural echo of the loaded dashboard. Every block here has a real
 * counterpart in page.tsx at the same position and size, so nothing shifts
 * when the data lands.
 */
export function AnalyzerSkeleton({ stage }: { stage: LoadStage }) {
  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <StageStrip stage={stage} />

      {/* Profile card */}
      <Card className="border-none shadow-sm overflow-hidden bg-card">
        <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-6">
          <Skeleton className="h-20 w-20 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2.5">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-40" />
            <div className="flex gap-1.5 pt-1">
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
          </div>
          <div className="flex gap-8 md:gap-12 md:mr-8">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 text-center">
                <Skeleton className="h-8 w-14 mx-auto" />
                <Skeleton className="h-2.5 w-10 mx-auto" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Identity / Audience / Monetization */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[85%]" />
              <Skeleton className="h-4 w-[60%]" />
            </div>
          </Card>
        ))}
      </div>

      {/* Performance chart */}
      <Card className="border-none shadow-sm bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="h-[240px] flex items-end gap-3 pt-4">
          {[52, 78, 41, 92, 63, 84, 48, 71].map((h, i) => (
            <Skeleton key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%` }} />
          ))}
        </div>
      </Card>

      {/* Content library */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="overflow-hidden border-none shadow-sm">
              <Skeleton className="aspect-video rounded-none" />
              <CardContent className="p-3 space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
