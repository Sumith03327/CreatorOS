/**
 * @fileOverview SSE streaming endpoint for the Agents chat.
 *
 * Consumes the agent tool-calling loop and streams events to the browser as
 * newline-delimited JSON (one event per line). Each event is either:
 *   { "type": "status", "content": "Reading channel…" }
 *   { "type": "text",   "content": "…partial answer…" }
 *   { "type": "error",  "content": "…" }
 */

import { runCustomAgentStream, type RunCustomAgentInput } from '@/ai/flows/run-custom-agent-flow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: RunCustomAgentInput;
  try {
    body = (await req.json()) as RunCustomAgentInput;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  if (!body?.instructions || !body?.userMessage) {
    return new Response(JSON.stringify({ error: 'instructions and userMessage are required' }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        for await (const ev of runCustomAgentStream(body)) {
          send(ev);
        }
      } catch (e: any) {
        send({ type: 'error', content: e?.message || 'Agent stream failed.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
