'use server';
/**
 * @fileOverview Decides whether a video or channel actually belongs to a niche.
 *
 * YouTube's search matches keywords in titles, descriptions, hashtags and
 * translations, so a query for "Finance" happily returns a political news clip
 * that mentioned a budget, a French quiz show, and a video whose only connection
 * is `#finance` in a hashtag salad. Scaling recall without this layer just
 * produces more confident garbage.
 *
 * The classifier is deliberately conservative: it only rejects items that are
 * *clearly* off-topic, because a false rejection silently hides a real outlier
 * while a false acceptance is merely noise the ranking can bury.
 */

import { callMesh } from '@/services/mesh';
import { parseMeshJson } from '@/lib/mesh-json';

export interface RelevanceCandidate {
  id: string;
  title: string;
  /** Channel name for a video; the channel's own name for a channel. */
  context?: string;
  /** First couple of hundred characters of the description, if available. */
  description?: string;
  /** For channels: titles of videos they actually published. Far more telling than a bio. */
  sampleTitles?: string[];
}

// Enough context per item to judge, few enough items to keep the model accurate.
// Channel candidates carry a handful of upload titles each, so their prompts are
// several times larger — oversized batches made Mesh return 500s.
const BATCH_SIZE: Record<'video' | 'channel', number> = { video: 25, channel: 12 };
// Mesh rate-limits and occasionally 500s under a burst of parallel requests.
const MAX_PARALLEL_BATCHES = 3;
const DESCRIPTION_CHARS = 160;
const TITLE_CHARS = 80;
const MAX_SAMPLE_TITLES = 5;
const SYSTEM_PROMPT =
  'You classify whether YouTube content belongs to a topic. You judge by what the content is actually about, never by the language it is in. Always return valid JSON only.';

function renderCandidate(candidate: RelevanceCandidate): string {
  const parts = [`id=${candidate.id}`, `name="${candidate.title}"`];
  if (candidate.context) parts.push(`channel="${candidate.context}"`);
  if (candidate.description) parts.push(`desc="${candidate.description.slice(0, DESCRIPTION_CHARS).replace(/\s+/g, ' ')}"`);
  if (candidate.sampleTitles?.length) {
    const titles = candidate.sampleTitles
      .slice(0, MAX_SAMPLE_TITLES)
      .map(t => `"${t.slice(0, TITLE_CHARS).replace(/\s+/g, ' ')}"`);
    parts.push(`recent uploads: ${titles.join(', ')}`);
  }
  return parts.join(' | ');
}

/**
 * Videos and channels want different strictness. A wrongly-kept video is one bad
 * row the ranking can bury, and wrongly *dropping* one hides a real outlier — so
 * we stay conservative. A wrongly-kept channel sits in a list of sixty claiming to
 * be the niche's rising stars, which is glaring, so there we demand the channel's
 * primary subject actually be the niche.
 */
function rulesFor(kind: 'video' | 'channel', niche: string): string {
  if (kind === 'channel') {
    return [
      `- Reject unless the channel's PRIMARY, recurring subject is "${niche}". Judge from its recent uploads first, its name second, its description last.`,
      `- Reject general news outlets, reaction channels, vlogs, comedy, meme and entertainment channels, even when some uploads touch "${niche}".`,
      `- Reject corporate and brand accounts that publish advertising, campaign films or company announcements. This list is for creators another creator could learn from, and nobody can copy an ad budget.`,
      `- Reject channels whose uploads span many unrelated topics.`,
      `- Keep independent creators who cover "${niche}" consistently, including regional-language ones.`,
    ].join('\n');
  }
  return [
    `- Only reject when you are confident. If a video plausibly belongs, keep it (omit its id).`,
    `- Reject news, politics and entertainment clips that merely mention "${niche}" in passing.`,
    `- Reject videos whose primary subject is a different domain, even when they use the niche's vocabulary or hashtags.`,
  ].join('\n');
}

async function classifyBatch(niche: string, batch: RelevanceCandidate[], kind: 'video' | 'channel'): Promise<Set<string>> {
  const prompt = `Niche: "${niche}"

Below are ${kind}s that a keyword search returned for this niche. Some genuinely belong. Others matched only on a hashtag, a translated word, a passing mention, or an unrelated topic that shares vocabulary.

${batch.map(renderCandidate).join('\n')}

Return the ids of the ${kind}s that do NOT belong in a "${niche}" research list. Rules:
${rulesFor(kind, niche)}
- Language is never a reason to reject. A ${kind} in Hindi, Tamil, Korean or French about "${niche}" belongs.

Return JSON: { "reject": ["id", ...] }  (an empty array if everything belongs)`;

  // One retry: Mesh 500s are usually transient, and a dropped batch silently
  // lets a batch of off-topic channels through.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await callMesh(prompt, SYSTEM_PROMPT);
      const parsed = parseMeshJson<{ reject: string[] }>(response);
      return new Set(parsed.reject ?? []);
    } catch (e) {
      if (attempt === 0) continue;
      // A classifier failure must never empty the page. Keep everything.
      console.warn('Relevance classification failed; keeping this batch:', e);
    }
  }
  return new Set();
}

/**
 * Returns the ids judged clearly off-topic. Any batch that fails contributes no
 * rejections, so the worst case is the unfiltered list we'd have shown anyway.
 */
export async function findIrrelevant(input: {
  niche: string;
  candidates: RelevanceCandidate[];
  kind: 'video' | 'channel';
}): Promise<string[]> {
  const { niche, candidates, kind } = input;
  if (candidates.length === 0) return [];

  const size = BATCH_SIZE[kind];
  const batches: RelevanceCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += size) batches.push(candidates.slice(i, i + size));

  const results: Set<string>[] = [];
  for (let i = 0; i < batches.length; i += MAX_PARALLEL_BATCHES) {
    const window = batches.slice(i, i + MAX_PARALLEL_BATCHES);
    results.push(...(await Promise.all(window.map(batch => classifyBatch(niche, batch, kind)))));
  }

  const rejected: string[] = [];
  for (const set of results) rejected.push(...set);
  // The model occasionally echoes ids that were never sent; ignore those.
  const known = new Set(candidates.map(c => c.id));
  return rejected.filter(id => known.has(id));
}
