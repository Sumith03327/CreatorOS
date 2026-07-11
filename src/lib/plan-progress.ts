/**
 * @fileOverview Goal projection and the did-you-ship check.
 *
 * The projection is deliberately unflattering. Most creator tools tell you the
 * goal is achievable because that feels good; this one does the arithmetic from
 * the channel's own numbers and says plainly when a target is out of reach — and
 * more usefully, *which lever* is the wrong one to pull. A creator told "you'd
 * need 34 uploads a week" learns something real: volume is not their problem.
 *
 * Every projected figure is built from measured inputs (cadence, median views,
 * lifetime views-to-subscriber conversion). When an input doesn't exist yet —
 * a channel with no subscribers has no conversion rate — we say so rather than
 * inventing one.
 */

import type { ChannelMetrics } from '@/lib/channel-diagnosis';
import type { MyChannel } from '@/lib/my-channel';
import type { SavedPlan, Goal } from '@/lib/plan-store';
import type { YouTubeVideoData } from '@/services/youtube';

const DAY_MS = 86_400_000;

export type Pace = 'ahead' | 'on-track' | 'behind' | 'too-early';

export interface GoalProjection {
  current: number;
  target: number;
  remaining: number;
  daysLeft: number;
  /** Progress against the value when the goal was set. */
  gainedSoFar: number;
  /** What the channel will add by the deadline at its current cadence + performance. */
  projectedGain: number | null;
  projectedFinal: number | null;
  reachable: boolean | null;
  /** Uploads per week needed to actually hit the target. */
  requiredPerWeek: number | null;
  currentPerWeek: number;
  pace: Pace;
  /** The honest headline. */
  verdict: string;
  /** How we got there, so the creator can check the arithmetic. */
  basis: string;
}

