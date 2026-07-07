'use server';
/**
 * @fileOverview A Mesh API flow for generating personalized AI tips for YouTube creators.
 *
 * - providePersonalizedCreatorTips - A function that generates a personalized creator tip.
 * - ProvidePersonalizedCreatorTipsInput - The input type for the providePersonalizedCreatorTips function.
 * - ProvidePersonalizedCreatorTipsOutput - The return type for the providePersonalizedCreatorTips function.
 */

import { z } from 'zod';
import { callMesh } from '@/services/mesh';

const ProvidePersonalizedCreatorTipsInputSchema = z.object({
  channelName: z.string().describe('The name of the YouTube channel.'),
  channelNiche: z.string().describe('The niche or category of the YouTube channel (e.g., "Tech & Innovation Insights").'),
  subscriberCount: z.number().int().min(0).describe('The current subscriber count of the channel.'),
  recentPerformanceSummary: z.string().describe('A summary of recent channel performance, including specific insights or areas for improvement (e.g., "Your hook duration in the last 3 videos is 15% shorter than your average.").'),
  latestUploadSummary: z.string().describe("A summary of the latest upload's performance and key retention insights (e.g., \"Smart analysis of your latest upload's performance indicates a peak retention at 2:30 mark.\")."),
});
export type ProvidePersonalizedCreatorTipsInput = z.infer<typeof ProvidePersonalizedCreatorTipsInputSchema>;

const ProvidePersonalizedCreatorTipsOutputSchema = z.object({
  tip: z.string().describe('A personalized, actionable tip for the creator.'),
});
export type ProvidePersonalizedCreatorTipsOutput = z.infer<typeof ProvidePersonalizedCreatorTipsOutputSchema>;

export async function providePersonalizedCreatorTips(
  input: ProvidePersonalizedCreatorTipsInput
): Promise<ProvidePersonalizedCreatorTipsOutput> {
  const systemPrompt = "You are an AI assistant specialized in providing personalized, actionable tips for YouTube content creators to optimize their channels. Always return valid JSON only.";

  const promptStr = `Give a single, concise tip that is highly relevant to the creator's channel and recent performance.

- Channel Name: ${input.channelName}
- Channel Niche: ${input.channelNiche}
- Subscriber Count: ${input.subscriberCount}
- Recent Performance Summary: ${input.recentPerformanceSummary}
- Latest Upload Summary: ${input.latestUploadSummary}

Based on this information, provide one highly relevant and actionable tip. Focus on helping the creator continuously optimize their strategy.

Example Tip: "Your hook duration in the last 3 videos is 15% shorter than your average. Try expanding the intro to 12 seconds to boost initial engagement."

Return JSON structure:
{
  "tip": "string"
}`;

  const response = await callMesh(promptStr, systemPrompt);
  return JSON.parse(response) as ProvidePersonalizedCreatorTipsOutput;
}
