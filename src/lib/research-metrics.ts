/**
 * Pure metrics behind the Research feature.
 *
 * The central idea: raw view count says almost nothing useful to a creator,
 * because a big channel gets views by default. What transfers between channels
 * is the *outlier score* — how far a video beat its own channel's normal
 * performance. A 900K-view video from a 50K-sub channel is an 18x outlier and
 * worth studying; the same 900K from a mega-channel is a flop.
 *
 * Everything here is dependency-free and side-effect-free so it can run on the
 * server (during fetch/enrichment) and in the browser (during filtering).
 */

import { parseIsoDuration, SHORT_MAX_SECONDS } from './video-utils';

export function toNum(value?: string | number | null): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'string' ? parseInt(value, 10) : value;
  return Number.isFinite(n) ? n : 0;
}

export function median(values: number[]): number {
  const clean = values.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid];
}

/** Hours elapsed since an ISO timestamp, floored at 1 to keep rates finite. */
export function ageHoursSince(iso?: string): number {
  if (!iso) return 1;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 1;
  return Math.max(1, (Date.now() - then) / (1000 * 60 * 60));
}

/** Views per hour since publish — the honest measure of "hot right now". */
export function computeVph(views: number, publishedAt?: string): number {
  return views / ageHoursSince(publishedAt);
}

/**
 * How far this video beat its channel's typical performance. `baseline` should
 * be the median views of that channel's recent uploads *of the same format*
 * (Shorts and long-form have wildly different view distributions).
 */
export function computeOutlierScore(views: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return views / baseline;
}

export interface OutlierTier {
  label: string;
  /** Tailwind classes for text + background, tuned to the existing palette. */
  className: string;
}

export function outlierTier(score: number): OutlierTier {
  if (score >= 10) return { label: 'Breakout', className: 'bg-rose-500 text-white' };
  if (score >= 3) return { label: 'Outlier', className: 'bg-amber-500 text-white' };
  if (score >= 1.5) return { label: 'Above par', className: 'bg-emerald-500 text-white' };
  return { label: 'Normal', className: 'bg-slate-700/80 text-white' };
}

/** Renders an outlier score the way creators read it: "18x", "3.4x", "0.8x". */
export function formatMultiplier(score: number): string {
  if (score <= 0) return '—';
  if (score >= 10) return `${Math.round(score)}x`;
  return `${score.toFixed(1)}x`;
}

// --- Channel momentum -------------------------------------------------------

/**
 * The old growth score was `subscribers / monthsSinceChannelCreation`, a
 * *lifetime average*. A channel that exploded in 2019 and has been dead since
 * still scored "Hot", while one that 5x'd last month barely registered. Momentum
 * is computed from recent uploads instead, so it can only reflect the present.
 */
export interface MomentumInput {
  /** The channel's recent uploads, newest first, with live streams excluded. */
  uploads: { views: number; publishedAt: string }[];
  channelAgeMonths: number;
}

export interface MomentumResult {
  score: number;
  /** Median views across the channel's newest mature uploads. */
  recentMedianViews: number;
  /** Newest uploads' median ÷ older uploads' median. >1 means the channel is heating up. */
  lift: number;
  /** Median views-per-hour across the newest mature uploads. */
  recentMedianVph: number;
  uploadsPerMonth: number;
  isBreakout: boolean;
  /** How many uploads actually backed the score. Below 3, treat it as provisional. */
  sampleSize: number;
}

// ~2000 views/hour (≈48K/day) sustained across recent uploads is exceptional;
// treat it as the top of the velocity scale.
const VELOCITY_CEILING_VPH = 2000;
/**
 * Lift maps onto the score between these bounds: halving your own back catalogue
 * scores 0, holding flat scores ~33, doubling scores 100. Measured against live
 * data, median-over-median lift clusters between 0.3 and 1.2, so a flat channel
 * must not land halfway up the scale — it isn't gaining momentum, it's steady.
 */
const LIFT_FLOOR = 0.5;
const LIFT_CEILING = 2;

/**
 * Momentum is about *change*, so lift carries most of the weight. Velocity is
 * log-scaled views-per-hour, which is really a proxy for reach — weighting it
 * heavily made the list rank channels by size. It stays as a secondary term so
 * that, among two channels improving equally, the one people actually watch wins.
 */
const LIFT_WEIGHT = 0.75;
const VELOCITY_WEIGHT = 0.25;

/**
 * Below this many sampled uploads, a channel has no back catalogue because it is
 * genuinely new, and its velocity is the whole truth about it. Above it, a
 * missing back catalogue means something else: the channel uploads so often that
 * its last 50 videos are all younger than the maturity window. Those are news and
 * clip firehoses, and scoring them on raw velocity floats them to the top of
 * every niche. They are unproven, not surging.
 */
