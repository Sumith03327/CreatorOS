'use client';

/**
 * @fileOverview The Winning Formula — a library of PROVEN material the creator
 * curates, which agents ground their work on.
 *
 * The point is not to stuff a prompt with 50 titles. The library is exposed to
 * agents as a TOOL (`get_winning_formula`), which means:
 *   - it appears in the Activity Rail, so you watch the agent reach for it;
 *   - its output lands in `toolOutputs`, so the deliverable grounding treats a
 *     citation from YOUR data as real evidence rather than a hallucination.
 *
 * Backed by the same localStorage layer as agent-store, behind an async API, so
 * a real backend is a single-file swap later.
 */

const NS = 'creator-hub';
const SCHEMA = 'v2';
const FORMULA_KEY = [NS, SCHEMA, 'formula'].join(':');

/** What kind of proven material an item is. Agents declare what they consume. */
export type EvidenceKind = 'title' | 'hook' | 'video' | 'description';

export interface EvidenceMeta {
  videoId?: string;
  url?: string;
  channel?: string;
  views?: number;
  subscribers?: number;
  /** Views ÷ the channel's normal views for this format. >2 is a real outlier. */
  outlierScore?: number;
  publishedAt?: string;
}

export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  /** The title, hook line, or description text. */
  text: string;
  source: 'manual' | 'channel' | 'research';
  meta?: EvidenceMeta;
  addedAt: string;
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function read(): Promise<EvidenceItem[]> {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(FORMULA_KEY);
    return raw ? (JSON.parse(raw) as EvidenceItem[]) : [];
  } catch {
    return [];
  }
}

async function write(items: EvidenceItem[]): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FORMULA_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('formula-store write failed:', e);
  }
}

export async function listFormula(kinds?: EvidenceKind[]): Promise<EvidenceItem[]> {
  const items = await read();
  if (!kinds?.length) return items;
  const allowed = new Set(kinds);
  return items.filter((i) => allowed.has(i.kind));
}

/**
 * Add items, skipping anything whose text we already hold (case-insensitive).
 * Importing the same channel twice shouldn't double the library.
 */
export async function addFormulaItems(
  incoming: Omit<EvidenceItem, 'id' | 'addedAt'>[]
): Promise<EvidenceItem[]> {
  const existing = await read();
  const seen = new Set(existing.map((i) => i.text.trim().toLowerCase()));
  const now = new Date().toISOString();

  const fresh: EvidenceItem[] = [];
  for (const item of incoming) {
    const key = item.text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push({ ...item, id: newId(), addedAt: now });
  }

  const next = [...fresh, ...existing].slice(0, 300); // keep the library bounded
  await write(next);
  return next;
}

export async function removeFormulaItem(id: string): Promise<EvidenceItem[]> {
  const next = (await read()).filter((i) => i.id !== id);
  await write(next);
  return next;
}

export async function clearFormula(): Promise<void> {
  await write([]);
}

/** Counts by kind, for the panel's summary chip. */
export async function formulaCounts(): Promise<Record<EvidenceKind, number>> {
  const items = await read();
  const counts: Record<EvidenceKind, number> = { title: 0, hook: 0, video: 0, description: 0 };
  for (const i of items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  return counts;
}
