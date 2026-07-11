/**
 * Feed sources and shapes for Creator Times.
 *
 * Deliberately a plain module, NOT a `'use server'` one: a server-action file may
 * only export async functions, so the moment `FEED_SOURCES` lived alongside the
 * fetchers in `services/feeds.ts`, Next refused to load the module at all
 * ("a 'use server' file can only export async functions, found object") and the
 * whole page failed. Constants and types belong on this side of the boundary.
 */

export type SourceId = 'creator-insider' | 'youtube-creators' | 'youtube-blog';

export interface FeedSource {
  id: SourceId;
  label: string;
  url: string;
  /** Only YouTube-video sources carry a transcript we can decode. */
  kind: 'youtube' | 'blog';
  /** Official product/policy announcements outrank tips-and-tricks content. */
  authority: 'primary' | 'secondary';
}

export const FEED_SOURCES: FeedSource[] = [
  {
    id: 'creator-insider',
    label: 'Creator Insider',
    // YouTube's official weekly creator product update channel, presented by PMs.
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCGg-UqjRgzhYDPJMr-9HXCg',
    kind: 'youtube',
    authority: 'primary',
  },
  {
    id: 'youtube-blog',
    label: 'YouTube Official Blog',
    url: 'https://blog.youtube/rss/',
    kind: 'blog',
    authority: 'primary',
  },
  {
    id: 'youtube-creators',
    label: 'YouTube Creators',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCkRfArvrzheW2E7b6SVT7vQ',
    kind: 'youtube',
    authority: 'secondary',
  },
];

export interface FeedItem {
  id: string;
  sourceId: SourceId;
  sourceLabel: string;
  authority: 'primary' | 'secondary';
  title: string;
  url: string;
  publishedAt: string;
  summary: string;
  /** Present for YouTube sources — the handle we can pull a transcript with. */
  videoId?: string;
  thumbnail?: string;
}

export interface FetchFeedsResult {
  items: FeedItem[];
  /** Sources that returned nothing, so the UI can be honest about a partial feed. */
  failedSources: string[];
}
