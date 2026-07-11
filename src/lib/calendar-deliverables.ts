/**
 * @fileOverview How a calendar leaves the app.
 *
 * Two delivery shapes, deliberately different:
 *  - the WHOLE schedule → Google Calendar, because a plan is only real once it's
 *    in the calendar the creator actually looks at. Every line leads with an
 *    explicit `YYYY-MM-DD HH:00` so the delivery agent can create one event per
 *    upload rather than guessing at "next Tuesday".
 *  - EACH upload → the production pipeline (Notion / Trello / Airtable), because
 *    that's where the work gets tracked. The reasoning travels with the card, so
 *    it still makes sense three weeks later.
 */

import { slotTimeLabel } from '@/lib/content-calendar';
import type { PlannedUpload } from '@/ai/flows/generate-content-calendar';

export function calendarDeliverable(uploads: PlannedUpload[], channelTitle?: string) {
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

export function uploadCard(u: PlannedUpload): string {
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

/** "Mon 4 Mar" — short and unambiguous inside a 30-day window. */
export function dayLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
