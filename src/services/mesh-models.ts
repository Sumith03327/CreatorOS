/**
 * @fileOverview Live image-model catalog, read from Mesh.
 *
 * Mesh's `/v1/models` returns a bare array where every entry carries its own
 * capability flags (`model_type`, `supports_image_reference`, `supports_image_edit`)
 * and pricing. We read those rather than hardcoding a list, so:
 *
 *   - the picker never offers a model Mesh has dropped,
 *   - we never claim a model preserves a creator's identity when it cannot, and
 *   - prices shown to the user are the prices Mesh will actually charge.
 *
 * Server-only (needs MESH_API_KEY). Exposed to the client via /api/models.
 */

const MESH_MODELS_URL = 'https://api.meshapi.ai/v1/models';

/** Cache: the catalog changes rarely and the payload is ~500 entries. */
const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; models: ImageModel[] } | null = null;

export interface ImageModel {
  id: string;
  name: string;
  brand: string;
  /** USD per generated image, or null when Mesh bills this model per token. */
  pricePerImage: number | null;
  /** Can take reference images — the prerequisite for reproducing a creator's face. */
  supportsReference: boolean;
  supportsEdit: boolean;
  description?: string;
  /** Surfaced in the default (collapsed) tier of the picker. */
  recommended: boolean;
}

/**
 * Models we surface first. Highlighting is the only editorial judgement here —
 * an id absent from Mesh's live response is silently dropped, never invented.
 *
 * `gemini-2.5-flash-image` leads the reference tier because it is the engine
 * this codebase already verified for identity preservation (see mesh-image.ts).
 */
const RECOMMENDED = new Set([
  'google/gemini-2.5-flash-image',
  'google/gemini-3-pro-image',
  'openai/gpt-image-1',
  'openai/gpt-image-1-mini',
  'black-forest-labs/flux.1-schnell',
  'black-forest-labs/flux.1.1-pro',
  'google/imagen-4-ultra',
  'bytedance/seedream-4',
]);