const NEW_CHANNEL_UPLOAD_COUNT = 12;
// A channel this young that's already moving fast came out of nowhere. Two years
// is still young for a channel: against live data an 18-month cutoff was excluding
// 20-month-old channels sitting at 9x lift on 28K subscribers, which is exactly
// what the radar exists to surface.
const BREAKOUT_MAX_AGE_MONTHS = 24;
const BREAKOUT_MIN_SCORE = 55;

/**
 * A video published yesterday has collected a fraction of the views it will end
 * up with. Measuring those against older, fully-settled uploads drags every
 * channel's lift below 1, so uploads this fresh are excluded from the scoring.
 */
const MATURITY_DAYS = 7;
const MIN_MATURE_SAMPLES = 3;
/** Share of the sample treated as "now"; the remainder is the back catalogue. */
const RECENT_SHARE = 0.4;
const MIN_PRIOR_SAMPLES = 3;
/**
 * Lift is a ratio, so it is blind to scale: a dormant channel creeping from 27
 * views to 33 shows the same 1.2x as a real one doubling from 100K to 200K. Lift's
 * contribution is scaled down until the channel's recent uploads clear this many
 * views, so noise on a dead channel can't masquerade as momentum.
 */
const LIFT_CREDIBILITY_VIEWS = 1000;

/**
 * Momentum from a single snapshot of a channel's uploads.
 *
 * `lift` deliberately compares the channel's newest uploads against its own
 * slightly older ones — median against median. An earlier version divided the
 * recent median by the channel's lifetime *mean* (total views ÷ video count),
 * which made almost every channel look like it was dying: view counts are so
 * long-tailed that a single viral video pulls the mean far above the median.
 *
 * Views do keep accruing after publication, so a young upload is still measured
 * a little short of an old one. Splitting one recency-ordered sample keeps the
 * two windows adjacent in time, which holds that bias to something small rather
 * than the order-of-magnitude distortion of a lifetime comparison.
 */
