'use server';

/**
 * Ingest paths for the Winning Formula library.
 *
 * Both return candidate rows for the user to tick — nothing is imported until
 * they choose. Read-only against the YouTube service; no state is written here.
 */

import {
  fetchYouTubeChannelData,
  fetchRecentVideos,
  searchOutlierVideos,
} from '@/services/youtube';

export interface FormulaCandidate {
  /** The title (what we actually feed agents). */
  text: string;
  videoId?: string;
  url?: string;
  channel?: string;
  views?: number;
  subscribers?: number;
  /** Views ÷ the channel's normal views for this format. */
  outlierScore?: number;
  publishedAt?: string;
}

function toNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Pull a channel's recent videos so the creator can import the titles that
 * actually worked. Sorted by views so the winners float to the top.
 */
export async function importFromChannel(channelUrl: string): Promise<{
  channelTitle: string;
  subscribers?: number;
  candidates: FormulaCandidate[];
}> {
  const channel = await fetchYouTubeChannelData(channelUrl.trim());
  if (!channel) throw new Error(`Could not find a YouTube channel for "${channelUrl}".`);

  const subscribers = toNumber(channel.statistics?.subscriberCount);
  // fetchRecentVideos wants the uploads PLAYLIST id, not the channel id.
  const videos = await fetchRecentVideos(channel.uploadsPlaylistId, 30).catch(() => []);

  const candidates: FormulaCandidate[] = (videos ?? [])
    .map((v: any) => ({
      text: String(v.title ?? '').trim(),
      videoId: v.id,
      url: v.id ? `https://youtube.com/watch?v=${v.id}` : undefined,
      channel: channel.title,
      views: toNumber(v.viewCount),
      subscribers,
      publishedAt: v.publishedAt,
    }))
    .filter((c) => c.text.length > 0)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

  return { channelTitle: channel.title, subscribers, candidates };
}

/**
 * "Find winners" — the Research import. Surfaces genuine outliers in a niche:
 * videos whose views far exceed what their own channel normally does, which is
 * the signal that the *topic and format* carried them, not the audience.
 *
 * Uses `depth: 'quick'` to stay inside the daily YouTube quota.
 */
export async function findWinners(niche: string, days = 90): Promise<FormulaCandidate[]> {
  const query = niche.trim();
  if (!query) return [];

  const publishedAfter = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const videos = await searchOutlierVideos({
    niche: query,
    publishedAfter,
    // 'all' is the sentinel that skips relevanceLanguage; any other value is
    // sent to YouTube as a language code and 'any' is rejected as invalid.
    language: 'all',
    contentType: 'all',
    region: 'global',
    limit: 20,
    depth: 'quick',
  });

  return (videos ?? [])
    .map((v: any) => ({
      text: String(v.title ?? '').trim(),
      videoId: v.id,
      url: v.id ? `https://youtube.com/watch?v=${v.id}` : undefined,
      channel: v.channelTitle,
      views: toNumber(v.viewCount),
      subscribers: toNumber(v.subscriberCount),
      outlierScore: toNumber(v.outlierScore),
      publishedAt: v.publishedAt,
    }))
    .filter((c) => c.text.length > 0)
    .sort((a, b) => (b.outlierScore ?? 0) - (a.outlierScore ?? 0));
}