function getMeshKey(): string {
  const apiKey = process.env.MESH_API_KEY_ALL || process.env.MESH_API_KEY;
  if (!apiKey) throw new Error('Mesh API Key is missing (set MESH_API_KEY_ALL or MESH_API_KEY)');
  return apiKey;
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A raw Mesh entry counts as an image model if it says so, or if it emits images. */
function isImageModel(m: any): boolean {
  if (m?.model_type === 'image') return true;
  const out = Array.isArray(m?.output_modalities) ? m.output_modalities : [];
  return out.includes('image');
}

function toImageModel(m: any): ImageModel {
  return {
    id: String(m.id),
    name: String(m.name || m.id),
    brand: String(m.brand || m.provider || ''),
    pricePerImage: toNumberOrNull(m?.pricing?.image_output_usd_per_image),
    supportsReference: Boolean(m.supports_image_reference),
    supportsEdit: Boolean(m.supports_image_edit),
    description: m.description ? String(m.description) : undefined,
    recommended: RECOMMENDED.has(String(m.id)),
  };
}

/** Cheapest first, but recommended models float to the top of their tier. */
function sortModels(a: ImageModel, b: ImageModel): number {
  if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
  // Per-token models have no comparable per-image price; list them after priced ones.
  if (a.pricePerImage === null && b.pricePerImage !== null) return 1;
  if (b.pricePerImage === null && a.pricePerImage !== null) return -1;
  if (a.pricePerImage !== null && b.pricePerImage !== null) {
    if (a.pricePerImage !== b.pricePerImage) return a.pricePerImage - b.pricePerImage;
  }
  return a.name.localeCompare(b.name);
}

export async function listImageModels(): Promise<ImageModel[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.models;

  const raw = await fetchRawCatalog();
  const models = raw.filter(isImageModel).map(toImageModel).sort(sortModels);
  cache = { at: Date.now(), models };
  return models;
}

// --- Chat/text models (Script with Max's model picker) ---------------------

export interface ChatModel {
  id: string;
  name: string;
  brand: string;
  /** USD per 1M input tokens, or null when Mesh doesn't expose token pricing. */
  inputPricePerMTok: number | null;
  /** USD per 1M output tokens, or null when Mesh doesn't expose token pricing. */
  outputPricePerMTok: number | null;
  description?: string;
  /** Surfaced in the default (collapsed) tier of the picker. */
  recommended: boolean;
}

/**
 * Models we surface first, chosen for a scriptwriting/analysis chat: strong
 * writing (Claude, GPT), live web grounding (Perplexity's Sonar line), and
 * the cheap default (DeepSeek) so cost-conscious users see it up top too.
 * Same rule as the image catalog's RECOMMENDED: purely editorial — an id
 * absent from Mesh's live response is silently dropped, never invented.
 */
const RECOMMENDED_CHAT = new Set([
  'anthropic/claude-opus-4.5',
  'anthropic/claude-sonnet-4.5',
  'openai/gpt-5.1',
  'perplexity/sonar-pro',
  'perplexity/sonar-reasoning',
  'google/gemini-3-pro',
  'deepseek-ai/deepseek-v3',
]);

/** A raw Mesh entry counts as a chat model if it emits text and isn't image-only. */
function isChatModel(m: any): boolean {
  if (isImageModel(m)) return false;
  if (m?.model_type === 'text' || m?.model_type === 'chat') return true;
  const out = Array.isArray(m?.output_modalities) ? m.output_modalities : [];
  if (out.length) return out.includes('text');
  // No modality info at all — assume it's a chat model rather than hide it.
  return true;
}

function toChatModel(m: any): ChatModel {
  return {
    id: String(m.id),
    name: String(m.name || m.id),
    brand: String(m.brand || m.provider || ''),
    inputPricePerMTok: toNumberOrNull(m?.pricing?.input_cost_per_mtoken ?? m?.pricing?.prompt_usd_per_mtoken),
    outputPricePerMTok: toNumberOrNull(m?.pricing?.output_cost_per_mtoken ?? m?.pricing?.completion_usd_per_mtoken),
    description: m.description ? String(m.description) : undefined,
    recommended: RECOMMENDED_CHAT.has(String(m.id)),
  };
}

function sortChatModels(a: ChatModel, b: ChatModel): number {
  if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
  return a.name.localeCompare(b.name);
}

let chatCache: { at: number; models: ChatModel[] } | null = null;

export async function listChatModels(): Promise<ChatModel[]> {
  if (chatCache && Date.now() - chatCache.at < TTL_MS) return chatCache.models;

  const raw = await fetchRawCatalog();
  const models = raw.filter(isChatModel).map(toChatModel).sort(sortChatModels);
  chatCache = { at: Date.now(), models };
  return models;
}

async function fetchRawCatalog(): Promise<any[]> {
  const res = await fetch(MESH_MODELS_URL, {
    headers: { Authorization: `Bearer ${getMeshKey()}` },
  });
  if (!res.ok) throw new Error(`Could not list Mesh models (${res.status})`);
  const raw = await res.json();
  // Mesh returns a bare array; tolerate a { data: [...] } envelope too.
  return Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
}

/**
 * Validates a caller-supplied model id against the live catalog, and enforces
 * that a reference-driven generation only runs on a model that can actually
 * accept references. Returns null when the id is unusable, so callers fall back
 * to their own default rather than sending Mesh a bad request.
 */
export async function resolveImageModel(
  id: string | undefined,
  opts: { needsReference: boolean }
): Promise<ImageModel | null> {
  if (!id) return null;
  try {
    const models = await listImageModels();
    const found = models.find((m) => m.id === id);
    if (!found) return null;
    if (opts.needsReference && !found.supportsReference) return null;
    return found;
  } catch {
    // Catalog unreachable — let the caller use its default rather than hard-fail.
    return null;
  }
}
