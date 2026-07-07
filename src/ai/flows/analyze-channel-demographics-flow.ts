
'use server';
/**
 * @fileOverview A Mesh API flow for analyzing YouTube channel demographics.
 */

import { z } from 'zod';
import { callMesh } from '@/services/mesh';
import { parseMeshJson } from '@/lib/mesh-json';

const AnalyzeChannelInputSchema = z.object({
  title: z.string(),
  description: z.string(),
  viewCount: z.string(),
  subscriberCount: z.string(),
  videoCount: z.string(),
  country: z.string().optional(),
  publishedAt: z.string(),
});
export type AnalyzeChannelInput = z.infer<typeof AnalyzeChannelInputSchema>;

const AnalyzeChannelOutputSchema = z.object({
  estimatedNiche: z.string().describe('The identified niche of the channel.'),
  growthStage: z.enum(['Emerging', 'Established', 'Authority', 'Legendary']).describe('The current growth stage of the channel.'),
  audiencePersona: z.string().describe('A detailed description of the typical viewer.'),
  performanceScore: z.number().min(0).max(100).describe('A score from 0-100 based on stats.'),
  demographicInsights: z.string().describe('Insights about the channel demographics and reach.'),
});
export type AnalyzeChannelOutput = z.infer<typeof AnalyzeChannelOutputSchema>;

export async function analyzeChannelDemographics(input: AnalyzeChannelInput): Promise<AnalyzeChannelOutput> {
  const systemPrompt = "You are a YouTube audience research expert. Analyze channel data and return deep, specific audience insights that a new creator can actually use to model their content. Always return valid JSON only.";

  const promptStr = `Analyze the following YouTube channel data to determine its growth stage, niche, and deep audience profile.

Channel Name: ${input.title}
Description: ${input.description}
Total Views: ${input.viewCount}
Subscribers: ${input.subscriberCount}
Videos: ${input.videoCount}
Country: ${input.country || 'Global'}
Joined Date: ${input.publishedAt}

Based on this data, return a report in JSON format with exactly these fields:
- estimatedNiche: The primary niche.
- growthStage: One of ['Emerging', 'Established', 'Authority', 'Legendary'].
- audiencePersona: A detailed profiling of who watches this channel.
- performanceScore: A number (0-100) reflecting their growth efficiency.
- demographicInsights: Specific insights about their reach and global appeal.

Return JSON structure:
{
  "estimatedNiche": "string",
  "growthStage": "Emerging" | "Established" | "Authority" | "Legendary",
  "audiencePersona": "string",
  "performanceScore": number,
  "demographicInsights": "string"
}`;

  const response = await callMesh(promptStr, systemPrompt);
  return parseMeshJson<AnalyzeChannelOutput>(response);
}
