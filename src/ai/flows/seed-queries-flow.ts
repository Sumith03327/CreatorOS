'use server';
/**
 * @fileOverview Generates diverse search queries for exploring a niche.
 *
 * Discovery used to run four hardcoded variants — "<niche> tips", "<niche>
 * tutorial", "<niche> channel", "<niche> explained" — which all retrieve the
 * same well-known channels, because they're the ones that rank for the niche's
 * head term. Real coverage comes from long-tail subtopics, where smaller
 * channels are the ones that rank.
 */

import { callMesh } from '@/services/mesh';
import { parseMeshJson } from '@/lib/mesh-json';

export interface SeedQueriesOutput {
  queries: string[];
}

const MAX_QUERIES = 6;

/**
 * Turns a channel's best-performing titles into the search queries it competes
 * on. Searching the raw titles doesn't work — they're long, punctuated and
 * personal ("Don't make this silly mistake after buying a home in india"). What
 * we want is the query a viewer would type to land on a video like that, because
 * the channels ranking for it are the ones fighting for the same viewers.
 */
export async function getCompetitorQueries(input: {
  channelTitle: string;
  topTitles: string[];
}): Promise<SeedQueriesOutput> {
  const titles = input.topTitles.slice(0, 8).map(t => `- ${t}`).join('\n');

  const prompt = `The YouTube channel "${input.channelTitle}" had these as its best-performing recent videos:

${titles}

Give 3 search queries a viewer would type to find videos like these. Rules:
- 2-5 words each, the way people actually search.
- Describe the SUBJECT, not this channel — never include the channel's name.
- Cover the channel's main themes, one query each. Do not rephrase one theme three ways.

Return JSON: { "queries": ["string", "string", "string"] }`;

  const response = await callMesh(prompt, 'You are a YouTube search strategist. Always return valid JSON only.');
  const parsed = parseMeshJson<SeedQueriesOutput>(response);
  const queries = (parsed.queries ?? []).map(q => q.trim()).filter(Boolean);
  return { queries: queries.slice(0, 3) };
}

export async function getNicheSeedQueries(input: { niche: string }): Promise<SeedQueriesOutput> {
  const prompt = `A creator researches the YouTube niche "${input.niche}".

Give ${MAX_QUERIES} search queries that would surface DIFFERENT corners of this niche — the long-tail subtopics where smaller channels rank, not the head term where only the giants do.

Rules:
- Each query is 2-5 words, the kind of thing a viewer actually searches.
- Cover genuinely distinct subtopics, not rephrasings of each other.
- Do not include the words "tips", "tutorial", "channel" or "explained" — those retrieve the same handful of big channels every time.
- Do not include the bare niche name on its own.

Return JSON: { "queries": ["string", ...] }`;

  const response = await callMesh(prompt, 'You are a YouTube search strategist. Always return valid JSON only.');
  const parsed = parseMeshJson<SeedQueriesOutput>(response);
  const queries = (parsed.queries ?? [])
    .map(q => q.trim())
    .filter(q => q.length > 2 && q.toLowerCase() !== input.niche.toLowerCase());
  return { queries: queries.slice(0, MAX_QUERIES) };
}
