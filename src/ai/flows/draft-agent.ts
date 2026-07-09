'use server';
/**
 * @fileOverview "Describe an agent to build" — turns a one-line description into
 * a ready-to-review agent draft (name, category, description, system prompt).
 * A lite slice of the future full auto-builder. Cheap deepseek JSON mode.
 */

import { callMesh } from '@/services/mesh';

export interface AgentDraft {
  name: string;
  category: string;
  description: string;
  instructions: string;
  useYouTubeContext: boolean;
}

const SYSTEM =
  'You design AI agents for a YouTube creator platform. Given a short description of what the user wants, ' +
  'return STRICT JSON: {"name":string,"category":string,"description":string,"instructions":string,"useYouTubeContext":boolean}. ' +
  '- name: 2-4 words, punchy. ' +
  '- category: one word (e.g. Design, Growth, Finance, Writing, Custom). ' +
  '- description: one sentence on what it helps with. ' +
  '- instructions: a strong, specific SYSTEM PROMPT (3-6 sentences) telling the agent its role, how to help, and to ask for missing info. Write it in second person ("You are..."). ' +
  '- useYouTubeContext: true only if the agent clearly benefits from live YouTube channel/video data. ' +
  'No text outside the JSON.';

export async function draftAgent(idea: string): Promise<AgentDraft> {
  const raw = await callMesh(`User wants: "${idea}"`, SYSTEM);
  const p = JSON.parse(raw);
  return {
    name: String(p.name || 'New Agent').slice(0, 60),
    category: String(p.category || 'Custom').slice(0, 24),
    description: String(p.description || '').slice(0, 200),
    instructions: String(p.instructions || ''),
    useYouTubeContext: Boolean(p.useYouTubeContext),
  };
}
