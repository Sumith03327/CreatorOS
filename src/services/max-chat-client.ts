'use client';

/**
 * Shared streaming client for Script & Analyses' two chat surfaces (Write
 * and Research). Both stream through the same `/api/agents/chat` endpoint
 * (built for "My Agents" — see run-custom-agent-flow.ts); this just factors
 * out the fetch + NDJSON event parsing so neither component carries its own
 * copy of the same loop.
 */

export interface StreamMaxReplyInput {
  instructions: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  model?: string;
  tools: string[];
  onStatus: (status: string) => void;
  onDelta: (delta: string) => void;
}

/**
 * Perplexity is the one model family on Mesh that (a) has no function-calling
 * endpoint at all — the very first tool-detection call 404s ("No endpoints
 * found that support tool use") if any tool schema is sent — and (b) exposes
 * real citation data, but only on the non-streaming response shape. Both
 * `supportsTools` and Research's streaming-vs-`askMax` branch key off this
 * same check.
 */
export function isPerplexityModel(model?: string): boolean {
  return Boolean(model?.startsWith('perplexity/'));
}

function supportsTools(model?: string): boolean {
  return !isPerplexityModel(model);
}

/** Streams a reply and returns the fully-assembled assistant text. */
export async function streamMaxReply(input: StreamMaxReplyInput): Promise<string> {
  const res = await fetch('/api/agents/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instructions: input.instructions,
      history: input.history,
      userMessage: input.userMessage,
      model: input.model,
      tools: supportsTools(input.model) ? input.tools : [],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assistant = '';

  const handleEvent = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let ev: { type: string; content: string };
    try {
      ev = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (ev.type === 'status') {
      input.onStatus(ev.content);
    } else if (ev.type === 'text') {
      assistant += ev.content;
      input.onDelta(ev.content);
    } else if (ev.type === 'error') {
      throw new Error(ev.content);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handleEvent(line);
  }
  if (buffer.trim()) handleEvent(buffer);

  return assistant;
}

export interface AskMaxInput {
  instructions: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  model?: string;
}

export interface AskMaxResult {
  content: string;
  citations: { title: string; url: string }[];
}

/**
 * Non-streaming counterpart to streamMaxReply, used by Research for
 * Perplexity models — trades live typing for real, complete citations read
 * off Mesh's non-streaming response (see /api/research/ask).
 */
export async function askMax(input: AskMaxInput): Promise<AskMaxResult> {
  const res = await fetch('/api/research/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instructions: input.instructions,
      history: input.history,
      userMessage: input.userMessage,
      model: input.model,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return { content: data.content ?? '', citations: data.citations ?? [] };
}
