'use client';

/**
 * Plan history, and the check nobody else will give you: did you actually ship
 * what you planned?
 *
 * We count what was due against what went out, rather than matching titles —
 * creators rewrite a working title five times before publishing, so title
 * matching reports false misses. Coarser, but honest.
 */

import { History, Check, AlertTriangle, Trash2, CalendarDays } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { checkShipped } from '@/lib/plan-progress';
import { timeAgo } from '@/lib/video-utils';
import type { SavedPlan } from '@/lib/plan-store';
import type { YouTubeVideoData } from '@/services/youtube';

export function PlanHistory({
  plans,
  videos,
  activeId,
  onOpen,
  onDelete,
}: {
  plans: SavedPlan[];
  videos: YouTubeVideoData[];
  activeId?: string;
  onOpen: (plan: SavedPlan) => void;
  onDelete: (id: string) => void;
}) {
  if (plans.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
        <History className="h-4 w-4 text-primary" /> Past plans
      </h2>

      <div className="grid gap-2.5">
        {plans.map((plan) => {
          const ship = checkShipped(plan, videos);
          const isActive = plan.id === activeId;
          return (
            <Card key={plan.id} className={cn('border-none shadow-sm', isActive && 'ring-1 ring-primary/40')}>
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">
                      Plan from {new Date(plan.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </p>
                    <span className="text-micro text-muted-foreground">{timeAgo(plan.createdAt)}</span>
                    {isActive && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-semibold uppercase tracking-wider text-primary">
                        Open
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {plan.calendar?.length ? `${plan.calendar.length} uploads planned · ` : ''}
                    median {plan.metrics.medianViews.toLocaleString()} views at the time
                  </p>

                  {/* The did-you-ship check. */}
                  {ship && (
                    <div
                      className={cn(
                        'mt-2 flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs',
                        ship.due === 0
                          ? 'bg-muted/60 text-muted-foreground'
                          : ship.onTrack
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-amber-50 text-amber-900'
                      )}
                    >
                      {ship.due === 0 ? (
                        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                      ) : ship.onTrack ? (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="font-medium">{ship.headline}</span>
                      {ship.missed > 0 && (ship.missedFormats.long > 0 || ship.missedFormats.short > 0) && (
                        <span className="opacity-80">
                          — the ones you skipped were mostly{' '}
                          {ship.missedFormats.long >= ship.missedFormats.short ? 'long-form' : 'Shorts'}.
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {!isActive && (
                    <Button variant="outline" size="sm" onClick={() => onOpen(plan)} className="text-xs">
                      Open
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(plan.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete plan"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
