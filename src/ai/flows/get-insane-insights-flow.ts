'use server';
/**
 * @fileOverview A Mesh API flow for generating YouTube trend insights and title patterns.
 */

import { z } from 'zod';
import { callMesh } from '@/services/mesh';

const TrendSummaryInputSchema = z.object({
  niche: z.string(),
});
export type TrendSummaryInput = z.infer<typeof TrendSummaryInputSchema>;

const TrendSummaryOutputSchema = z.object({
  bullets: z.array(z.string()).describe('Exactly 3 short punchy bullet points about what is working.'),
});
export type TrendSummaryOutput = z.infer<typeof TrendSummaryOutputSchema>;

const TitlePatternsInputSchema = z.object({
  niche: z.string(),
  titles: z.array(z.string()),
});
export type TitlePatternsInput = z.infer<typeof TitlePatternsInputSchema>;

const TitlePatternsOutputSchema = z.object({
  insights: z.array(z.string()).describe('Exactly 3 insights about title patterns.'),
});
export type TitlePatternsOutput = z.infer<typeof TitlePatternsOutputSchema>;

export async function getTrendSummary(input: TrendSummaryInput): Promise<TrendSummaryOutput> {
  const systemPrompt = "You are a YouTube trend analyst. Always return valid JSON only.";

  const promptStr = `Based on the niche '${input.niche}', what topics and video formats are trending on YouTube in the last 30 days? Give exactly 3 short punchy bullet points about what is working right now. Each bullet should be one sentence max. Be specific and actionable for a new creator.

Return JSON structure:
{
  "bullets": ["string", "string", "string"]
}`;

  const response = await callMesh(promptStr, systemPrompt);
  return JSON.parse(response) as TrendSummaryOutput;
}

export async function getTitlePatterns(input: TitlePatternsInput): Promise<TitlePatternsOutput> {
  const systemPrompt = "You are a YouTube trend analyst. Always return valid JSON only.";

  const titlesList = input.titles.map(t => `- ${t}`).join('\n');

  const promptStr = `Here are the titles of the top trending YouTube videos in the niche '${input.niche}' right now:
${titlesList}

Analyze these titles and return exactly 3 insights about what title patterns, formats, or keywords are working best. Each insight must be one sentence, specific, and actionable.

Return JSON structure:
{
  "insights": ["string", "string", "string"]
}`;

  const response = await callMesh(promptStr, systemPrompt);
  return JSON.parse(response) as TitlePatternsOutput;
}
