'use client';

/**
 * The 30-day calendar: what to publish, when, and where it goes next.
 *
 * Two delivery paths, deliberately different:
 *  - the WHOLE calendar → Google Calendar, because a schedule is only real once
 *    it is in the calendar the creator actually looks at;
 *  - EACH upload → the production pipeline (Notion / Trello / Airtable), because
 *    that is where the work gets tracked.
 */

import { CalendarDays, Clapperboard, Film, Target } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SendToMenu } from '@/components/agents/SendToMenu';
import { slotTimeLabel } from '@/lib/content-calendar';
import type { PlannedUpload, UploadGoal } from '@/ai/flows/generate-content-calendar';

const GOAL_STYLE: Record<UploadGoal, string> = {
  growth: 'bg-primary/10 text-primary',
  retention: 'bg-emerald-100 text-emerald-700',
  monetization: 'bg-amber-100 text-amber-700',
  experiment: 'bg-fuchsia-100 text-fuchsia-700',
};

/** "Mon 4 Mar" — short, unambiguous, no year noise inside a 30-day window. */
function dayLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The body handed to the Google Calendar delivery agent. Every line leads with an
 * explicit date and time so the agent can create a real event per upload rather
 * than guessing at "next Tuesday".
 */
function calendarDeliverable(uploads: PlannedUpload[], channelTitle?: string) {
  const body = uploads
    .map((u) => {
      const time = `${String(u.hour).padStart(2, '0')}:00`;
      return [
        `${u.date} ${time} — Publish: ${u.title}`,
        `  Format: ${u.format === 'short' ? 'Short (30-60s vertical)' : 'Long-form'}`,
        u.hook ? `  Hook: ${u.hook}` : '',
        `  Goal: ${u.goal}`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  return {
    title: `Upload schedule${channelTitle ? ` — ${channelTitle}` : ''} (next 30 days)`,
    body: `${uploads.length} uploads. Create one event per dated line below, at the stated date and time.\n\n${body}`,
  };
}

/** One pipeline card per planned upload — the reasoning travels with the task. */
function uploadCard(u: PlannedUpload) {
  return [
    `Publish: ${u.date} at ${String(u.hour).padStart(2, '0')}:00 (${slotTimeLabel(u)})`,
    `Format: ${u.format === 'short' ? 'Short — 30-60s vertical' : 'Long-form'}`,
    `Goal: ${u.goal}`,
    '',
    u.hook ? `Hook: ${u.hook}` : '',
    u.why ? `Why this one: ${u.why}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function ContentCalendar({
  uploads,
  channelTitle,
}: {
  uploads: PlannedUpload[];
  channelTitle?: string;
}) {
  if (!uploads.length) return null;

  // Group by the week index the slot builder already assigned.
  const weeks = new Map<number, PlannedUpload[]>();
  for (const u of uploads) {
    const list = weeks.get(u.week) ?? [];
    list.push(u);
    weeks.set(u.week, list);
  }

  const shorts = uploads.filter((u) => u.format === 'short').length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <CalendarDays className="h-4 w-4 text-primary" /> The next 30 days
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {uploads.length} uploads · {uploads.length - shorts} long-form, {shorts} Shorts · published{' '}
            {slotTimeLabel(uploads[0])} and around
          </p>
        </div>
        {/* #5 — the schedule becomes real events in the calendar they actually use. */}
        <SendToMenu
          variant="light"
          label="Add to calendar"
          kinds={['calendar', 'doc', 'sheet']}
          {...calendarDeliverable(uploads, channelTitle)}
        />
      </div>

      <div className="space-y-5">
        {[...weeks.entries()].map(([week, items]) => (
          <div key={week} className="space-y-2">
            <p className="label-caps">Week {week + 1}</p>
            <div className="grid gap-2.5">
              {items.map((u) => (
                <Card key={u.index} className="border-none shadow-sm">
                  <CardContent className="flex flex-wrap items-start gap-4 p-4">
                    {/* Date rail */}
                    <div className="w-24 shrink-0">
                      <p className="text-sm font-bold tabular">{dayLabel(u.date)}</p>
                      <p className="text-micro text-muted-foreground tabular">
                        {String(u.hour).padStart(2, '0')}:00
                      </p>
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wider',
                            u.format === 'short' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'
                          )}
                        >
                          {u.format === 'short' ? <Clapperboard className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
                          {u.format === 'short' ? 'Short' : 'Long'}
                        </span>
                        <span
                          className={cn(
                            'flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wider',
                            GOAL_STYLE[u.goal]
                          )}
                        >
                          <Target className="h-2.5 w-2.5" /> {u.goal}
                        </span>
                      </div>

                      <p className="text-sm font-semibold text-foreground">{u.title}</p>
                      {u.hook && (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <span className="font-semibold text-foreground/70">Hook: </span>
                          {u.hook}
                        </p>
                      )}
                    </div>

                    {/* #6 — each planned upload becomes a real card on the team's board. */}
                    <div className="shrink-0 self-center">
                      <SendToMenu
                        variant="light"
                        label="Add to pipeline"
                        kinds={['task']}
                        title={u.title}
                        body={uploadCard(u)}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
