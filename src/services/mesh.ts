
'use server';

/**
 * @fileOverview Mesh API service — unified LLM gateway (https://meshapi.ai).
 * Replaces the previous Genkit/Google Gemini and direct DeepSeek integrations.
 */

const MESH_API_URL = 'https://api.meshapi.ai/v1/chat/completions';
// Cheap default model. The existing analysis flows (channel analyzer, research,
// script analysis, etc.) all run on this — deepseek is the cheapest option and
// stays the default so their cost profile is unchanged. Only the Agents feature
// opts into pricier models (Claude/GPT) when a task needs it.
const DEFAULT_MODEL = 'deepseek-ai/deepseek-v3';

/**
 * Resolve the Mesh key. One key, unrestricted — it must reach every model the
 * app routes to (deepseek for reasoning, gpt-4o-mini for vision, gpt-image-1 and
 * gemini-2.5-flash-image for thumbnails).
 *
 * There used to be a fallback to a second, deepseek-scoped key. That was a trap:
 * if the unrestricted key went missing, the app would silently fall back to one
 * that 404s on every image and vision call. Better to fail loudly.
 */
function getMeshKey(): string {
  const apiKey = process.env.MESH_API_KEY_ALL;
  if (!apiKey) {
    console.error('Mesh API Key is missing (set MESH_API_KEY_ALL)');
    throw new Error('Mesh API Key is missing');
  }
  return apiKey;
}

export interface MeshMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// --- Tool-calling types (OpenAI-compatible, confirmed supported by Mesh) ---

export interface MeshToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface MeshToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** A message feeding a tool's result back into the conversation. */
export interface MeshToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

/** An assistant turn that may request tool calls instead of (or alongside) text. */
export interface MeshAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: MeshToolCall[];
}

/** Any message that can appear in a tool-calling loop. */
export type MeshLoopMessage = MeshMessage | MeshAssistantMessage | MeshToolResultMessage;

interface MeshRequestOptions {
  responseFormat?: Record<string, any>;
  model?: string;
  temperature?: number;
  tools?: MeshToolSchema[];
  toolChoice?: 'auto' | 'none' | 'required';
  maxTokens?: number;
}

async function meshRequest(
  messages: MeshMessage[],
  options: MeshRequestOptions = {}
): Promise<string> {
  const message = await meshRequestRaw(messages, options);
  return message.content ?? '';
}

/**
 * Low-level Mesh call that returns the FULL assistant message (including any
 * `tool_calls`), so callers can drive a tool-calling loop. Accepts the richer
 * MeshLoopMessage[] so `tool` result messages can be sent back.
 */
async function meshRequestRaw(
  messages: MeshLoopMessage[],
  options: MeshRequestOptions = {}
): Promise<MeshAssistantMessage> {
  const apiKey = getMeshKey();

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
      max_tokens: options.maxTokens ?? 2000,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.tools ? { tool_choice: options.toolChoice ?? 'auto' } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Mesh API Error:', errorText);
    throw new Error(`Mesh API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message ?? {};
  return {
    role: 'assistant',
    content: message.content ?? null,
    tool_calls: message.tool_calls,
  };
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

/**
 * Vision call — analyze one or more images with a text instruction. Builds an
 * OpenAI-style multimodal `content` array. Defaults to gpt-4o-mini (cheap and
 * confirmed to read YouTube thumbnails well). Returns free-form text.
 */
export async function callMeshVision(
  text: string,
  imageUrls: string[],
  systemPrompt: string,
  model: string = 'openai/gpt-4o-mini'
): Promise<string> {
  const apiKey = getMeshKey();

  const content = [
    { type: 'text', text },
    ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];

  const response = await fetch(MESH_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      temperature: 0.5,
      max_tokens: 700,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Mesh vision error:', errorText);
    throw new Error(`Mesh vision error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * One step of a tool-calling loop: send the conversation (which may include
 * `tool` result messages) plus the tool schemas, and get back the raw assistant
 * message. If it contains `tool_calls`, the caller runs the tools, appends the
 * results, and calls again. If it contains only `content`, that's the final answer.
 */
export async function callMeshWithTools(
  messages: MeshLoopMessage[],
  tools: MeshToolSchema[],
  options: { model?: string; toolChoice?: 'auto' | 'none' | 'required' } = {}
): Promise<MeshAssistantMessage> {
  return meshRequestRaw(messages, {
    tools,
    toolChoice: options.toolChoice ?? 'auto',
    model: options.model,
  });
}

/**
 * Non-streaming JSON completion that keeps the FULL conversation as context
 * (including `tool` results and loaded skills). Used to turn an agent's work
 * into a typed deliverable that a dedicated UI can render, instead of prose.
 */
export async function callMeshJson(messages: MeshLoopMessage[], model?: string): Promise<string> {
  const message = await meshRequestRaw(messages, {
    responseFormat: { type: 'json_object' },
    model,
    // Deliverables (a full upload package, six ranked ideas) run long; a tight
    // cap truncates the object mid-key and the parse fails.
    maxTokens: 4000,
    temperature: 0.3, // structure over creativity
  });
  return message.content ?? '';
}

/**
 * Streaming chat completion. Yields text deltas as they arrive from Mesh's SSE
 * stream. Used for the final assistant turn in the Agents chat so tokens appear
 * in real time.
 */
export async function* streamMeshChat(
  messages: MeshLoopMessage[],
  options: { model?: string; temperature?: number } = {}
): AsyncGenerator<string, void, unknown> {
  const apiKey = getMeshKey();

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
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    const errorText = response.body ? await response.text() : '';
    console.error('Mesh API stream error:', errorText);
    throw new Error(`Mesh API stream error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by newlines; each data line is a JSON chunk.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep the last, possibly-incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Ignore keep-alives / partial frames.
      }
    }
  }
}

export interface MeshCitation {
  title: string;
  url: string;
}

/**
 * Non-streaming call that also surfaces real citations. Mesh strips
 * Perplexity's top-level `citations` array but preserves the sources in
 * `message.annotations` as `url_citation` objects — this only exists on the
 * non-streaming response shape (confirmed: a raw `stream: true` call to the
 * same model carries no annotations in any chunk). Used by Research instead
 * of `streamMeshChat` specifically to get accurate sources rather than
 * relying on the model to format them into the answer text itself.
 */
export async function callMeshWithCitations(
  messages: MeshMessage[],
  model?: string
): Promise<{ content: string; citations: MeshCitation[] }> {
  const apiKey = getMeshKey();

  const response = await fetch(MESH_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Mesh API error:', errorText);
    throw new Error(`Mesh API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message ?? {};
  const annotations = Array.isArray(message.annotations) ? message.annotations : [];
  const citations: MeshCitation[] = annotations
    .filter((a: any) => a?.type === 'url_citation' && a?.url_citation?.url)
    .map((a: any) => ({
      title: String(a.url_citation.title || a.url_citation.url),
      url: String(a.url_citation.url),
    }));

  return { content: message.content ?? '', citations };
}
