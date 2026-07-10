"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Search, CornerDownLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The channel search, in two sizes.
 *
 * `hero` owns the empty state — on a screen with nothing else on it, search is
 * the product. `compact` retreats into the page header once results exist.
 * Both share one input so focus, hotkeys, and submit behave identically.
 */
export function ChannelSearch({
  value,
  onChange,
  onSubmit,
  loading,
  variant,
  className,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: (v?: string) => void
  loading?: boolean
  variant: "hero" | "compact"
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform))
  }, [])

  // ⌘K / Ctrl+K from anywhere, and "/" when not already typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable

      const hotkey = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)
      const slash = e.key === "/" && !typing

      if (hotkey || slash) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const hero = variant === "hero"

  const field = (
    <div className={cn("relative flex-1", hero && "w-full")}>
      <Search
        className={cn(
          "absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none",
          hero ? "h-5 w-5" : "h-4 w-4"
        )}
      />
      <input
        ref={inputRef}
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        aria-label="Channel URL, handle, or ID"
        placeholder={hero ? "Paste a channel URL, @handle, or ID…" : "Search a channel…"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !loading) onSubmit()
          if (e.key === "Escape") e.currentTarget.blur()
        }}
        className={cn(
          "w-full rounded-full border border-input bg-card text-foreground",
          "placeholder:text-muted-foreground/70",
          "transition-shadow duration-200",
          "focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring",
          hero ? "h-14 pl-12 pr-28 text-base shadow-sm" : "h-10 pl-10 pr-16 text-sm w-72"
        )}
      />

      {/* Hotkey affordance — hidden once the user is actually typing. */}
      {!value && (
        <kbd
          className={cn(
            "absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none select-none",
            "hidden sm:flex items-center gap-0.5 rounded border border-border bg-muted/70",
            "px-1.5 py-0.5 text-micro font-semibold text-muted-foreground/80"
          )}
        >
          {isMac ? "⌘" : "Ctrl"} K
        </kbd>
      )}
      {value && hero && (
        <kbd className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none select-none hidden sm:flex items-center gap-1 rounded border border-border bg-muted/70 px-1.5 py-0.5 text-micro font-semibold text-muted-foreground/80">
          <CornerDownLeft className="h-2.5 w-2.5" /> Enter
        </kbd>
      )}
    </div>
  )

  if (!hero) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        {field}
        <Button onClick={() => onSubmit()} disabled={loading} className="rounded-full px-5 shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Analyze"}
        </Button>
      </div>
    )
  }

  return (
    <div className={cn("w-full max-w-2xl mx-auto", className)}>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {field}
        <Button
          onClick={() => onSubmit()}
          disabled={loading || !value.trim()}
          size="lg"
          className="rounded-full h-14 px-8 text-base shrink-0"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Analyzing…
            </>
          ) : (
            "Analyze"
          )}
        </Button>
      </div>
    </div>
  )
}
