
'use server';

/**
 * @fileOverview Mesh API service — unified LLM gateway (https://meshapi.ai).
 * Replaces the previous Genkit/Google Gemini and direct DeepSeek integrations.
 */

const MESH_API_URL = 'https://api.meshapi.ai/v1/chat/completions';
// NOTE: the active Mesh API key is scoped to this model only. Other models
// (gemini, gpt, claude, etc.) return HTTP 403 "not permitted for this API key".
// If the key's plan changes, update this and verify with a live request.
const DEFAULT_MODEL = 'deepseek-ai/deepseek-v3';

export interface MeshMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function meshRequest(
  messages: MeshMessage[],
  options: { responseFormat?: Record<string, any>; model?: string; temperature?: number } = {}
): Promise<string> {
  const apiKey = process.env.MESH_API_KEY;

  if (!apiKey) {
    console.error('Mesh API Key is missing (MESH_API_KEY)');
    throw new Error('Mesh API Key is missing');
  }

  const response = await fetch(MESH_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || DEFAULT_MODEL,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: 2000,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Mesh API Error:', errorText);
    throw new Error(`Mesh API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Single-turn call that returns a JSON string (json_object mode).
 * Drop-in replacement for the old callDeepSeek — callers JSON.parse() the result.
 */
export async function callMesh(prompt: string, systemPrompt: string, model?: string): Promise<string> {
  return meshRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    { model, responseFormat: { type: 'json_object' } }
  );
}

/**
 * Single-turn call that returns free-form text (no JSON constraint).
 */
export async function callMeshText(prompt: string, systemPrompt: string, model?: string): Promise<string> {
  return meshRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    { model }
  );
}

/**
 * Multi-turn conversational call — used for custom "Build Your Own Agent" chats.
 */
export async function callMeshChat(messages: MeshMessage[], model?: string): Promise<string> {
  return meshRequest(messages, { model });
}
