'use server';
/**
 * @fileOverview Durable agent memory. After a conversation, distill the small
 * set of STABLE, reusable facts an agent should carry into future, separate
 * chats (the user's channel, niche, audience, recurring preferences, ongoing
 * projects) — NOT the transient back-and-forth of a single session.
 *
 * Runs on the cheap deepseek-v3 JSON mode (per the cost rule: only the agent's
 * live answering may upgrade models; background bookkeeping stays cheap).
 */

import { callMesh } from '@/services/mesh';
import type { ChatMessage } from '@/services/agent-store';

const SYSTEM =
  'You maintain a long-term MEMORY for an AI agent that helps a specific user over many separate conversations. ' +
  'You are given the current memory and the latest conversation. Update the memory so the agent can pick up ' +
  'where it left off next time. ' +
  'RULES: ' +
  '- Keep ONLY durable, reusable facts: who the user is, their channel/niche/audience, stated goals, ongoing projects, and firm preferences. ' +
  '- DROP one-off requests, pleasantries, and anything specific to a single task. ' +
  '- Merge new facts with the existing memory; correct anything the user contradicted; never duplicate. ' +
  '- Be concise: at most ~10 short bullet-style lines, each a single fact. If there is nothing worth remembering, return an empty string. ' +
  'Return STRICT JSON: {"memory": string}. No text outside the JSON.';

const MAX_MEMORY_CHARS = 1200;

/** How many trailing messages of the conversation to consider. */
const RECENT_WINDOW = 12;

export async function updateAgentMemory(input: {
  existingMemory: string;
  messages: ChatMessage[];
}): Promise<string> {
  const recent = input.messages.slice(-RECENT_WINDOW);
  if (recent.length === 0) return input.existingMemory;

  const transcript = recent
    .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`)
    .join('\n');

  const prompt =
    `CURRENT MEMORY:\n${input.existingMemory || '(empty)'}\n\n` +
    `LATEST CONVERSATION:\n${transcript}\n\n` +
    'Return the updated memory.';

  try {
    const raw = await callMesh(prompt, SYSTEM);
    const parsed = JSON.parse(raw);
    const memory = String(parsed.memory ?? '').trim();
    return memory.slice(0, MAX_MEMORY_CHARS);
  } catch (e) {
    console.error('updateAgentMemory failed (keeping existing memory):', e);
    return input.existingMemory;
  }
}
