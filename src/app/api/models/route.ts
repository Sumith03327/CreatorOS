/**
 * @fileOverview Image-model catalog endpoint for the Thumbnail Studio picker.
 *
 * Thin pass-through over `listImageModels()` (which caches for 10 minutes).
 * Exists because the catalog needs the Mesh key, which must never reach the client.
 */

import { listImageModels } from '@/services/mesh-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const models = await listImageModels();
    return Response.json({ models });
  } catch (e: any) {
    console.error('Model catalog error:', e);
    return Response.json({ error: e?.message || 'Could not load models.' }, { status: 502 });
  }
}
