/**
 * @fileOverview Non-streaming Research endpoint — used only when accurate
 * citations matter more than live token-by-token typing (Perplexity models
 * on Mesh only expose real source data on the non-streaming response shape;
 * see callMeshWithCitations in src/services/mesh.ts). Deliberately separate
 * from /api/agents/chat: that route's SSE tool-calling loop is built for a
 * different job (tool detection), and Perplexity has no tool-calling
 * endpoint on Mesh anyway, so this is a plain single request/response call.
 */

import { callMeshWithCitations, type MeshMessage } from '@/services/mesh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AskBody {
  instructions: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  model?: string;
}

export async function POST(req: Request) {
  let body: AskBody;
  try {
    body = (await req.json()) as AskBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body?.instructions || !body?.userMessage) {
    return Response.json({ error: 'instructions and userMessage are required' }, { status: 400 });
  }

  const messages: MeshMessage[] = [
    { role: 'system', content: body.instructions },
    ...(body.history ?? []).map((h) => ({ role: h.role, content: h.content }) as MeshMessage),
    { role: 'user', content: body.userMessage },
  ];

  try {
    const { content, citations } = await callMeshWithCitations(messages, body.model);
    return Response.json({ content, citations });
  } catch (e: any) {
    console.error('Research ask error:', e);
    return Response.json({ error: e?.message || 'Research request failed.' }, { status: 502 });
  }
}
