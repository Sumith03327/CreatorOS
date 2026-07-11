'use server';
/**
 * @fileOverview Fills a pre-computed 30-day slot grid with what to actually make.
 *
 * The model is NEVER asked for a date. `buildSlots` (content-calendar.ts) already
 * decided when each upload publishes, in code, from the creator's real cadence
 * and their own best-performing publish time. This flow only answers "what goes
 * in slot 3" — a working title, the hook angle, and the goal.
 *
 * Anything the model returns for a slot that doesn't exist is dropped, and any
 * slot it forgets is backfilled, so the grid always comes out intact.
 */

import { callMesh } from '@/services/mesh';
import type { PlanSlot } from '@/lib/content-calendar';

export type UploadGoal = 'growth' | 'retention' | 'monetization' | 'experiment';

export interface CalendarEntry {
  index: number;
  title: string;
  hook: string;
  goal: UploadGoal;
  why: string;
}

/** A slot plus what the model decided to put in it. */
export type PlannedUpload = PlanSlot & Omit<CalendarEntry, 'index'>;

const GOALS: UploadGoal[] = ['growth', 'retention', 'monetization', 'experiment'];

export interface GenerateCalendarInput {
  /** The measured brief from channel-diagnosis. */
  brief: string;
  niche?: string;
  slots: PlanSlot[];
  /** Title patterns proven in this niche, if the creator has any. */
  titleFormulas?: string[];
  /**
   * Ideas the creator has already chosen. When present the model must SCHEDULE
   * these rather than invent its own — a creator who picked their topics should
   * not have them quietly replaced.
   */
  ideas?: string[];
}

export async function generateContentCalendar(input: GenerateCalendarInput): Promise<PlannedUpload[]> {
  const { slots } = input;
  if (!slots.length) return [];

  const slotList = slots
    .map((s) => `- slot ${s.index}: ${s.date} (${s.format === 'short' ? 'SHORT, 30-60s vertical' : 'LONG-FORM'})`)
    .join('\n');

  const system =
    'You are a YouTube content strategist. You plan what a creator should publish, grounded in their real numbers. ' +
    'Never invent dates — the schedule is already fixed and given to you. Always return valid JSON only.';

  // When the creator brought their own ideas, the model's job changes from
  // "invent topics" to "schedule these well" — a much narrower, safer job.
  const chosen = input.ideas?.filter(Boolean) ?? [];
  const ideaBlock = chosen.length
    ? `\nThe creator has ALREADY CHOSEN these ideas. Schedule THESE — do not invent replacements:\n${chosen
        .map((t, i) => `${i + 1}. ${t}`)
        .join('\n')}\n` +
      `Assign them across the slots. Keep each title essentially as written (you may tighten wording, never change the topic). ` +
      `If there are more slots than ideas, you may add extras that fit the channel — mark those clearly by making them obviously on-theme. ` +
      `If there are more ideas than slots, schedule the strongest ones and drop the rest.\n`
    : '';

  const prompt = `Here is the measured state of the channel:
${input.brief}
${input.niche ? `\nNiche: ${input.niche}` : ''}
${input.titleFormulas?.length ? `\nTitle patterns already winning in this niche:\n${input.titleFormulas.map((f) => `- ${f}`).join('\n')}` : ''}
${ideaBlock}
The publishing schedule is ALREADY DECIDED. Do not change it, and do not output dates.
Fill each slot below with what to make:

${slotList}

Rules:
- Return exactly one entry per slot, using the same slot index.
- "title" is a working title a viewer would click, specific to this channel's niche.
- "hook" is the opening angle in one sentence — what makes someone stay past 10 seconds.
- "goal" is one of: growth, retention, monetization, experiment.
- Balance the month: mostly safe bets that fit the channel, but include 1-2 "experiment" slots.
- Respect the format: SHORT slots must be ideas that work as a 30-60s vertical, not a trimmed long-form.
- Ground every idea in the channel's actual niche and the bottlenecks listed above. Do not propose topics the channel has no standing to make.

Return JSON:
{ "entries": [ { "index": number, "title": "string", "hook": "string", "goal": "growth"|"retention"|"monetization"|"experiment", "why": "one sentence" } ] }`;

  const raw = await callMesh(prompt, system);
  let parsed: { entries?: CalendarEntry[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const byIndex = new Map<number, CalendarEntry>();
  for (const e of parsed.entries ?? []) {
    // Drop anything aimed at a slot that doesn't exist rather than trusting it.
    if (typeof e?.index !== 'number' || e.index < 0 || e.index >= slots.length) continue;
    byIndex.set(e.index, {
      index: e.index,
      title: String(e.title ?? '').trim() || 'Untitled',
      hook: String(e.hook ?? '').trim(),
      goal: GOALS.includes(e.goal) ? e.goal : 'growth',
      why: String(e.why ?? '').trim(),
    });
  }

  // Every slot must come back, even if the model skipped it — a calendar with a
  // silent hole is worse than one that admits an empty slot.
  return slots.map((slot) => {
    const e = byIndex.get(slot.index);
    return {
      ...slot,
      title: e?.title ?? 'Open slot — decide this one yourself',
      hook: e?.hook ?? '',
      goal: e?.goal ?? 'growth',
      why: e?.why ?? '',
    };
  });
}
