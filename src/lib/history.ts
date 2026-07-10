/**
 * Recently-analyzed channel history, persisted to localStorage.
 *
 * The entry is written in two passes: the channel facts land as soon as the
 * YouTube fetch resolves, and the AI-derived score/niche are patched in later
 * when the demographics flow settles. Everything after `analyzedAt` is therefore
 * optional — a card must render correctly from the first pass alone, and from
 * entries written by older builds that never stored these fields.
 */

const STORAGE_KEY = 'creator-hub-history';

/** Six keeps the 3-column grid full at two rows instead of orphaning a card. */
export const MAX_HISTORY = 6;

export interface ChannelHistoryEntry {
  id: string;
  title: string;
  thumbnail: string;
  analyzedAt: string;
  /** Second pass — absent until the corresponding flow resolves. */
  subscriberCount?: string;
  viewCount?: string;
  videoCount?: string;
  performanceScore?: number;
  niche?: string;
}

function isEntry(v: unknown): v is ChannelHistoryEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === 'string' && typeof e.title === 'string';
}

export function readHistory(): ChannelHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, MAX_HISTORY);
  } catch {
    // Corrupt or unparseable history is not worth surfacing to the user.
    return [];
  }
}

function write(entries: ChannelHistoryEntry[]): ChannelHistoryEntry[] {
  const capped = entries.slice(0, MAX_HISTORY);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // Quota exceeded or storage disabled — history is a convenience, not state.
  }
  return capped;
}

/** Moves `entry` to the front, de-duplicating by channel id. */
export function pushHistory(entry: ChannelHistoryEntry): ChannelHistoryEntry[] {
  const rest = readHistory().filter((h) => h.id !== entry.id);
  return write([entry, ...rest]);
}

/**
 * Merges late-arriving fields (score, niche) into an existing entry. No-ops if
 * the channel has since been evicted from history.
 */
export function patchHistory(
  id: string,
  patch: Partial<Omit<ChannelHistoryEntry, 'id'>>
): ChannelHistoryEntry[] {
  const entries = readHistory();
  const idx = entries.findIndex((h) => h.id === id);
  if (idx === -1) return entries;
  entries[idx] = { ...entries[idx], ...patch };
  return write(entries);
}

export function clearHistory(): ChannelHistoryEntry[] {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* see write() */
  }
  return [];
}
