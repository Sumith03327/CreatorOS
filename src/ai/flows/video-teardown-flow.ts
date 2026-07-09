'use server';
/**
 * @fileOverview Turns a single outlier video into something reusable: what its
 * hook did in the first 30 seconds, how the video is structured beat by beat,
 * and an outline the creator can take into their own script.
 *
 * Research that ends at "here's a video that did well" is a dead end. This is
 * the bridge between the Research tab and the drafting flows.
 */

import { callMesh, callMeshVision } from '@/services/mesh';
import { parseMeshJson } from '@/lib/mesh-json';
import { fetchTranscript, fetchVideoDetails } from '@/services/youtube';

// Transcript offsets from `youtube-transcript` are milliseconds.
const HOOK_WINDOW_MS = 30_000;
// Long videos blow the context window; the shape of the structure survives truncation.
const MAX_TRANSCRIPT_CHARS = 12_000;

const SYSTEM_PROMPT =
  'You are a YouTube retention analyst who reverse-engineers why videos hold attention. Always return valid JSON only.';

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// --- Video teardown ---------------------------------------------------------

export interface HookAnalysis {
  /** Verbatim transcript of roughly the first 30 seconds. */
  openingLines: string;
  /** e.g. "Contrarian claim", "Result first", "Open loop", "Stakes". */
  hookType: string;
  whyItWorks: string;
}

export interface StructureBeat {
  timestamp: string;
  label: string;
  summary: string;
}

export interface VideoTeardown {
  transcriptAvailable: boolean;
  hook: HookAnalysis | null;
  beats: StructureBeat[];
  /** Specific, transferable techniques — not generic advice. */
  stealables: string[];
  /** A blank outline the creator can fill in for their own video on this pattern. */
  outline: string[];
}

export async function getVideoTeardown(input: { videoId: string }): Promise<VideoTeardown> {
  const [details, transcript] = await Promise.all([
    fetchVideoDetails(input.videoId),
    fetchTranscript(input.videoId),
  ]);

  if (transcript.length === 0) {
    return { transcriptAvailable: false, hook: null, beats: [], stealables: [], outline: [] };
  }

  const hookText = transcript
    .filter(segment => segment.offset < HOOK_WINDOW_MS)
    .map(segment => segment.text)
    .join(' ');

  const timestamped = transcript
    .map(segment => `[${formatTimestamp(segment.offset)}] ${segment.text}`)
    .join('\n')
    .slice(0, MAX_TRANSCRIPT_CHARS);

  const prompt = `Video title: "${details?.title ?? 'Unknown'}"

Its first 30 seconds, verbatim:
"""
${hookText || '(no speech detected in the opening)'}
"""

Its full transcript (timestamped, possibly truncated):
"""
${timestamped}
"""

Reverse-engineer this video. Return:

1. "hook": classify the opening. "hookType" is a short label (Contrarian claim / Result first / Open loop / Stakes / Pattern interrupt / Direct promise / Story cold-open). "whyItWorks" is one sentence on the mechanism. "openingLines" is the verbatim opening, trimmed to about 2 sentences.
2. "beats": 4-7 structural beats with the timestamp they start at, a short label (Hook, Setup, First payoff, Escalation, Proof, Turn, Resolution, CTA), and a one-sentence summary of what happens.
3. "stealables": exactly 3 specific, transferable techniques this video used. Be concrete ("names the dollar figure before explaining the method"), never generic ("has good energy").
4. "outline": a 5-step blank outline another creator could follow to make their own video on this pattern, in [bracketed slots] where their own subject matter goes.

Return JSON: {
  "hook": { "openingLines": "string", "hookType": "string", "whyItWorks": "string" },
  "beats": [{ "timestamp": "string", "label": "string", "summary": "string" }],
  "stealables": ["string", "string", "string"],
  "outline": ["string", "string", "string", "string", "string"]
}`;

  const response = await callMesh(prompt, SYSTEM_PROMPT);
  const parsed = parseMeshJson<Omit<VideoTeardown, 'transcriptAvailable'>>(response);

  return {
    transcriptAvailable: true,
    hook: parsed.hook ?? null,
    beats: parsed.beats ?? [],
    stealables: (parsed.stealables ?? []).slice(0, 3),
    outline: parsed.outline ?? [],
  };
}

// --- Thumbnail DNA ----------------------------------------------------------

export interface ThumbnailDna {
  /** The headline rule, stated as something a creator can obey. */
  rule: string;
  /** Counted observations across the set, e.g. "10 of 12 show a human face". */
  observations: string[];
  checklist: string[];
  /** A prompt that can be handed straight to the thumbnail generator. */
  generationPrompt: string;
}

// Vision calls are priced per image; a dozen is enough to establish a pattern.
const MAX_THUMBNAILS = 12;

/**
 * Reads the actual pixels of the niche's top outlier thumbnails and states the
 * pattern they share. The output is deliberately a *rule*, not a description —
 * "≤3 words of text on a red ground with a shocked face" is actionable in a way
 * that "thumbnails are eye-catching" never is.
 */
export async function getThumbnailDna(input: {
  niche: string;
  thumbnails: string[];
  titles: string[];
}): Promise<ThumbnailDna> {
  const images = input.thumbnails.filter(Boolean).slice(0, MAX_THUMBNAILS);
  if (images.length < 3) {
    throw new Error('Need at least 3 thumbnails to find a pattern.');
  }

  const titleList = input.titles.slice(0, images.length).map((t, i) => `${i + 1}. ${t}`).join('\n');

  const prompt = `These are the ${images.length} highest-outlier YouTube thumbnails in the "${input.niche}" niche right now (each beat its own channel's average by a wide margin).

Their titles, in the same order:
${titleList}

Study the images and identify what they have in common. Count things explicitly — how many show a human face, how many use text, typical word count of that text, dominant background colors, use of arrows/circles/red rings, facial expression, whether the subject looks at the camera.

Return:
- "rule": one sentence stating the pattern as an instruction a creator can follow. Include counts. Example shape: "9 of 12 use 3 words or fewer over a high-contrast face on a saturated red or yellow ground."
- "observations": 4 counted observations, each referencing how many of the ${images.length} images it applies to.
- "checklist": 4 short imperative items for designing a thumbnail that fits this niche.
- "generationPrompt": a single vivid prompt (under 60 words) for an image model to produce a thumbnail in this style, with [SUBJECT] left as a placeholder for the creator's topic.

Return JSON only: { "rule": "string", "observations": ["string"], "checklist": ["string"], "generationPrompt": "string" }`;

  const response = await callMeshVision(
    prompt,
    images,
    'You are a thumbnail designer who reverse-engineers what makes YouTube thumbnails get clicked. You count precisely and never invent details you cannot see. Always return valid JSON only.'
  );

  const parsed = parseMeshJson<ThumbnailDna>(response);
  return {
    rule: parsed.rule ?? '',
    observations: parsed.observations ?? [],
    checklist: parsed.checklist ?? [],
    generationPrompt: parsed.generationPrompt ?? '',
  };
}
