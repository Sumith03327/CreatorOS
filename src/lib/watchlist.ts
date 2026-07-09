'use client';

/**
 * Shared "Research" watchlist storage for channels and videos.
 * Centralized here so every reader (Sidebar badge, Channels page, Content page)
 * stays in sync — including same-tab updates, which the native `storage` event
 * does not fire for.
 */

export interface WatchlistChannel {
  id: string;
  channelName: string;
  handle: string;
  avatarUrl: string;
  subscriberCount: number;
  uploadsPerMonth: number;
  viewCount: number;
  growthScore: number;
  niche: string;
  savedAt: string;
}

export interface WatchlistVideo {
  id: string;
  title: string;
  thumbnail: string;
  channelTitle?: string;
  channelId?: string;
  viewCount?: string;
  niche: string;
  savedAt: string;
}

const CHANNEL_KEY = 'creator-hub-watchlist';
const VIDEO_KEY = 'creator-hub-video-watchlist';
const CHANGE_EVENT = 'creator-hub-watchlist-change';

function readList<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, items: T[]) {
  localStorage.setItem(key, JSON.stringify(items));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function getChannelWatchlist(): WatchlistChannel[] {
  return readList<WatchlistChannel>(CHANNEL_KEY);
}

export function saveChannelWatchlist(items: WatchlistChannel[]) {
  writeList(CHANNEL_KEY, items);
}

export function getVideoWatchlist(): WatchlistVideo[] {
  return readList<WatchlistVideo>(VIDEO_KEY);
}

export function saveVideoWatchlist(items: WatchlistVideo[]) {
  writeList(VIDEO_KEY, items);
}

export function getWatchlistCount(): number {
  return getChannelWatchlist().length + getVideoWatchlist().length;
}

/** Fires on same-tab changes (CustomEvent) and cross-tab changes (native `storage`). */
export function subscribeToWatchlistChanges(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}
