"use client"

import { ArrowUpRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

/**
 * Replaces the three static "Identity / Growth / Audience" cards that described
 * features the user could not invoke. These do the thing instead: one click runs
 * a real analysis.
 *
 * We show only a name, handle, and category — all verifiable. No subscriber
 * counts or scores are hardcoded; those get fetched live like any other channel.
 */
const STARTERS: Array<{ handle: string; name: string; category: string }> = [
  { handle: "@MrBeast", name: "MrBeast", category: "Entertainment · Mega-scale" },
  { handle: "@mkbhd", name: "Marques Brownlee", category: "Tech review · Authority" },
  { handle: "@veritasium", name: "Veritasium", category: "Science · Long-form" },
]

export function StarterChannels({
  onSelect,
  hasHistory,
}: {
  onSelect: (handle: string) => void
  hasHistory: boolean
}) {
  return (
    <section className="space-y-3">
      <h3 className="label-caps">
        {hasHistory ? "Or try one of these" : "Start with an example"}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STARTERS.map((s) => (
          <Card
            key={s.handle}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(s.handle)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault()
                onSelect(s.handle)
              }
            }}
            className="group cursor-pointer border-dashed border-border bg-transparent shadow-none transition-all duration-200 hover:border-primary/50 hover:bg-card hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground truncate">{s.handle}</p>
                <p className="text-micro text-muted-foreground/60 truncate mt-1">{s.category}</p>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground/30 shrink-0 transition-all group-hover:text-primary group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
