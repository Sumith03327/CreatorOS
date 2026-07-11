/**
 * @fileOverview Chat-model catalog endpoint for Script with Max's model picker.
 *
 * Thin pass-through over `listChatModels()` (which caches for 10 minutes).
 * Exists because the catalog needs the Mesh key, which must never reach the client.
 */

import { listChatModels } from '@/services/mesh-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const models = await listChatModels();
    return Response.json({ models });
  } catch (e: any) {
    console.error('Chat model catalog error:', e);
    return Response.json({ error: e?.message || 'Could not load models.' }, { status: 502 });
  }
}