export function computeMomentum(input: MomentumInput): MomentumResult {
  const { uploads, channelAgeMonths } = input;

  const empty: MomentumResult = {
    score: 0, recentMedianViews: 0, lift: 0, recentMedianVph: 0, uploadsPerMonth: 0, isBreakout: false, sampleSize: 0,
  };
  if (uploads.length === 0) return empty;

  const ordered = [...uploads].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  const maturityCutoff = Date.now() - MATURITY_DAYS * 24 * 60 * 60 * 1000;
  const mature = ordered.filter(v => new Date(v.publishedAt).getTime() <= maturityCutoff);
  // A channel that has only published in the last week is genuinely too new to
  // score fairly; fall back to the full sample rather than reporting nothing.
  const hasMatureSample = mature.length >= MIN_MATURE_SAMPLES;
  const sample = hasMatureSample ? mature : ordered;

  const splitAt = Math.max(MIN_MATURE_SAMPLES, Math.round(sample.length * RECENT_SHARE));
  const recent = sample.slice(0, splitAt);
  const prior = sample.slice(splitAt);

  const recentMedianViews = median(recent.map(v => v.views));
  const recentMedianVph = median(recent.map(v => computeVph(v.views, v.publishedAt)));

  // Lift needs both a back catalogue to improve against and enough settled
  // uploads to compare fairly. Splitting a week's worth of brand-new videos
  // would just measure a one-day-old against a four-day-old.
  const canCompare = hasMatureSample && prior.length >= MIN_PRIOR_SAMPLES;
  const priorMedianViews = canCompare ? median(prior.map(v => v.views)) : 0;
  const lift = priorMedianViews > 0 ? recentMedianViews / priorMedianViews : 0;

  // Upload cadence over the window we actually sampled, not over the channel's life.
  const timestamps = ordered.map(v => new Date(v.publishedAt).getTime()).filter(Number.isFinite);
  const spanMonths =
    timestamps.length > 1
      ? Math.max(0.5, (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24 * 30))
      : 1;
  const uploadsPerMonth = Math.round(ordered.length / spanMonths);

  // Log scale on velocity so channels spanning orders of magnitude stay comparable.
  const velocityScore = clamp01(Math.log10(recentMedianVph + 1) / Math.log10(VELOCITY_CEILING_VPH)) * 100;
  const liftCredibility = clamp01(recentMedianViews / LIFT_CREDIBILITY_VIEWS);
  const liftScore = clamp01((lift - LIFT_FLOOR) / (LIFT_CEILING - LIFT_FLOOR)) * 100 * liftCredibility;

  // With no lift, what the score means depends on *why* it's missing.
  const isGenuinelyNew = ordered.length < NEW_CHANNEL_UPLOAD_COUNT;
  const score = Math.round(
    lift > 0
      ? LIFT_WEIGHT * liftScore + VELOCITY_WEIGHT * velocityScore
      : isGenuinelyNew
        ? velocityScore
        : VELOCITY_WEIGHT * velocityScore
  );

  return {
    score,
    recentMedianViews,
    lift,
    recentMedianVph,
    uploadsPerMonth,
    isBreakout: channelAgeMonths <= BREAKOUT_MAX_AGE_MONTHS && score >= BREAKOUT_MIN_SCORE,
    sampleSize: recent.length,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function momentumTier(score: number): OutlierTier {
  if (score >= 70) return { label: 'Surging', className: 'text-rose-600' };
  if (score >= 50) return { label: 'Hot', className: 'text-emerald-600' };
  if (score >= 30) return { label: 'Rising', className: 'text-amber-600' };
  return { label: 'Steady', className: 'text-slate-500' };
}

// --- Audience overlap -------------------------------------------------------

/**
 * Overlap coefficient: |A ∩ B| / min(|A|, |B|).
 *
 * Jaccard (|A ∩ B| / |A ∪ B|) is wrong here. The two commenter samples are
 * routinely very different sizes, and Jaccard would report near-zero for a small
 * channel whose audience sits almost entirely inside a large one's — which is
 * exactly the relationship we most want to surface.
 */
export function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  if (smaller.size === 0) return 0;
  let shared = 0;
  for (const id of smaller) if (larger.has(id)) shared++;
  return shared / smaller.size;
}

// --- Format & timing breakdowns ---------------------------------------------

// Both of these read only `duration` and `publishedAt`, which the video search
// already returns. They cost zero extra API calls.

export type FormatBucket = 'short' | 'quick' | 'standard' | 'deep';

export const FORMAT_LABELS: Record<FormatBucket, string> = {
  short: 'Shorts (<1m)',
  quick: 'Quick (1–8m)',
  standard: 'Standard (8–20m)',
  deep: 'Deep (20m+)',
};

export function formatBucket(durationIso?: string): FormatBucket {
  const seconds = parseIsoDuration(durationIso);
  if (seconds > 0 && seconds <= SHORT_MAX_SECONDS) return 'short';
  if (seconds <= 8 * 60) return 'quick';
  if (seconds <= 20 * 60) return 'standard';
  return 'deep';
}

export interface FormatStat {
  bucket: FormatBucket;
  label: string;
  count: number;
  medianOutlier: number;
  medianViews: number;
}

/**
 * Which video length is actually outperforming in this niche right now. Ranked
 * by median outlier score rather than by view count, so a bucket doesn't win
 * just because big channels happen to publish in it.
 */
export function buildFormatBreakdown(
  videos: { duration?: string; outlierScore: number; views: number }[]
): FormatStat[] {
  const buckets: FormatBucket[] = ['short', 'quick', 'standard', 'deep'];
  return buckets
    .map(bucket => {
      const group = videos.filter(v => formatBucket(v.duration) === bucket);
      return {
        bucket,
        label: FORMAT_LABELS[bucket],
        count: group.length,
        medianOutlier: median(group.map(v => v.outlierScore)),
        medianViews: median(group.map(v => v.views)),
      };
    })
    .filter(stat => stat.count > 0)
    .sort((a, b) => b.medianOutlier - a.medianOutlier);
}

export interface TimeSlot {
  /** 0 = Sunday, matching Date.getDay(). */
  day: number;
  /** Index of a 3-hour block: 0 = 00:00–03:00, 7 = 21:00–24:00. */
  block: number;
  count: number;
  medianOutlier: number;
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function blockLabel(block: number): string {
  const start = block * 3;
  const end = start + 3;
  const fmt = (h: number) => `${((h % 12) || 12)}${h < 12 ? 'am' : 'pm'}`;
  return `${fmt(start)}–${fmt(end % 24)}`;
}

/**
 * Day × 3-hour-block grid of when the outliers were published, in the viewer's
 * local timezone. Cells are ranked by median outlier score, so the answer is
 * "when do videos that *work* go out", not "when does everyone upload".
 */
export function buildUploadHeatmap(
  videos: { publishedAt?: string; outlierScore: number }[]
): { slots: TimeSlot[]; bestSlot: TimeSlot | null } {
  const grid = new Map<string, number[]>();

  for (const video of videos) {
    if (!video.publishedAt) continue;
    const date = new Date(video.publishedAt);
    if (!Number.isFinite(date.getTime())) continue;
    const key = `${date.getDay()}:${Math.floor(date.getHours() / 3)}`;
    const existing = grid.get(key);
    if (existing) existing.push(video.outlierScore);
    else grid.set(key, [video.outlierScore]);
  }

  const slots: TimeSlot[] = [];
  for (const [key, scores] of grid) {
    const [day, block] = key.split(':').map(Number);
    slots.push({ day, block, count: scores.length, medianOutlier: median(scores) });
  }

  // A single fluke video shouldn't crown a time slot — require corroboration.
  const credible = slots.filter(s => s.count >= 2);
  const pool = credible.length > 0 ? credible : slots;
  const bestSlot = pool.reduce<TimeSlot | null>(
    (best, s) => (!best || s.medianOutlier > best.medianOutlier ? s : best),
    null
  );

  return { slots, bestSlot };
}
