/**
 * @fileOverview Turns a connected channel + its recent uploads into a factual
 * brief and a prioritized list of what to fix first.
 *
 * This exists to delete the Action Plan's "paste a summary of your analysis"
 * textarea. The app already knows the channel; asking the creator to describe it
 * was asking them to do the tool's job.
 *
 * HONESTY BOUNDARY: click-through rate and audience retention are NOT in the
 * public YouTube API — they need YouTube Studio. Every number below is derived
 * from data we actually fetched (view counts, durations, publish dates), and
 * `BLIND_SPOTS` names what we cannot see rather than guessing at it. A tool that
 * invents a CTR number is worse than one that admits it doesn't have one.
 */

import { isShort, parseIsoDuration } from '@/lib/video-utils';
import type { YouTubeVideoData } from '@/services/youtube';
import type { MyChannel } from '@/lib/my-channel';

export type Severity = 'high' | 'medium' | 'low' | 'good';

export interface Finding {
  id: string;
  label: string;
  severity: Severity;
  /** The number, stated plainly. */
  headline: string;
  /** How we got it, so the creator can check us. */
  detail: string;
  /** What to actually do about it. */
  action: string;
  /** Where in the app to go and do it. */
  route?: { label: string; href: string };
}

export interface ChannelMetrics {
  uploadsPerMonth: number;
  /** Median views across recent uploads — resistant to one viral outlier. */
  medianViews: number;
  topViews: number;
  /** topViews ÷ medianViews. A big spread means the hits aren't repeatable. */
  spreadRatio: number;
  /** Median of the newest half ÷ median of the older half. <1 means cooling. */
  momentum: number;
  /** Longest gap between consecutive uploads, in days. */
  maxGapDays: number;
  viewsPerSubscriber: number;
  shortsShare: number;
  medianLongViews: number;
  medianShortViews: number;
  sampleSize: number;
}

/** What the public API cannot tell us. Shown to the user rather than faked. */
export const BLIND_SPOTS = [
  'Click-through rate',
  'Audience retention / average view duration',
  'Traffic sources and impressions',
];

const DAY_MS = 1000 * 60 * 60 * 24;

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const views = (v: YouTubeVideoData) => parseInt(v.viewCount || '0', 10) || 0;

export function computeMetrics(channel: MyChannel, videos: YouTubeVideoData[]): ChannelMetrics | null {
  if (!videos.length) return null;

  // Newest first — the API returns uploads in reverse-chronological order, but
  // don't trust that; sort explicitly.
  const sorted = [...videos].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  const subs = parseInt(channel.subscriberCount || '0', 10) || 0;
  const totalViews = parseInt(channel.viewCount || '0', 10) || 0;

  // Cadence over the window we actually sampled, not the channel's lifetime —
  // a 10-year-old channel that woke up last month should read as active.
  const newest = new Date(sorted[0].publishedAt).getTime();
  const oldest = new Date(sorted[sorted.length - 1].publishedAt).getTime();
  const spanDays = Math.max(1, (newest - oldest) / DAY_MS);
  const uploadsPerMonth = sorted.length > 1 ? (sorted.length - 1) / (spanDays / 30.44) : 0;

  // Longest silence between consecutive uploads.
  let maxGapDays = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = (new Date(sorted[i].publishedAt).getTime() - new Date(sorted[i + 1].publishedAt).getTime()) / DAY_MS;
    if (gap > maxGapDays) maxGapDays = gap;
  }

  const allViews = sorted.map(views);
  const medianViews = median(allViews);
  const topViews = Math.max(...allViews, 0);

  // Momentum: newest half vs older half. Median (not mean) so one viral hit
  // doesn't declare a dying channel healthy.
  const half = Math.floor(sorted.length / 2);
  const recentMedian = half >= 2 ? median(allViews.slice(0, half)) : medianViews;
  const olderMedian = half >= 2 ? median(allViews.slice(half)) : medianViews;
  const momentum = olderMedian > 0 ? recentMedian / olderMedian : 1;

  const shorts = sorted.filter((v) => isShort(v.duration));
  const longs = sorted.filter((v) => !isShort(v.duration));

  return {
    uploadsPerMonth,
    medianViews,
    topViews,
    spreadRatio: medianViews > 0 ? topViews / medianViews : 0,
    momentum,
    maxGapDays,
    viewsPerSubscriber: subs > 0 ? totalViews / subs : 0,
    shortsShare: sorted.length ? shorts.length / sorted.length : 0,
    medianLongViews: median(longs.map(views)),
    medianShortViews: median(shorts.map(views)),
    sampleSize: sorted.length,
  };
}

