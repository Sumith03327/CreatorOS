/**
 * Interpretation layer for the AI performance score.
 *
 * The score itself is a model judgement ("growth efficiency, 0-100"). A bare
 * number teaches the user nothing and invites them to ignore it, so we pair it
 * with two things we can actually stand behind:
 *
 *   1. A qualitative band, which is a pure function of the score.
 *   2. The real, arithmetic inputs a reader can check against the channel page.
 *
 * We deliberately do NOT synthesise a percentile ("top 12% of finance channels").
 * We have no corpus to rank against, so that figure would be invented — the same
 * failure mode `deliverables.ts` exists to prevent on the agent side.
 */

import type { YouTubeChannelData } from '@/services/youtube';

export type ScoreTone = 'exceptional' | 'strong' | 'developing' | 'early';

export interface ScoreBand {
  tone: ScoreTone;
  label: string;
  /** What this band means, in the user's terms. */
  blurb: string;
  /** Tailwind classes for the numeral. */
  text: string;
  /** Tailwind classes for the surrounding pill/track. */
  track: string;
  bar: string;
}

const BANDS: Array<{ min: number } & ScoreBand> = [
  {
    min: 85,
    tone: 'exceptional',
    label: 'Exceptional',
    blurb: 'Converting reach into subscribers unusually well for its size.',
    text: 'text-emerald-600',
    track: 'bg-emerald-100',
    bar: 'bg-emerald-500',
  },
  {
    min: 70,
    tone: 'strong',
    label: 'Strong',
    blurb: 'Healthy, compounding growth with consistent audience pull.',
    text: 'text-primary',
    track: 'bg-primary/15',
    bar: 'bg-primary',
  },
  {
    min: 50,
    tone: 'developing',
    label: 'Developing',
    blurb: 'Real traction, with headroom in either reach or conversion.',
    text: 'text-amber-600',
    track: 'bg-amber-100',
    bar: 'bg-amber-500',
  },
  {
    min: 0,
    tone: 'early',
    label: 'Early',
    blurb: 'Still establishing an audience — volume outpaces retention.',
    text: 'text-slate-600',
    track: 'bg-slate-200',
    bar: 'bg-slate-400',
  },
];

export function scoreBand(score: number): ScoreBand {
  const clamped = Math.max(0, Math.min(100, score));
  // BANDS is ordered high → low, so the first match is the tightest one.
  return BANDS.find((b) => clamped >= b.min) ?? BANDS[BANDS.length - 1];
}

export interface DerivedMetrics {
  /** Total views ÷ uploads. How much each video pulls, on average, all-time. */
  viewsPerVideo: number;
  /** Total views ÷ subscribers. High means reach outruns conversion. */
  viewsPerSubscriber: number;
  /** Uploads ÷ months since channel creation. */
  uploadsPerMonth: number;
  /** Years since the channel was created. */
  ageYears: number;
}

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

/**
 * Every field here is arithmetic over numbers YouTube returned. Nothing is
 * modelled, so these can be shown as fact.
 */
export function deriveMetrics(channel: YouTubeChannelData): DerivedMetrics | null {
  const subs = parseInt(channel.statistics.subscriberCount || '0', 10);
  const views = parseInt(channel.statistics.viewCount || '0', 10);
  const videos = parseInt(channel.statistics.videoCount || '0', 10);
  if (!Number.isFinite(views) || !Number.isFinite(videos)) return null;

  const created = new Date(channel.publishedAt).getTime();
  const months = Number.isFinite(created)
    ? Math.max(1, (Date.now() - created) / MS_PER_MONTH)
    : 1;

  return {
    viewsPerVideo: videos > 0 ? Math.round(views / videos) : 0,
    viewsPerSubscriber: subs > 0 ? views / subs : 0,
    uploadsPerMonth: videos / months,
    ageYears: months / 12,
  };
}
