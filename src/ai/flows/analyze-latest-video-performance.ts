'use server';
/**
 * @fileOverview A Mesh API agent that analyzes the performance of a YouTube video.
 *
 * - analyzeLatestVideoPerformance - A function that handles the video analysis process.
 * - AnalyzeLatestVideoPerformanceInput - The input type for the analyzeLatestVideoPerformance function.
 * - AnalyzeLatestVideoPerformanceOutput - The return type for the analyzeLatestVideoPerformance function.
 */

import { z } from 'zod';
import { callMesh } from '@/services/mesh';

const AudienceRetentionDataSchema = z.object({
  timeInSeconds: z.number().describe('Timestamp in seconds.'),
  percentage: z.number().describe('Percentage of viewers remaining at this timestamp.'),
});

const VideoMetricsSchema = z.object({
  views: z.number().describe('Total views for the video.'),
  watchTimeHours: z.number().describe('Total watch time in hours for the video.'),
  averageViewDurationSeconds: z.number().describe('Average view duration in seconds for the video.'),
  audienceRetentionData: z.array(AudienceRetentionDataSchema).describe('Audience retention data points over time.'),
});

const AnalyzeLatestVideoPerformanceInputSchema = z.object({
  videoTitle: z.string().describe('The title of the latest YouTube video.'),
  videoDescription: z.string().describe('The description of the latest YouTube video.'),
  videoTranscript: z.string().describe('The full transcript of the latest YouTube video.'),
  videoMetrics: VideoMetricsSchema.describe('Key performance metrics for the video, including audience retention data.'),
  channelNiche: z.string().describe('The primary niche or topic of the YouTube channel.'),
});
export type AnalyzeLatestVideoPerformanceInput = z.infer<typeof AnalyzeLatestVideoPerformanceInputSchema>;

const AnalyzeLatestVideoPerformanceOutputSchema = z.object({
  summary: z.string().describe('A summarized report of the video\'s overall performance.'),
  insights: z.string().describe('Actionable insights derived from the performance data.'),
  retentionAnalysis: z.string().describe('Detailed analysis of audience retention patterns.'),
  recommendations: z.string().describe('Specific recommendations for improving future video performance.'),
});
export type AnalyzeLatestVideoPerformanceOutput = z.infer<typeof AnalyzeLatestVideoPerformanceOutputSchema>;

export async function analyzeLatestVideoPerformance(input: AnalyzeLatestVideoPerformanceInput): Promise<AnalyzeLatestVideoPerformanceOutput> {
  const systemPrompt = "You are an expert YouTube content strategist and data analyst. Always return valid JSON only.";

  const retentionList = input.videoMetrics.audienceRetentionData
    .map(d => `- ${d.timeInSeconds}s: ${d.percentage}%`)
    .join('\n');

  const promptStr = `Analyze the performance of this YouTube video and provide a comprehensive report.

Video Title: ${input.videoTitle}
Video Description: ${input.videoDescription}
Video Transcript: ${input.videoTranscript}
Channel Niche: ${input.channelNiche}

Video Metrics:
Views: ${input.videoMetrics.views}
Watch Time (Hours): ${input.videoMetrics.watchTimeHours}
Average View Duration (Seconds): ${input.videoMetrics.averageViewDurationSeconds}
Audience Retention Data (time in seconds: percentage):
${retentionList}

Based on the provided information, generate the following:

1. Summary: Provide a concise summary of the video's overall performance. Highlight key achievements and potential areas of concern.
2. Insights: Offer actionable insights. What does the data tell us about audience behavior, content effectiveness, and engagement?
3. Retention Analysis: Analyze the audience retention data. Identify key drop-off points, segments with high engagement, and speculate on the reasons behind these patterns based on the video transcript.
4. Recommendations: Provide specific, data-driven recommendations for improving future content, including suggestions for video structure, topic selection, and engagement strategies.

Return JSON structure:
{
  "summary": "string",
  "insights": "string",
  "retentionAnalysis": "string",
  "recommendations": "string"
}`;

  const response = await callMesh(promptStr, systemPrompt);
  return JSON.parse(response) as AnalyzeLatestVideoPerformanceOutput;
}
