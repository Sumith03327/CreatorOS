'use server';
/**
 * @fileOverview A Mesh API flow for analyzing YouTube video scripts and transcripts.
 */

import { z } from 'zod';
import { callMesh } from '@/services/mesh';

const AnalyzeScriptInputSchema = z.object({
  transcript: z.string().describe('The full transcript text of the video.'),
  videoTitle: z.string().describe('The title of the video for context.'),
});
export type AnalyzeScriptInput = z.infer<typeof AnalyzeScriptInputSchema>;

const AnalyzeScriptOutputSchema = z.object({
  hook: z.object({
    score: z.number().min(0).max(10).describe('Hook strength score out of 10.'),
    text: z.string().describe('What the hook actually was.'),
  }),
  structure: z.object({
    rating: z.string().describe('A descriptive rating of the overall script structure (e.g., "Well-paced and logical").'),
    details: z.string().describe('Short explanation of why this rating was given.'),
  }),
  bestMoment: z.string().describe('The most engaging part of the video.'),
  weakSpots: z.array(z.string()).describe('List of segments where viewers likely dropped off.'),
  emotionalTone: z.string().describe('The overall emotional tone throughout the video.'),
  improvements: z.array(z.string()).describe('Three specific actionable improvements for future scripts.'),
});
export type AnalyzeScriptOutput = z.infer<typeof AnalyzeScriptOutputSchema>;

export async function analyzeScript(input: AnalyzeScriptInput): Promise<AnalyzeScriptOutput> {
  const systemPrompt = "You are a viral YouTube script doctor. Always return valid JSON only.";

  const promptStr = `Analyze this video transcript and return a detailed report.

Video Title: ${input.videoTitle}

Transcript:
${input.transcript}

Analyze the following:
1. Hook strength score (0-10) and identify the specific hook used.
2. Overall script structure rating and pacing.
3. The "Best Performing Moment" - the part where audience engagement is likely highest.
4. Weak spots or "Boring Zones" where viewers likely dropped off.
5. The emotional tone of the delivery.
6. Exactly three specific, actionable improvements to make the next script better.

Return JSON structure:
{
  "hook": { "score": number, "text": "string" },
  "structure": { "rating": "string", "details": "string" },
  "bestMoment": "string",
  "weakSpots": ["string"],
  "emotionalTone": "string",
  "improvements": ["string", "string", "string"]
}`;

  const response = await callMesh(promptStr, systemPrompt);
  return JSON.parse(response) as AnalyzeScriptOutput;
}
