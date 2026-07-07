
'use server';
/**
 * @fileOverview A Mesh API flow for bulk analysis of multiple YouTube video scripts.
 */

import { z } from 'zod';
import { callMesh } from '@/services/mesh';

const SingleVideoAnalysisSchema = z.object({
  videoId: z.string(),
  hook: z.object({
    score: z.number().min(0).max(10),
    explanation: z.string(),
  }),
  scriptStructureRating: z.string(),
  emotionalTone: z.string(),
  titleSuggestions: z.array(z.string()),
  quotableLines: z.array(z.string()),
  nextVideoIdea: z.string(),
});

const MaxAnalysisInputSchema = z.object({
  videos: z.array(z.object({
    videoId: z.string(),
    title: z.string(),
    transcript: z.string(),
  })),
});
export type MaxAnalysisInput = z.infer<typeof MaxAnalysisInputSchema>;

const MaxAnalysisOutputSchema = z.object({
  analyses: z.array(SingleVideoAnalysisSchema),
});
export type MaxAnalysisOutput = z.infer<typeof MaxAnalysisOutputSchema>;

export async function analyzeVideosBulk(input: MaxAnalysisInput): Promise<MaxAnalysisOutput> {
    const videosContext = input.videos.map(v => `
Video ID: ${v.videoId}
Title: ${v.title}
Transcript: ${v.transcript}
`).join('\n---\n');

    const systemPrompt = "You are Max, an elite YouTube script strategist with 10 years of experience analyzing viral content. You give brutally honest, specific, actionable feedback. Always return valid JSON only.";
    
    const promptStr = `Analyze each of these videos individually and provide a detailed script analysis report.

Videos to analyze:
${videosContext}

For each video, provide:
1. Hook Score (0-10) and a concise explanation.
2. Script Structure Rating (e.g., "Solid Build", "Loose Pacing", etc.).
3. Emotional Tone description.
4. Exactly 3 improved, high-CTR title suggestions.
5. Exactly 3 key quotable lines from the transcript.
6. One "Next Video" idea that naturally follows the content of this one.

Return the results as a JSON object containing an array of 'analyses' matching this structure:
{
  "analyses": [
    {
      "videoId": "string",
      "hook": { "score": number, "explanation": "string" },
      "scriptStructureRating": "string",
      "emotionalTone": "string",
      "titleSuggestions": ["string", "string", "string"],
      "quotableLines": ["string", "string", "string"],
      "nextVideoIdea": "string"
    }
  ]
}`;

    const response = await callMesh(promptStr, systemPrompt);
    return JSON.parse(response) as MaxAnalysisOutput;
}
