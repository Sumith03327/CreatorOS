'use server';
/**
 * @fileOverview Turns creator news into something a specific creator can act on.
 *
 * Two steps, deliberately separate:
 *
 *   decodeCreatorInsider — reads what YouTube's PMs actually SAID in the weekly
 *     video and extracts the discrete changes, each anchored to a timestamp. The
 *     news exists only as speech inside a video; there is no changelog to scrape.
 *
 *   scoreNewsImpact — decides whether each change matters to THIS creator. A
 *     Shorts monetization change is a five-alarm fire for a Shorts channel and
 *     completely irrelevant to a long-form one. Without this the feature is just
 *     another newsletter.
 */

import { callMesh } from '@/services/mesh';
import { parseMeshJson } from '@/lib/mesh-json';
import { fetchTranscript } from '@/services/youtube';

const SYSTEM_PROMPT =
  'You are a YouTube platform analyst briefing working creators. You report only what the source actually says, never what you remember or assume. Always return valid JSON only.';

/** Long episodes blow the context window; the announcements are front-loaded anyway. */
const MAX_TRANSCRIPT_CHARS = 14_000;

export type ChangeCategory = 'monetization' | 'algorithm' | 'feature' | 'policy' | 'bug' | 'other';

export interface PlatformChange {
  id: string;
  headline: string;
  detail: string;
  category: ChangeCategory;
  /** Where it's discussed, e.g. "4:12" — links to that second of the video. */
  timestamp: string;
  /** Seconds, for deep-linking. */
  timestampSeconds: number;
  /** Which creators this touches, in the source's own terms. */
  appliesTo: string;
  /** True when it's live now rather than "coming soon" — creators need this distinction. */
  isLive: boolean;
}

export interface CreatorInsiderDigest {
  videoId: string;
  transcriptAvailable: boolean;
  changes: PlatformChange[];
}

