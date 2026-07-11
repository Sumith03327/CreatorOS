/**
 * @fileOverview Mesh image service for the Thumbnail Studio.
 *
 * - Text -> image: `openai/gpt-image-1` (GEN_MODEL).
 * - Reference/identity edits: `google/gemini-2.5-flash-image` ("Nano Banana"),
 *   which preserves a person's identity across generations far better than
 *   gpt-image-1 (verified head-to-head). Used to reproduce the actual creator
 *   from their own channel thumbnails. Falls back to gpt-image-1 then text.
 *
 * Plain server-only module (imported by the /api/thumbnails route handler).
 */

const MESH_BASE = 'https://api.meshapi.ai/v1';
const GEN_MODEL = 'openai/gpt-image-1';           // pure text-to-image
const EDIT_MODEL = 'google/gemini-2.5-flash-image'; // identity-preserving reference edits
const EDIT_FALLBACK_MODEL = 'openai/gpt-image-1';   // if Nano Banana can't handle the request

export type ThumbSize = '1536x1024' | '1024x1024' | '1024x1536';
export type ThumbQuality = 'low' | 'medium' | 'high';

function getMeshKey(): string {
  const apiKey = process.env.MESH_API_KEY_ALL;
  if (!apiKey) throw new Error('Mesh API Key is missing (set MESH_API_KEY_ALL)');
  return apiKey;
}

/**
 * Normalize a Mesh image response into an array of <img>-ready srcs.
 * Each item is either a hosted URL, or a `data:` URI (already, or wrapped from base64).
 */
function normalizeImages(data: any): string[] {
  const items = Array.isArray(data?.data) ? data.data : [];
  return items
    .map((it: any) => {
      if (it?.url) return String(it.url); // http(s) URL or a data: URI — both render directly
      if (it?.b64_json) return `data:image/png;base64,${it.b64_json}`;
      return null;
    })
    .filter(Boolean) as string[];
}

async function readError(res: Response): Promise<string> {
  const txt = await res.text();
  try {
    const j = JSON.parse(txt);
    return j?.error?.message || txt;
  } catch {
    return txt;
  }
}

/**
 * Text -> image. Generates `n` thumbnail variations from a finished prompt.
 *
 * `model` is a Mesh image-model id, already validated by the caller against the
 * live catalog (see mesh-models.ts). Falls back to GEN_MODEL when absent.
 */
export async function generateThumbnails(opts: {
  prompt: string;
  size?: ThumbSize;
  n?: number;
  quality?: ThumbQuality;
  model?: string;
}): Promise<string[]> {
  const model = opts.model || GEN_MODEL;
  const res = await fetch(`${MESH_BASE}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getMeshKey()}` },
    body: JSON.stringify({
      model,
      prompt: opts.prompt,
      size: opts.size ?? '1536x1024',
      n: Math.min(Math.max(opts.n ?? 2, 1), 4),
      quality: opts.quality ?? 'medium',
    }),
  });

  if (!res.ok) {
    const detail = await readError(res);
    // A user-chosen model can fail for reasons the catalog can't predict (region,
    // quota, transient). Retry once on the known-good default before giving up.
    if (model !== GEN_MODEL) {
      console.warn(`Image generation on ${model} failed (${res.status}): ${detail}. Falling back to ${GEN_MODEL}.`);
      return generateThumbnails({ ...opts, model: GEN_MODEL });
    }
    throw new Error(`Image generation failed (${res.status}): ${detail}`);
  }
  return normalizeImages(await res.json());
}

export interface ReferenceImage {
  blob: Blob;
  filename: string;
}

async function callEdit(model: string, prompt: string, refs: ReferenceImage[], size: ThumbSize, n: number) {
  const form = new FormData();
  // The first reference is the primary `image`; the rest go in `reference_images`.
  form.append('image', refs[0].blob, refs[0].filename);
  for (let i = 1; i < refs.length; i++) form.append('reference_images', refs[i].blob, refs[i].filename);
  form.append('model', model);
  form.append('operation', 'edit');
  form.append('prompt', prompt);
  form.append('n', String(n));
  form.append('size', size);

  return fetch(`${MESH_BASE}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getMeshKey()}` }, // no Content-Type — fetch sets the multipart boundary
    body: form,
  });
}

/**
 * Reproduce the person from one or more reference images into a new thumbnail
 * scene described by `prompt`. Uses Nano Banana (identity-preserving) with a
 * fallback to gpt-image-1, then to pure text-to-image. Never hard-fails.
 *
 * `references[0]` is treated as the primary subject; additional references give
 * the model more angles of the same person (and, when they're the creator's own
 * thumbnails, the channel's style too).
 */
export async function editWithReference(opts: {
  prompt: string;
  references: ReferenceImage[];
  size?: ThumbSize;
  n?: number;
  /** Preferred reference-capable model. Tried first, then the proven defaults. */
  model?: string;
}): Promise<string[]> {
  const size = opts.size ?? '1536x1024';
  const n = Math.min(Math.max(opts.n ?? 2, 1), 4);
  const refs = opts.references.filter((r) => r?.blob && r.blob.size > 0);

  if (refs.length === 0) return generateThumbnails({ prompt: opts.prompt, size, n, model: opts.model });

  // The user's pick leads; the two proven engines back it up. Deduped so an
  // explicit choice of a default doesn't get attempted twice.
  const chain = [...new Set([opts.model, EDIT_MODEL, EDIT_FALLBACK_MODEL].filter(Boolean) as string[])];

  for (const model of chain) {
    try {
      const res = await callEdit(model, opts.prompt, refs, size, n);
      if (res.ok) {
        const images = normalizeImages(await res.json());
        if (images.length) return images;
        console.warn(`${model} edit returned no images; trying next engine.`);
      } else {
        console.warn(`${model} edit failed (${res.status}): ${await readError(res)}`);
      }
    } catch (e) {
      console.warn(`${model} edit threw:`, e);
    }
  }

  // Every edit engine failed — degrade to text-to-image so the user still gets
  // something, though the creator's face will not be preserved.
  console.warn('All edit engines failed; falling back to text-to-image.');
  return generateThumbnails({ prompt: opts.prompt, size, n });
}
