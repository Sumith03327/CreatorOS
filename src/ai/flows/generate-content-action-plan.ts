'use server';
/**
 * @fileOverview A Mesh API flow for generating personalized strategic steps and content ideas for YouTube creators.
 *
 * - generateContentActionPlan - A function that handles the generation of a content action plan.
 * - GenerateContentActionPlanInput - The input type for the generateContentActionPlan function.
 * - GenerateContentActionPlanOutput - The return type for the generateContentActionPlan function.
 */

import { z } from 'zod';
import { callMesh } from '@/services/mesh';

const GenerateContentActionPlanInputSchema = z.object({
  channelAnalysisSummary: z.string().describe('A summary of the AI\'s analysis of the YouTube channel\'s performance, retention, and audience behavior.'),
  recentCreatorTip: z.string().optional().describe('An optional recent AI-generated tip to incorporate into the action plan.'),
});
export type GenerateContentActionPlanInput = z.infer<typeof GenerateContentActionPlanInputSchema>;

const GenerateContentActionPlanOutputSchema = z.object({
  strategicSteps: z.array(z.string()).describe('A list of actionable strategic steps to improve channel growth and engagement.'),
  contentIdeas: z.array(z.string()).describe('A list of new content ideas based on the analysis and recommendations.'),
});
export type GenerateContentActionPlanOutput = z.infer<typeof GenerateContentActionPlanOutputSchema>;

export async function generateContentActionPlan(input: GenerateContentActionPlanInput): Promise<GenerateContentActionPlanOutput> {
  const systemPrompt = "You are an expert YouTube content strategist and AI assistant named CreatorOS. Always return valid JSON only.";

  const promptStr = `Here is a summary of the AI's analysis of the channel's performance, retention, and audience behavior:
${input.channelAnalysisSummary}
${input.recentCreatorTip ? `\nHere is a recent personalized creator tip:\n${input.recentCreatorTip}\n` : ''}
Based on the provided analysis and tips, generate a list of strategic steps and new content ideas.

Strategic Steps should be actionable and focused on improving growth and engagement.
Content Ideas should be creative, relevant, and aligned with the channel's niche and audience.

Return JSON structure:
{
  "strategicSteps": ["string"],
  "contentIdeas": ["string"]
}`;

  const response = await callMesh(promptStr, systemPrompt);
  return JSON.parse(response) as GenerateContentActionPlanOutput;
}