function daysBetween(a: number, b: number): number {
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

export function projectGoal(
  goal: Goal,
  channel: MyChannel,
  metrics: ChannelMetrics
): GoalProjection {
  const subs = parseInt(channel.subscriberCount || '0', 10) || 0;
  const totalViews = parseInt(channel.viewCount || '0', 10) || 0;
  const current = goal.metric === 'subscribers' ? subs : totalViews;

  const now = Date.now();
  const deadline = new Date(`${goal.deadline}T23:59:59`).getTime();
  const daysLeft = daysBetween(now, deadline);
  const remaining = Math.max(0, goal.target - current);
  const gainedSoFar = current - goal.startValue;
  const currentPerWeek = metrics.uploadsPerMonth / 4.33;

  // Pace, but only once enough time has passed for it to mean anything.
  const daysElapsed = daysBetween(new Date(goal.startedAt).getTime(), now);
  const totalDays = daysElapsed + daysLeft;
  let pace: Pace = 'too-early';
  if (daysElapsed >= 7 && totalDays > 0) {
    const requiredPerDay = (goal.target - goal.startValue) / totalDays;
    const actualPerDay = gainedSoFar / daysElapsed;
    if (requiredPerDay <= 0) pace = 'ahead';
    else if (actualPerDay >= requiredPerDay * 1.05) pace = 'ahead';
    else if (actualPerDay >= requiredPerDay * 0.9) pace = 'on-track';
    else pace = 'behind';
  }

  const base = {
    current, target: goal.target, remaining, daysLeft, gainedSoFar, currentPerWeek, pace,
  };

  if (remaining === 0) {
    return {
      ...base,
      projectedGain: null, projectedFinal: current, reachable: true, requiredPerWeek: 0,
      verdict: 'Already there. Set a bigger target.',
      basis: `${current.toLocaleString()} against a target of ${goal.target.toLocaleString()}.`,
    };
  }

  // Views a single upload is worth, and — for a subscriber goal — how many subs
  // a view has historically been worth on this channel.
  const viewsPerUpload = metrics.medianViews;
  const subsPerView = totalViews > 0 ? subs / totalViews : 0;

  const cannotProject =
    viewsPerUpload <= 0 || (goal.metric === 'subscribers' && subsPerView <= 0);

  if (cannotProject) {
    return {
      ...base,
      projectedGain: null, projectedFinal: null, reachable: null, requiredPerWeek: null,
      verdict:
        goal.metric === 'subscribers' && subs === 0
          ? 'No subscribers yet, so there’s no conversion rate to project from — get the first few, then set a target you can actually measure against.'
          : 'Not enough performance history to project this honestly yet. Publish a few more and come back.',
      basis: 'A projection needs a median view count and a views-to-subscriber rate. This channel doesn’t have both yet.',
    };
  }

  const uploadsLeft = (metrics.uploadsPerMonth / 30.44) * daysLeft;
  const projectedViews = uploadsLeft * viewsPerUpload;
  const projectedGain = goal.metric === 'subscribers' ? projectedViews * subsPerView : projectedViews;
  const projectedFinal = Math.round(current + projectedGain);

  // What it would actually take.
  const requiredViews = goal.metric === 'subscribers' ? remaining / subsPerView : remaining;
  const requiredUploads = requiredViews / viewsPerUpload;
  const weeksLeft = Math.max(daysLeft / 7, 1 / 7);
  const requiredPerWeek = requiredUploads / weeksLeft;

  const reachable = projectedGain >= remaining;

  let verdict: string;
  if (daysLeft === 0) {
    verdict = reachable ? 'Deadline reached — target met.' : 'The deadline has passed and the target was not met.';
  } else if (reachable) {
    verdict = `On your current cadence you should pass this — roughly ${projectedFinal.toLocaleString()} by the deadline.`;
  } else if (requiredPerWeek <= 7) {
    verdict = `Not on this cadence. You’d need about ${requiredPerWeek.toFixed(1)} uploads a week (you’re at ${currentPerWeek.toFixed(1)}).`;
  } else {
    // The genuinely useful case: tell them volume is the wrong lever.
    verdict = `This isn’t reachable by uploading more — it would take about ${Math.round(requiredPerWeek)} uploads a week. The lever is your median views (${viewsPerUpload.toLocaleString()}), not your volume.`;
  }

  const basis =
    goal.metric === 'subscribers'
      ? `${metrics.uploadsPerMonth.toFixed(1)} uploads/month × ${viewsPerUpload.toLocaleString()} median views × ${(subsPerView * 1000).toFixed(1)} subs per 1K views, over ${daysLeft} days.`
      : `${metrics.uploadsPerMonth.toFixed(1)} uploads/month × ${viewsPerUpload.toLocaleString()} median views, over ${daysLeft} days.`;

  return { ...base, projectedGain, projectedFinal, reachable, requiredPerWeek, verdict, basis };
}

// --- Did you actually ship it? ---------------------------------------------

export interface ShipCheck {
  /** Slots whose publish date has already passed. */
  due: number;
  /** Uploads actually published since the plan was made. */
  shipped: number;
  missed: number;
  onTrack: boolean;
  headline: string;
  /** The formats of the slots that went unshipped — usually the interesting part. */
  missedFormats: { long: number; short: number };
}

/**
 * Compares what a plan asked for against what actually went out.
 *
 * We count rather than match titles: creators rewrite a working title five times
 * before publishing, so title matching would report false misses. Counting what
 * was due against what shipped is coarser but it is honest.
 */
export function checkShipped(plan: SavedPlan, videos: YouTubeVideoData[]): ShipCheck | null {
  if (!plan.calendar?.length) return null;

  const planned = new Date(plan.createdAt).getTime();
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const dueSlots = plan.calendar.filter((u) => new Date(`${u.date}T00:00:00`).getTime() <= today.getTime());
  const shipped = videos.filter((v) => new Date(v.publishedAt).getTime() >= planned).length;

  const due = dueSlots.length;
  const missed = Math.max(0, due - shipped);

  // Which kinds of upload got dropped — the ones creators skip say a lot.
  const missedSlots = missed > 0 ? dueSlots.slice(-missed) : [];
  const missedFormats = {
    long: missedSlots.filter((s) => s.format === 'long').length,
    short: missedSlots.filter((s) => s.format === 'short').length,
  };

  const onTrack = shipped >= due;
  let headline: string;
  if (due === 0) headline = 'Nothing due yet — the first slot is still ahead of you.';
  else if (onTrack) headline = `${shipped} of ${due} due — you're on top of it.`;
  else headline = `You planned ${due} by now and shipped ${shipped}.`;

  return { due, shipped, missed, onTrack, headline, missedFormats };
}
