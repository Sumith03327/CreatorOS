/**
 * @fileOverview Builds the SLOTS of a 30-day upload calendar — the dates, the
 * weekdays, the times, and the format mix.
 *
 * The dates are computed here, in code, and never asked of the model. Language
 * models are unreliable with calendars: they emit February 30th, drift the
 * weekday off the date, and quietly skip a week. So the slot grid is
 * deterministic, and the model is only ever asked to fill a slot it is handed —
 * a title, a hook, a goal. Same split as everywhere else in this app: arithmetic
 * in code, judgement in the model.
 *
 * The publishing day/time is the creator's OWN best-performing slot, derived by
 * scoring each upload against their own median and running it through the same
 * `buildUploadHeatmap` the Research brief uses.
 */

import { buildUploadHeatmap, type TimeSlot } from '@/lib/research-metrics';
import { isShort } from '@/lib/video-utils';
import type { YouTubeVideoData } from '@/services/youtube';

export type SlotFormat = 'long' | 'short';

export interface PlanSlot {
  /** Stable index the model fills against. */
  index: number;
  /** Real calendar date, YYYY-MM-DD. */
  date: string;
  /** 0 = Sunday. Always consistent with `date`. */
  weekday: number;
  /** Hour of day (0-23), taken from the creator's best-performing block. */
  hour: number;
  format: SlotFormat;
  /** 0-based week within the plan, for grouping in the UI. */
  week: number;
}

const DAY_MS = 86_400_000;

function iso(d: Date): string {
  // Local date, not UTC — a plan that shifts a day across the date line is wrong.
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * The creator's own best publishing slot: score each upload against their own
 * median, then find the day/time block where the winners actually landed.
 * Returns null when the sample is too thin to mean anything.
 */
export function bestPublishSlot(videos: YouTubeVideoData[]): TimeSlot | null {
  const views = videos.map((v) => parseInt(v.viewCount || '0', 10) || 0);
  const sorted = [...views].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : 0;
  if (!med) return null;

  const { bestSlot } = buildUploadHeatmap(
    videos.map((v) => ({
      publishedAt: v.publishedAt,
      // Performance relative to this creator's own norm — the same idea as an
      // outlier multiple, measured against themselves.
      outlierScore: (parseInt(v.viewCount || '0', 10) || 0) / med,
    }))
  );

  // One upload in a slot proves nothing. Demand at least two before we tell a
  // creator to build their schedule around it.
  if (!bestSlot || bestSlot.count < 2) return null;
  return bestSlot;
}

/**
 * How many uploads a week to plan for. We nudge toward a healthier cadence
 * rather than mirroring a broken one — but never by more than the creator can
 * plausibly sustain, because a plan they abandon in week two is worse than none.
 */
export function targetPerWeek(uploadsPerMonth: number): number {
  const current = uploadsPerMonth / 4.33;
  if (current < 0.9) return 1; // sub-weekly → pull them up to weekly
  return Math.max(1, Math.min(5, Math.round(current)));
}

export function buildSlots(opts: {
  uploadsPerMonth: number;
  /** 0..1 — the creator's existing Shorts ratio, which we preserve. */
  shortsShare: number;
  bestSlot: TimeSlot | null;
  /** Defaults to tomorrow — never schedule something for today. */
  from?: Date;
  days?: number;
}): PlanSlot[] {
  const days = opts.days ?? 30;
  const perWeek = targetPerWeek(opts.uploadsPerMonth);

  // Anchor on the creator's best-performing day/time; fall back to Saturday
  // 10:00, the safest general-purpose slot, when the sample is too thin.
  const anchorDay = opts.bestSlot ? opts.bestSlot.day : 6;
  const hour = opts.bestSlot ? opts.bestSlot.block * 3 : 10;

  // Spread the week's uploads evenly around the anchor day.
  const step = Math.floor(7 / perWeek) || 1;
  const weekdays = new Set(
    Array.from({ length: perWeek }, (_, i) => (anchorDay + i * step) % 7)
  );

  const start = opts.from ? new Date(opts.from) : new Date(Date.now() + DAY_MS);
  start.setHours(0, 0, 0, 0);

  const slots: PlanSlot[] = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(start.getTime() + d * DAY_MS);
    if (!weekdays.has(date.getDay())) continue;
    slots.push({
      index: slots.length,
      date: iso(date),
      weekday: date.getDay(),
      hour,
      format: 'long', // assigned below
      week: Math.floor(d / 7),
    });
  }

  // Preserve the creator's existing format mix, spacing the Shorts out rather
  // than clumping them at the end.
  const shortCount = Math.round(slots.length * Math.max(0, Math.min(1, opts.shortsShare)));
  if (shortCount > 0 && shortCount < slots.length) {
    const every = slots.length / shortCount;
    for (let i = 0; i < shortCount; i++) {
      const at = Math.min(slots.length - 1, Math.round(i * every));
      slots[at].format = 'short';
    }
  } else if (shortCount >= slots.length) {
    slots.forEach((s) => (s.format = 'short'));
  }

  return slots;
}

/** Human label for a slot's time, e.g. "Wed 18:00". */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function slotTimeLabel(slot: PlanSlot): string {
  return `${DAYS[slot.weekday]} ${String(slot.hour).padStart(2, '0')}:00`;
}

/** Derive the creator's Shorts ratio from their uploads. */
export function shortsShareOf(videos: YouTubeVideoData[]): number {
  if (!videos.length) return 0;
  return videos.filter((v) => isShort(v.duration)).length / videos.length;
}
