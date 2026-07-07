'use server';
/**
 * @fileOverview A Mesh API flow for deep channel overview analysis including Identity and Monetization.
 */

import { z } from 'zod';
import { callMesh } from '@/services/mesh';

const AnalyzeChannelOverviewInputSchema = z.object({
  channelTitle: z.string(),
  channelDescription: z.string(),
  recentVideoTitles: z.array(z.string()),
  recentVideoDescriptions: z.array(z.string()),
});
export type AnalyzeChannelOverviewInput = z.infer<typeof AnalyzeChannelOverviewInputSchema>;

const AnalyzeChannelOverviewOutputSchema = z.object({
  identity: z.object({
    nicheTag: z.string().describe('Short niche label (e.g., Socio-Political Commentary).'),
    contentTone: z.enum(['Educational', 'Entertainment', 'Motivational', 'News', 'Mixed']).describe('Primary tone of the content.'),
    targetAudience: z.string().describe('One line description of the target audience.'),
  }),
  monetization: z.object({
    hasAdSense: z.boolean().describe('Likelihood of AdSense based on video characteristics.'),
    hasSponsorships: z.boolean().describe('Detected sponsorship signals.'),
    hasMerch: z.boolean().describe('Detected merchandise signals.'),
    hasMemberships: z.boolean().describe('Detected membership signals.'),
    revenueStage: z.enum(['Early', 'Growing', 'Established']).describe('Estimated revenue stage based on metrics.'),
  }),
});
export type AnalyzeChannelOverviewOutput = z.infer<typeof AnalyzeChannelOverviewOutputSchema>;

export async function analyzeChannelOverview(input: AnalyzeChannelOverviewInput): Promise<AnalyzeChannelOverviewOutput> {
  const systemPrompt = "You are a YouTube growth and monetization expert. Always return valid JSON only.";

  const titlesList = input.recentVideoTitles.map(t => `- ${t}`).join('\n');
  const descriptionsList = input.recentVideoDescriptions.map(d => `- ${d}`).join('\n');

  const promptStr = `Analyze the following channel metadata to determine its identity and monetization status.

Channel: ${input.channelTitle}
Description: ${input.channelDescription}

Recent Video Titles:
${titlesList}

Recent Video Descriptions:
${descriptionsList}

Tasks:
1. Identify the Niche (one short label).
2. Determine the Content Tone (Educational, Entertainment, Motivational, News, or Mixed).
3. Define the Target Audience in one line.
4. Detect Monetization Signals:
   - AdSense: Likely if content is original and videos are typically longer format.
   - Sponsorships: Look for 'sponsored', 'brand', 'link', 'promo'.
   - Merch: Look for 'shop', 'merch', 'store'.
   - Memberships: Look for 'join', 'members', 'perks'.
5. Estimate Revenue Stage:
   - Early: Small scale, starting monetization.
   - Growing: Consistent signals, mid-sized audience.
   - Established: High production, clear multiple revenue streams.

Return JSON structure:
{
  "identity": {
    "nicheTag": "string",
    "contentTone": "Educational" | "Entertainment" | "Motivational" | "News" | "Mixed",
    "targetAudience": "string"
  },
  "monetization": {
    "hasAdSense": boolean,
    "hasSponsorships": boolean,
    "hasMerch": boolean,
    "hasMemberships": boolean,
    "revenueStage": "Early" | "Growing" | "Established"
  }
}`;

  const response = await callMesh(promptStr, systemPrompt);
  return JSON.parse(response) as AnalyzeChannelOverviewOutput;
}
