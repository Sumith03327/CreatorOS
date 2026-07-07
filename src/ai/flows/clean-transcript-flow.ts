
'use server';
/**
 * @fileOverview A Mesh API flow for cleaning and formatting raw YouTube transcripts.
 */

import { z } from 'zod';
import { callMeshText } from '@/services/mesh';

const CleanTranscriptInputSchema = z.object({
  rawTranscript: z.string().describe('The raw auto-generated transcript from YouTube.'),
});
export type CleanTranscriptInput = z.infer<typeof CleanTranscriptInputSchema>;

const CleanTranscriptOutputSchema = z.object({
  cleanedTranscript: z.string().describe('The polished, punctuated, and formatted transcript.'),
});
export type CleanTranscriptOutput = z.infer<typeof CleanTranscriptOutputSchema>;

export async function cleanTranscript(input: CleanTranscriptInput): Promise<CleanTranscriptOutput> {
  const systemPrompt = "You are a transcript cleaner. Return only the clean transcript text, nothing else.";

  const promptStr = `Take this raw YouTube auto-caption text and return a clean, properly formatted transcript. Fix all punctuation, remove filler words like um uh you know basically, break into logical paragraphs every 4-5 sentences, fix grammar mistakes from speech-to-text errors.

Raw Transcript:
${input.rawTranscript}`;

  const text = await callMeshText(promptStr, systemPrompt);
  return { cleanedTranscript: text || '' };
}
