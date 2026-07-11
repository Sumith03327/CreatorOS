'use client';

/**
 * The creator's OWN channel — connected once, reused everywhere.
 *
 * Until now the app made you re-paste your channel on every surface that needed
 * it (Action Plan, Thumbnail Studio, Compare). This is the single place that
 * remembers it, so those surfaces can prefill instead of asking again.
 *
 * Same-tab listeners get a CustomEvent (the native `storage` event only fires in
 * OTHER tabs), mirroring `watchlist.ts`.
 */

const KEY = 'creator-hub:v2:my-channel';
const CHANGE_EVENT = 'creator-hub-my-channel-change';

export interface MyChannel {
  id: string;
  title: string;
  handle?: string;
  thumbnail: string;
  subscriberCount: string;
  viewCount: string;
  videoCount: string;
  /** Channel creation date — the denominator for "uploads per month". */
  publishedAt: string;
  uploadsPlaylistId: string;
  connectedAt: string;
  /** AI-derived, written on a second pass once the analysis resolves. */
  niche?: string;
  performanceScore?: number;
}

function isChannel(v: unknown): v is MyChannel {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === 'string' && typeof c.title === 'string';
}

export function getMyChannel(): MyChannel | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isChannel(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setMyChannel(channel: MyChannel): MyChannel {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(channel));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch (e) {
    console.error('my-channel write failed:', e);
  }
  return channel;
}

/** Merge late-arriving fields (niche, score) without clobbering the rest. */
export function patchMyChannel(patch: Partial<MyChannel>): MyChannel | null {
  const current = getMyChannel();
  if (!current) return null;
  return setMyChannel({ ...current, ...patch });
}

export function clearMyChannel(): void {
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

/** Fires on same-tab changes (CustomEvent) and cross-tab changes (native `storage`). */
export function subscribeToMyChannel(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}