function parseTimestamp(value: string): number {
  const parts = String(value).split(':').map(n => parseInt(n, 10));
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function formatStamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Reads the weekly Creator Insider episode and pulls out what actually changed.
 * The whole point of the feature: a 12-minute rambling PM update becomes a
 * scannable changelog where every line links to the second it was said.
 */
export async function decodeCreatorInsider(input: {
  videoId: string;
  title: string;
}): Promise<CreatorInsiderDigest> {
  const transcript = await fetchTranscript(input.videoId);
  if (transcript.length === 0) {
    return { videoId: input.videoId, transcriptAvailable: false, changes: [] };
  }

  const timestamped = transcript
    .map(segment => `[${formatStamp(segment.offset)}] ${segment.text}`)
    .join('\n')
    .slice(0, MAX_TRANSCRIPT_CHARS);

  const prompt = `This is the transcript of "${input.title}", the weekly video where YouTube's product managers announce what changed for creators.

"""
${timestamped}
"""

Extract every DISTINCT change, feature, or announcement. For each:
- "headline": what changed, in under 12 words, written for a creator skimming. No hype.
- "detail": one or two sentences on what it actually means in practice.
- "category": one of monetization | algorithm | feature | policy | bug | other.
- "timestamp": the [m:ss] stamp where it is first discussed, copied from the transcript.
- "appliesTo": who it affects, in the video's own terms (e.g. "channels in YPP", "Shorts creators", "everyone").
- "isLive": true if it is available NOW; false if it is coming soon, rolling out, or in testing.

Rules:
- Report ONLY what is said in this transcript. Do not add context from memory.
- Skip chit-chat, intros, sign-offs, and viewer shout-outs.
- If the episode announces nothing substantive, return an empty array. An honest empty result is correct and expected — do not invent filler.

Return JSON: { "changes": [{ "headline": "...", "detail": "...", "category": "...", "timestamp": "m:ss", "appliesTo": "...", "isLive": true }] }`;

  const response = await callMesh(prompt, SYSTEM_PROMPT);
  const parsed = parseMeshJson<{ changes: Omit<PlatformChange, 'id' | 'timestampSeconds'>[] }>(response);

  const changes = (parsed.changes ?? []).map((change, index) => ({
    ...change,
    id: `${input.videoId}-${index}`,
    timestampSeconds: parseTimestamp(change.timestamp),
    isLive: Boolean(change.isLive),
  }));

  return { videoId: input.videoId, transcriptAvailable: true, changes };
}

// --- Impact scoring ---------------------------------------------------------

/**
 * What we know about the creator, from channels they've already analysed. Every
 * field is optional: a first-time user gets generic (but honest) impact rather
 * than nothing.
 */
export interface CreatorProfile {
  channelTitle?: string;
  niche?: string;
  subscriberCount?: number;
  /** Share of recent uploads that are Shorts, 0–1. Drives most of the routing. */
  shortsShare?: number;
  /** In the Partner Programme — decides whether monetization news is real to them. */
  monetized?: boolean;
}

export type ImpactLevel = 'act' | 'know' | 'background';

export interface ScoredChange extends PlatformChange {
  impact: ImpactLevel;
  /** Why it matters to THEM, in one sentence, or why it doesn't. */
  soWhat: string;
  /** The single thing to do, when there is one. */
  action?: string;
}

function describeProfile(profile: CreatorProfile): string {
  if (!profile.channelTitle) {
    return 'The creator has not connected a channel yet, so nothing is known about their format, size, or niche.';
  }

  const lines = [`Channel: ${profile.channelTitle}`];
  if (profile.niche) lines.push(`Niche: ${profile.niche}`);
  if (profile.subscriberCount) lines.push(`Subscribers: ${profile.subscriberCount.toLocaleString()}`);
  if (profile.shortsShare !== undefined) {
    const pct = Math.round(profile.shortsShare * 100);
    lines.push(`Format: ${pct}% of recent uploads are Shorts, ${100 - pct}% long-form`);
  }
  if (profile.monetized !== undefined) {
    lines.push(`Monetization: ${profile.monetized ? 'in the Partner Programme' : 'not yet monetized'}`);
  }
  return lines.join('\n');
}

/**
 * Rates each change against this specific creator. This is the whole product:
 * the same YouTube announcement is urgent for one channel and noise for another,
 * and we're one of very few tools that actually knows which.
 */
export async function scoreNewsImpact(input: {
  changes: PlatformChange[];
  profile: CreatorProfile;
}): Promise<ScoredChange[]> {
  if (input.changes.length === 0) return [];

  const list = input.changes
    .map(c => `id=${c.id} | [${c.category}] ${c.headline} — ${c.detail} (applies to: ${c.appliesTo}; ${c.isLive ? 'live now' : 'coming soon'})`)
    .join('\n');

  const prompt = `Here is a creator:

${describeProfile(input.profile)}

Here are this week's YouTube platform changes:

${list}

For each change, judge how much it matters TO THIS CREATOR SPECIFICALLY.

- "impact": "act" (they should do something about it soon), "know" (relevant but no action), or "background" (does not touch them).
- "soWhat": one sentence, addressed to them as "you", explaining why it matters — or plainly why it does not. Reference their actual format, size, or niche. Never pad.
- "action": the single concrete step to take, only when impact is "act". Omit otherwise.

Be strict. Most changes are "background" for most creators; marking everything urgent is how a feed becomes noise. A Shorts change is not urgent for a creator who publishes long-form. A monetization change is not urgent for someone who is not monetized${
    input.profile.channelTitle ? '' : '. Since no channel is connected, judge on general relevance and say so honestly in "soWhat" rather than inventing specifics about them'
  }.

Return JSON: { "scored": [{ "id": "...", "impact": "...", "soWhat": "...", "action": "..." }] }`;

  try {
    const response = await callMesh(prompt, SYSTEM_PROMPT);
    const parsed = parseMeshJson<{ scored: { id: string; impact: ImpactLevel; soWhat: string; action?: string }[] }>(response);
    const byId = new Map((parsed.scored ?? []).map(s => [s.id, s]));

    return input.changes.map(change => {
      const scored = byId.get(change.id);
      return {
        ...change,
        impact: scored?.impact ?? 'know',
        soWhat: scored?.soWhat ?? '',
        action: scored?.impact === 'act' ? scored.action : undefined,
      };
    });
  } catch (e) {
    // Scoring is an enhancement. If it fails, the news is still the news.
    console.warn('Impact scoring failed; showing unscored changes:', e);
    return input.changes.map(change => ({ ...change, impact: 'know' as ImpactLevel, soWhat: '' }));
  }
}