const fmt = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
};

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, good: 3 };

/**
 * The prioritized "fix this first" list. Each finding routes to the part of the
 * app that actually fixes it, so the Action Plan becomes a router rather than a
 * dead-end document.
 */
export function diagnose(metrics: ChannelMetrics): Finding[] {
  const f: Finding[] = [];

  // --- Cadence -------------------------------------------------------------
  if (metrics.uploadsPerMonth < 2) {
    f.push({
      id: 'cadence',
      label: 'Upload cadence',
      severity: 'high',
      headline: `${metrics.uploadsPerMonth.toFixed(1)} uploads a month`,
      detail: `Across your last ${metrics.sampleSize} uploads. Below roughly 2 a month, the algorithm has too little to work with and an audience never forms a habit.`,
      action: 'Lock a repeatable schedule you can actually hold, and plan the month up front.',
      route: { label: 'Build a 30-day calendar', href: '/plan' },
    });
  } else if (metrics.uploadsPerMonth < 4) {
    f.push({
      id: 'cadence',
      label: 'Upload cadence',
      severity: 'medium',
      headline: `${metrics.uploadsPerMonth.toFixed(1)} uploads a month`,
      detail: `Across your last ${metrics.sampleSize} uploads. Workable, but weekly is where most channels start compounding.`,
      action: 'Push toward one upload a week — batch scripting so a bad week does not break the streak.',
      route: { label: 'Plan the month', href: '/plan' },
    });
  } else {
    f.push({
      id: 'cadence',
      label: 'Upload cadence',
      severity: 'good',
      headline: `${metrics.uploadsPerMonth.toFixed(1)} uploads a month`,
      detail: 'A healthy, compounding rate. Volume is not your bottleneck.',
      action: 'Hold this and put your effort into packaging instead.',
    });
  }

  // --- Momentum ------------------------------------------------------------
  if (metrics.momentum < 0.7) {
    const drop = Math.round((1 - metrics.momentum) * 100);
    f.push({
      id: 'momentum',
      label: 'Momentum',
      severity: 'high',
      headline: `Recent uploads are down ${drop}%`,
      detail: `The median of your newer uploads is ${drop}% below the median of the batch before them. Something in the topic or the packaging stopped landing.`,
      action: 'Find what is actually working in your niche right now and take the format back to first principles.',
      route: { label: 'Find what is working', href: '/insights' },
    });
  } else if (metrics.momentum > 1.3) {
    f.push({
      id: 'momentum',
      label: 'Momentum',
      severity: 'good',
      headline: `Recent uploads are up ${Math.round((metrics.momentum - 1) * 100)}%`,
      detail: 'Your newer uploads are out-performing the batch before them. Whatever changed, it is working.',
      action: 'Do more of the recent format before the window closes.',
    });
  }

  // --- Packaging (spread) --------------------------------------------------
  // A huge gap between the best video and the median means the AUDIENCE is there
  // — the packaging just isn't repeatable. That's a title/thumbnail problem, and
  // it's the single most actionable finding we can derive from public data.
  if (metrics.spreadRatio >= 5 && metrics.medianViews > 0) {
    f.push({
      id: 'packaging',
      label: 'Packaging',
      severity: 'medium',
      headline: `Your best video did ${metrics.spreadRatio.toFixed(1)}× your median`,
      detail: `Top upload: ${fmt(metrics.topViews)} views against a median of ${fmt(metrics.medianViews)}. The demand is clearly there — the packaging that captured it is not repeatable yet.`,
      action: 'Work out what the outlier’s title and thumbnail did differently, and make that your template.',
      route: { label: 'Score your titles', href: '/agents?agent=title-doctor' },
    });
  }

  // --- Consistency ---------------------------------------------------------
  if (metrics.maxGapDays > 30 && metrics.sampleSize >= 4) {
    f.push({
      id: 'consistency',
      label: 'Consistency',
      severity: metrics.maxGapDays > 60 ? 'medium' : 'low',
      headline: `A ${Math.round(metrics.maxGapDays)}-day gap in your uploads`,
      detail: 'Long silences reset the habit you have built with returning viewers, and the next upload starts colder than it should.',
      action: 'Keep two finished videos banked so a bad week never becomes a dead month.',
    });
  }

  // --- Format mix ----------------------------------------------------------
  const { medianLongViews: long, medianShortViews: short, shortsShare } = metrics;
  if (long > 0 && short > 0) {
    const ratio = short / long;
    if (ratio >= 2 && shortsShare < 0.5) {
      f.push({
        id: 'format',
        label: 'Format mix',
        severity: 'medium',
        headline: `Your Shorts pull ${ratio.toFixed(1)}× your long-form`,
        detail: `Median Short: ${fmt(short)} views. Median long-form: ${fmt(long)}. Shorts are only ${Math.round(shortsShare * 100)}% of what you publish.`,
        action: 'Cut Shorts from the strongest moments of the long-form you are already making.',
        route: { label: 'Repurpose a video', href: '/agents?agent=repurposer' },
      });
    } else if (ratio <= 0.5 && shortsShare > 0.5) {
      f.push({
        id: 'format',
        label: 'Format mix',
        severity: 'medium',
        headline: `Your long-form pulls ${(1 / ratio).toFixed(1)}× your Shorts`,
        detail: `Median long-form: ${fmt(long)} views. Median Short: ${fmt(short)}. Yet ${Math.round(shortsShare * 100)}% of what you publish is Shorts.`,
        action: 'Shift effort back to long-form — it is where your audience actually shows up.',
      });
    }
  }

  return f.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export interface Winner {
  title: string;
  views: number;
  /** How far it beat this channel's own median. */
  multiple: number;
  format: 'long' | 'short';
}

/**
 * The channel's own outliers — the uploads that beat its median. This is the
 * best-grounded idea source we have, and unlike niche research it costs no
 * YouTube search quota: we already fetched these videos to diagnose the channel.
 *
 * Ideas anchored to "what already worked for YOU" beat ideas a model recalled
 * from the internet.
 */
export function ownWinners(videos: YouTubeVideoData[], m: ChannelMetrics, limit = 5): Winner[] {
  if (!m.medianViews) return [];
  return videos
    .map((v) => {
      const n = views(v);
      return {
        title: v.title,
        views: n,
        multiple: n / m.medianViews,
        format: isShort(v.duration) ? ('short' as const) : ('long' as const),
      };
    })
    .filter((w) => w.multiple > 1.2) // must actually have beaten the norm
    .sort((a, b) => b.multiple - a.multiple)
    .slice(0, limit);
}

/**
 * The factual brief handed to the plan generator. This replaces the textarea the
 * creator used to fill in by hand — every line is measured, not remembered.
 */
export function buildBrief(
  channel: MyChannel,
  m: ChannelMetrics,
  findings: Finding[],
  extras?: {
    /** The channel's own over-performers, so ideas are anchored to what worked. */
    winners?: Winner[];
    /** Proven titles/hooks the creator curated in their Winning Formula. */
    formula?: string[];
  }
): string {
  const subs = parseInt(channel.subscriberCount || '0', 10) || 0;
  const lines = [
    `Channel: ${channel.title}${channel.niche ? ` — ${channel.niche}` : ''}`,
    `${fmt(subs)} subscribers · ${fmt(parseInt(channel.viewCount || '0', 10) || 0)} lifetime views · ${channel.videoCount} uploads`,
    '',
    'MEASURED FROM THE LAST ' + m.sampleSize + ' UPLOADS:',
    `- Publishing ${m.uploadsPerMonth.toFixed(1)} times a month (longest gap: ${Math.round(m.maxGapDays)} days)`,
    `- Median views per upload: ${fmt(m.medianViews)}; best upload: ${fmt(m.topViews)} (${m.spreadRatio.toFixed(1)}x the median)`,
    `- Momentum: recent uploads are at ${(m.momentum * 100).toFixed(0)}% of the previous batch's median`,
    `- Format mix: ${Math.round(m.shortsShare * 100)}% Shorts. Median Short ${fmt(m.medianShortViews)} vs median long-form ${fmt(m.medianLongViews)}`,
    '',
    'DIAGNOSED BOTTLENECKS (worst first):',
    ...findings
      .filter((x) => x.severity !== 'good')
      .map((x) => `- [${x.severity}] ${x.label}: ${x.headline}. ${x.detail}`),
  ];

  if (extras?.winners?.length) {
    lines.push(
      '',
      "WHAT ALREADY WORKED ON THIS CHANNEL (its own outliers — build on these, don't ignore them):",
      ...extras.winners.map(
        (w) => `- "${w.title}" — ${fmt(w.views)} views, ${w.multiple.toFixed(1)}x this channel's median (${w.format})`
      )
    );
  }

  if (extras?.formula?.length) {
    lines.push(
      '',
      'PROVEN MATERIAL THE CREATOR CURATED (their Winning Formula):',
      ...extras.formula.slice(0, 12).map((t) => `- ${t}`)
    );
  }

  lines.push(
    '',
    `NOT MEASURABLE from the public API (do not speculate about these): ${BLIND_SPOTS.join(', ')}.`
  );

  return lines.join('\n');
}
