
'use server';

/**
 * STANDALONE YOUTUBE SERVICE
 * All data fetching remains server-side.
 * Caching has been simplified to avoid Firestore dependencies.
 */

import { YoutubeTranscript } from 'youtube-transcript';
import { computeMomentum, computeOutlierScore, computeVph, median, toNum } from '@/lib/research-metrics';
import { isShort } from '@/lib/video-utils';

const API_KEY = process.env.YOUTUBE_API_KEY || process.env.VITE_YOUTUBE_API_KEY || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

export interface YouTubeChannelData {
  id: string;
  title: string;
  description: string;
  customUrl: string;
  publishedAt: string;
  thumbnails: {
    default: { url: string };
    medium: { url: string };
    high: { url: string };
  };
  statistics: {
    viewCount: string;
    subscriberCount: string;
    videoCount: string;
  };
  uploadsPlaylistId: string;
}

export interface YouTubeVideoData {
  id: string;
  title: string;
  description?: string;
  thumbnail: string;
  publishedAt: string;
  channelTitle?: string;
  channelId?: string;
  viewCount?: string;
  duration?: string;
  subscriberCount?: string;
}

export interface TranscriptSegment {
  text: string;
  offset: number;
}

async function handleYoutubeResponse(response: Response) {
  const data = await response.json();
  if (data.error) {
    const message = data.error.message || 'Unknown YouTube API error';
    if (data.error.errors?.[0]?.reason === 'quotaExceeded') {
      throw new Error('YouTube API quota exceeded. Please try again later or check your API key.');
    }
    throw new Error(`YouTube API Error: ${message}`);
  }
  return data;
}

// --- Shared internals -------------------------------------------------------

/** The YouTube Data API caps `id` batches at 50 per request. */
const MAX_IDS_PER_BATCH = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `fn` over `items` with bounded parallelism so we don't burst the API. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Live streams break every measurement here: a 24/7 news stream accumulates
 * views indefinitely, so it looks like a permanent outlier, and a channel whose
 * recent uploads are all stream placeholders gets a baseline near zero — which
 * then makes every other video on it look like a breakout. Any video carrying
 * liveStreamingDetails (live, upcoming, or a finished broadcast) is excluded.
 */
function isLiveBroadcast(item: any): boolean {
  if (item?.liveStreamingDetails) return true;
  const state = item?.snippet?.liveBroadcastContent;
  return Boolean(state) && state !== 'none';
}

/** Batched `videos` lookup (1 quota unit per 50 ids), tolerant of partial failure. */
async function fetchVideosByIds(ids: string[], parts = 'snippet,statistics,contentDetails,liveStreamingDetails'): Promise<any[]> {
  const batches = await mapWithConcurrency(chunk(ids, MAX_IDS_PER_BATCH), 4, async (batch) => {
    try {
      const res = await fetch(`${BASE_URL}/videos?part=${parts}&id=${batch.join(',')}&key=${API_KEY}`);
      const data = await handleYoutubeResponse(res);
      return data.items || [];
    } catch (e) {
      console.warn('videos batch failed:', e);
      return [];
    }
  });
  return batches.flat();
}

/** Batched `channels` lookup (1 quota unit per 50 ids). */
async function fetchChannelsByIds(ids: string[], parts = 'snippet,statistics,contentDetails'): Promise<any[]> {
  const batches = await mapWithConcurrency(chunk(ids, MAX_IDS_PER_BATCH), 4, async (batch) => {
    try {
      const res = await fetch(`${BASE_URL}/channels?part=${parts}&id=${batch.join(',')}&key=${API_KEY}`);
      const data = await handleYoutubeResponse(res);
      return data.items || [];
    } catch (e) {
      console.warn('channels batch failed:', e);
      return [];
    }
  });
  return batches.flat();
}

// --- Channel baselines ------------------------------------------------------

interface BaselineVideo {
  id: string;
  views: number;
  publishedAt: string;
  short: boolean;
}

/**
 * What "normal" looks like for one channel, measured from its recent uploads.
 * Shorts and long-form are kept apart because a channel that posts both has a
 * bimodal view distribution — scoring a Short against a long-form median would
 * make every Short look like a breakout (or vice versa).
 */
export interface ChannelBaseline {
  overall: number;
  longForm: number;
  shorts: number;
  videos: BaselineVideo[];
}

// How many recent uploads define "normal". 50 is the API's page ceiling and
// costs exactly the same as 15 (1 unit for the page, 1 for the stats batch), so
// we take the larger sample: it gives a median robust to one viral hit, and
// enough history to compare a channel's newest uploads against its own older ones.
const BASELINE_SAMPLE_SIZE = 50;
// Minimum same-format samples before we trust a format-specific median.
const MIN_FORMAT_SAMPLES = 3;
// A channel's median moves slowly; caching it for a few hours saves real quota.
const BASELINE_TTL_MS = 12 * 60 * 60 * 1000;
/**
 * Below this, the denominator is noise rather than a norm: dividing by a median
 * of 106 views turns any fluke into an "18000x outlier". Channels this quiet get
 * scored against their lifetime average instead, or dropped.
 */
const MIN_CREDIBLE_BASELINE = 500;

const baselineCache = new Map<string, { value: ChannelBaseline; expiresAt: number }>();

async function fetchChannelBaseline(channelId: string, uploadsPlaylistId: string): Promise<ChannelBaseline | null> {
  const cached = baselineCache.get(channelId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const listRes = await fetch(
      `${BASE_URL}/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=${BASELINE_SAMPLE_SIZE}&key=${API_KEY}`
    );
    const listData = await handleYoutubeResponse(listRes);
    const ids: string[] = (listData.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length === 0) return null;

    const items = await fetchVideosByIds(ids);
    const videos: BaselineVideo[] = items
      .filter((v: any) => !isLiveBroadcast(v))
      .map((v: any) => ({
        id: v.id,
        views: toNum(v.statistics?.viewCount),
        publishedAt: v.snippet?.publishedAt,
        short: isShort(v.contentDetails?.duration),
      }));
    if (videos.length === 0) return null;

    const baseline: ChannelBaseline = {
      overall: median(videos.map(v => v.views)),
      longForm: median(videos.filter(v => !v.short).map(v => v.views)),
      shorts: median(videos.filter(v => v.short).map(v => v.views)),
      videos,
    };
    baselineCache.set(channelId, { value: baseline, expiresAt: Date.now() + BASELINE_TTL_MS });
    return baseline;
  } catch (e) {
    console.warn(`baseline fetch failed for ${channelId}:`, e);
    return null;
  }
}

/**
 * The channel's normal view count for a specific video, excluding that video
 * from its own baseline — otherwise a big hit inflates the very number it's
 * being measured against and understates how much of an outlier it is.
 */
function baselineFor(
  baseline: ChannelBaseline,
  videoId: string,
  short: boolean
): { value: number; source: 'recent-format' | 'recent-overall' } | null {
  const peers = baseline.videos.filter(v => v.id !== videoId);
  const sameFormat = peers.filter(v => v.short === short);

  if (sameFormat.length >= MIN_FORMAT_SAMPLES) {
    const value = median(sameFormat.map(v => v.views));
    if (value >= MIN_CREDIBLE_BASELINE) return { value, source: 'recent-format' };
  }
  const overall = median(peers.map(v => v.views));
  if (overall >= MIN_CREDIBLE_BASELINE) return { value: overall, source: 'recent-overall' };
  return null;
}

export async function fetchYouTubeChannelData(url: string): Promise<YouTubeChannelData | null> {
  if (!API_KEY) throw new Error('YouTube API Key is missing');

  const input = url.trim();
  let channelId: string | null = null;

  // 1. Direct channel URL: youtube.com/channel/UCxxxx
  const idMatch = input.match(/channel\/([a-zA-Z0-9_-]+)/);
  if (idMatch) channelId = idMatch[1];

  // 2. A bare channel ID pasted directly (UC + 22 chars). This avoids a wasteful
  //    text-search that could resolve to the wrong channel (e.g. history re-clicks).
  if (!channelId && /^UC[a-zA-Z0-9_-]{22}$/.test(input)) channelId = input;

  if (!channelId) {
    // 3. Handle (@name), vanity URL, or free text → resolve via search.
    const handleMatch = input.match(/@([a-zA-Z0-9._-]+)/);
    const query = handleMatch ? `@${handleMatch[1]}` : input;
    const searchUrl = `${BASE_URL}/search?part=snippet&q=${encodeURIComponent(query)}&type=channel&maxResults=1&key=${API_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await handleYoutubeResponse(searchRes);
    if (!searchData.items || searchData.items.length === 0) return null;
    channelId = searchData.items[0].id.channelId;
  }

  if (!channelId) return null;

  const endpoint = `${BASE_URL}/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${API_KEY}`;
  const response = await fetch(endpoint);
  const data = await handleYoutubeResponse(response);
  if (!data.items || data.items.length === 0) return null;
  const item = data.items[0];
  return {
    id: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    customUrl: item.snippet.customUrl,
    publishedAt: item.snippet.publishedAt,
    thumbnails: item.snippet.thumbnails,
    statistics: item.statistics,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
}

export interface BoomingChannel {
  id: string;
  title: string;
  description: string;
  thumbnails: { default: { url: string }; medium?: { url: string }; high?: { url: string } };
  statistics: { viewCount: string; subscriberCount: string; videoCount: string };
  handle: string;
  channelAgeMonths: number;
  /** 0–100 momentum, derived from recent uploads. Named `growthScore` for continuity. */
  growthScore: number;
  /** Uploads per month over the sampled window, not over the channel's lifetime. */
  uploadsPerMonth: number;
  /** Median views of recent uploads ÷ the channel's all-time average. >1 = heating up. */
  lift: number;
  recentMedianViews: number;
  /** Young channel already moving fast — "came out of nowhere". */
  isBreakout: boolean;
  /** False when we couldn't sample uploads and fell back to lifetime figures. */
  hasRecentData: boolean;
}

// How many search hits we deep-sample for momentum. Each costs ~2 quota units.
const MOMENTUM_SAMPLE_LIMIT = 30;
// Of those, how many slots are reserved for the youngest channels. Ranking the
// candidate pool purely by subscribers would truncate away the young channels in
// a crowded niche — the exact ones the breakout radar exists to surface.
const YOUNG_CHANNEL_RESERVE = 10;

function channelAgeMonthsOf(channel: any): number {
  const publishedAt = channel?.snippet?.publishedAt ? new Date(channel.snippet.publishedAt).getTime() : Date.now();
  return Math.max(1, Math.round((Date.now() - publishedAt) / (1000 * 60 * 60 * 24 * 30)));
}

/**
 * Finds channels in a niche and ranks them by *current* momentum.
 *
 * YouTube's channel search doesn't support publishedAfter or order=viewCount for
 * type=channel, so query variety is the only lever for building a candidate pool.
 * The ranking then comes from each channel's recent uploads: how fast those
 * videos are accumulating views, and whether they beat the channel's own all-time
 * average. A channel that was huge three years ago and is dead now scores low.
 */
export async function fetchBoomingChannels(niche: string): Promise<BoomingChannel[]> {
  if (!API_KEY) throw new Error('YouTube API Key missing');

  const queries = [`${niche} tips`, `${niche} tutorial`, `${niche} channel`, `${niche} explained`];

  const searchResults = await Promise.all(
    queries.map(q =>
      fetch(`${BASE_URL}/search?part=snippet&type=channel&q=${encodeURIComponent(q)}&maxResults=8&key=${API_KEY}`)
        .then(r => handleYoutubeResponse(r))
    )
  );
  const allChannelIds = searchResults.flatMap(res => res.items?.map((i: any) => i.id.channelId) || []).filter(Boolean);
  const uniqueIds = Array.from(new Set(allChannelIds)).slice(0, MAX_IDS_PER_BATCH);
  if (uniqueIds.length === 0) return [];

  const items = await fetchChannelsByIds(uniqueIds);
  if (items.length === 0) return [];

  // Deep-sampling costs quota, so we can only afford MOMENTUM_SAMPLE_LIMIT of the
  // candidates. Drop empty shells and one-subscriber spam first, then fill most
  // slots by reach and reserve the rest for the youngest channels.
  const candidates = items.filter(
    (c: any) => toNum(c.statistics?.videoCount) >= 3 && toNum(c.statistics?.subscriberCount) >= 1000
  );

  const bySubscribers = [...candidates].sort(
    (a: any, b: any) => toNum(b.statistics?.subscriberCount) - toNum(a.statistics?.subscriberCount)
  );
  const selected = new Map<string, any>(
    bySubscribers.slice(0, MOMENTUM_SAMPLE_LIMIT - YOUNG_CHANNEL_RESERVE).map((c: any) => [c.id, c])
  );

  const byAge = [...candidates].sort((a: any, b: any) => channelAgeMonthsOf(a) - channelAgeMonthsOf(b));
  for (const channel of byAge) {
    if (selected.size >= MOMENTUM_SAMPLE_LIMIT) break;
    selected.set(channel.id, channel);
  }
  const ranked = Array.from(selected.values());

  const baselines = await mapWithConcurrency(ranked, 6, async (c: any) => {
    const uploads = c.contentDetails?.relatedPlaylists?.uploads;
    return uploads ? await fetchChannelBaseline(c.id, uploads) : null;
  });

  return ranked.map((c: any, index: number): BoomingChannel => {
    const videoCount = toNum(c.statistics?.videoCount);
    const channelAgeMonths = channelAgeMonthsOf(c);
    const baseline = baselines[index];

    const momentum = computeMomentum({
      uploads: baseline?.videos.map(v => ({ views: v.views, publishedAt: v.publishedAt })) ?? [],
      channelAgeMonths,
    });

    return {
      id: c.id,
      title: c.snippet.title,
      description: c.snippet.description,
      thumbnails: c.snippet.thumbnails,
      statistics: c.statistics,
      handle: c.snippet.customUrl || `@${c.id}`,
      channelAgeMonths,
      growthScore: momentum.score,
      // With no sample we can't know the recent cadence; the lifetime rate is the
      // honest fallback, and `hasRecentData` tells the UI not to oversell it.
      uploadsPerMonth: baseline ? momentum.uploadsPerMonth : Math.round(videoCount / channelAgeMonths),
      lift: momentum.lift,
      recentMedianViews: momentum.recentMedianViews,
      isBreakout: momentum.isBreakout,
      hasRecentData: momentum.sampleSize >= 3,
    };
  });
}

export interface VideoPage {
  videos: YouTubeVideoData[];
  nextPageToken?: string;
}

/**
 * Fetches one page (up to 50) of a channel's uploads, enriched with real
 * statistics + duration, and returns the nextPageToken so callers can paginate
 * ("See more"). maxResults is clamped to the API's 50-per-page ceiling.
 */
export async function fetchChannelVideosPage(playlistId: string, maxResults: number = 50, pageToken?: string): Promise<VideoPage> {
  if (!API_KEY || !playlistId) return { videos: [] };
  const perPage = Math.min(Math.max(maxResults, 1), 50);
  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    playlistId,
    maxResults: String(perPage),
    key: API_KEY,
  });
  if (pageToken) params.set('pageToken', pageToken);

  const response = await fetch(`${BASE_URL}/playlistItems?${params.toString()}`);
  const data = await handleYoutubeResponse(response);
  const nextPageToken: string | undefined = data.nextPageToken;

  const baseVideos: YouTubeVideoData[] = (data.items || []).map((item: any) => ({
    id: item.contentDetails.videoId,
    title: item.snippet.title,
    description: item.snippet.description || "",
    thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
    publishedAt: item.snippet.publishedAt,
    viewCount: "0",
  }));

  const videoIds = baseVideos.map(v => v.id).filter(Boolean);
  if (videoIds.length === 0) return { videos: baseVideos, nextPageToken };

  // Enrich with real statistics + duration in a single batched call.
  try {
    const statsRes = await fetch(`${BASE_URL}/videos?part=statistics,contentDetails&id=${videoIds.join(',')}&key=${API_KEY}`);
    const statsData = await handleYoutubeResponse(statsRes);
    const statsById: Record<string, any> = {};
    for (const v of statsData.items || []) statsById[v.id] = v;
    return {
      videos: baseVideos.map(v => ({
        ...v,
        viewCount: statsById[v.id]?.statistics?.viewCount || "0",
        duration: statsById[v.id]?.contentDetails?.duration,
      })),
      nextPageToken,
    };
  } catch (e) {
    console.warn('Video stats enrichment failed, returning base video data:', e);
    return { videos: baseVideos, nextPageToken };
  }
}

/** Backwards-compatible single-page helper returning just the video list. */
export async function fetchRecentVideos(playlistId: string, maxResults: number = 20): Promise<YouTubeVideoData[]> {
  const { videos } = await fetchChannelVideosPage(playlistId, maxResults);
  return videos;
}

export async function fetchVideoDetails(videoId: string): Promise<YouTubeVideoData | null> {
  if (!API_KEY || !videoId) return null;
  const endpoint = `${BASE_URL}/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${API_KEY}`;
  const response = await fetch(endpoint);
  const data = await handleYoutubeResponse(response);
  if (!data.items || data.items.length === 0) return null;
  const item = data.items[0];
  return {
    id: item.id,
    title: item.snippet.title,
    description: item.snippet.description || "",
    thumbnail: item.snippet.thumbnails.high?.url,
    publishedAt: item.snippet.publishedAt,
    viewCount: item.statistics.viewCount,
    channelTitle: item.snippet.channelTitle,
    channelId: item.snippet.channelId,
    duration: item.contentDetails?.duration
  };
}

export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    return transcript.map(t => ({ text: t.text, offset: t.offset }));
  } catch (e) {
    console.warn('Transcript fetch failed:', e);
    return [];
  }
}

export async function searchTrendingVideos(
  niche: string,
  publishedAfter: string,
  language: string,
  contentType: 'all' | 'long' | 'short',
  region: 'IN' | 'global',
  sortBy: string
): Promise<YouTubeVideoData[]> {
  if (!API_KEY) throw new Error('YouTube API Key is missing');

  const order = sortBy === 'date' ? 'date' : sortBy === 'relevance' ? 'relevance' : 'viewCount';
  const videoDuration = contentType === 'short' ? 'short' : contentType === 'long' ? 'long' : 'any';

  const searchParams = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    q: niche,
    maxResults: '24',
    order,
    videoDuration,
    publishedAfter,
    key: API_KEY,
  });
  if (language !== 'all') searchParams.set('relevanceLanguage', language);
  if (region === 'IN') searchParams.set('regionCode', 'IN');

  const searchRes = await fetch(`${BASE_URL}/search?${searchParams.toString()}`);
  const searchData = await handleYoutubeResponse(searchRes);
  const videoIds: string[] = (searchData.items || []).map((i: any) => i.id?.videoId).filter(Boolean);
  if (videoIds.length === 0) return [];

  const videosRes = await fetch(`${BASE_URL}/videos?part=snippet,statistics,contentDetails&id=${videoIds.join(',')}&key=${API_KEY}`);
  const videosData = await handleYoutubeResponse(videosRes);
  const items = videosData.items || [];

  const channelIds: string[] = Array.from(new Set(items.map((v: any) => v.snippet.channelId).filter(Boolean)));
  const subsByChannel: Record<string, string> = {};
  if (channelIds.length > 0) {
    const channelsRes = await fetch(`${BASE_URL}/channels?part=statistics&id=${channelIds.join(',')}&key=${API_KEY}`);
    const channelsData = await handleYoutubeResponse(channelsRes);
    for (const c of channelsData.items || []) {
      subsByChannel[c.id] = c.statistics?.subscriberCount || '0';
    }
  }

  return items.map((item: any): YouTubeVideoData => ({
    id: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
    publishedAt: item.snippet.publishedAt,
    channelTitle: item.snippet.channelTitle,
    channelId: item.snippet.channelId,
    viewCount: item.statistics?.viewCount || '0',
    duration: item.contentDetails?.duration,
    subscriberCount: subsByChannel[item.snippet.channelId] || '0',
  }));
}

export interface ResearchVideo extends YouTubeVideoData {
  /** views ÷ the publishing channel's normal views for this format. */
  outlierScore: number;
  /** Views per hour since publish. */
  vph: number;
  /** The number `outlierScore` was measured against. */
  baseline: number;
  baselineSource: 'recent-format' | 'recent-overall' | 'lifetime';
}

export interface OutlierSearchOptions {
  niche: string;
  publishedAfter: string;
  language: string;
  contentType: 'all' | 'long' | 'short';
  region: 'IN' | 'global';
  limit?: number;
  /**
   * 'deep' pools three searches (~300 quota units) for the research page.
   * 'quick' runs one (~100 units) — enough for agent tools, which call this
   * conversationally and shouldn't burn the daily quota on a single question.
   */
  depth?: 'quick' | 'deep';
  /**
   * Subscriber band, applied to the candidate pool *before* ranking. Filtering
   * afterwards would search a bucket of already-selected big channels and then
   * ask for small ones, which is why the old "Nano" filter came back empty.
   */
  subscriberMin?: number;
  subscriberMax?: number;
}

// Videos below this are statistical noise — a 40-view upload can be a "20x outlier".
const MIN_VIEWS_FOR_OUTLIER = 1000;
// How many top candidates get an accurate recent-uploads baseline (~2 units/channel).
const DEEP_BASELINE_CHANNEL_LIMIT = 35;

/**
 * The research page's video search.
 *
 * A single `order=viewCount` search returns big-channel videos, so any
 * small-channel breakout is filtered out *before* outlier math can find it. We
 * pool three complementary searches instead — top performers, newest uploads
 * (where breakouts hide), and relevance — then rank the union ourselves.
 *
 * Costs ~300 quota units for the searches plus ~1 unit per channel sampled.
 * Results are sorted by outlier score; callers re-sort client-side for free.
 */
export async function searchOutlierVideos(options: OutlierSearchOptions): Promise<ResearchVideo[]> {
  if (!API_KEY) throw new Error('YouTube API Key is missing');
  const { niche, publishedAfter, language, contentType, region, limit = 36, depth = 'deep' } = options;

  const videoDuration = contentType === 'short' ? 'short' : contentType === 'long' ? 'long' : 'any';
  const searches: { q: string; order: string }[] =
    depth === 'quick'
      ? [{ q: niche, order: 'viewCount' }]
      : [
          { q: niche, order: 'viewCount' },
          { q: niche, order: 'date' },
          { q: niche, order: 'relevance' },
        ];

  const searchResults = await Promise.all(
    searches.map(async ({ q, order }) => {
      const params = new URLSearchParams({
        part: 'snippet', type: 'video', q, order, videoDuration, publishedAfter,
        maxResults: '50', key: API_KEY!,
      });
      if (language !== 'all') params.set('relevanceLanguage', language);
      if (region === 'IN') params.set('regionCode', 'IN');
      try {
        const res = await fetch(`${BASE_URL}/search?${params.toString()}`);
        const data = await handleYoutubeResponse(res);
        return (data.items || []).map((i: any) => i.id?.videoId).filter(Boolean) as string[];
      } catch (e) {
        // One failed search shouldn't sink the whole pool.
        console.warn(`search failed (${q}, ${order}):`, e);
        return [] as string[];
      }
    })
  );

  const videoIds = Array.from(new Set(searchResults.flat()));
  if (videoIds.length === 0) return [];

  const items = await fetchVideosByIds(videoIds);
  const eligible = items.filter(
    (v: any) => !isLiveBroadcast(v) && toNum(v.statistics?.viewCount) >= MIN_VIEWS_FOR_OUTLIER
  );
  if (eligible.length === 0) return [];

  const channelIds = Array.from(new Set(eligible.map((v: any) => v.snippet?.channelId).filter(Boolean))) as string[];
  const channels = await fetchChannelsByIds(channelIds);
  const channelById = new Map<string, any>(channels.map((c: any) => [c.id, c]));

  const { subscriberMin = 0, subscriberMax = Infinity } = options;

  // Pass 1: rank on the free lifetime average (channel views ÷ video count) to
  // decide which channels are worth paying for an accurate baseline.
  const scored = eligible
    .filter((v: any) => {
      const subs = toNum(channelById.get(v.snippet.channelId)?.statistics?.subscriberCount);
      return subs >= subscriberMin && subs < subscriberMax;
    })
    .map((v: any) => {
      const channel = channelById.get(v.snippet.channelId);
      const videoCount = toNum(channel?.statistics?.videoCount);
      const lifetimeAvg = videoCount > 0 ? toNum(channel?.statistics?.viewCount) / videoCount : 0;
      const views = toNum(v.statistics?.viewCount);
      return { item: v, channel, views, prelim: computeOutlierScore(views, lifetimeAvg), lifetimeAvg };
    });
  scored.sort((a, b) => b.prelim - a.prelim);

  // Pass 2: real baselines for the channels behind the strongest candidates.
  const shortlist = scored.slice(0, Math.min(scored.length, limit * 2));
  const deepChannels = Array.from(new Set(shortlist.map(s => s.channel?.id).filter(Boolean)))
    .slice(0, DEEP_BASELINE_CHANNEL_LIMIT) as string[];

  const baselinePairs = await mapWithConcurrency(deepChannels, 6, async (id) => {
    const uploads = channelById.get(id)?.contentDetails?.relatedPlaylists?.uploads;
    return [id, uploads ? await fetchChannelBaseline(id, uploads) : null] as const;
  });
  const baselineByChannel = new Map(baselinePairs);

  const results: ResearchVideo[] = [];
  for (const { item, channel, views, lifetimeAvg } of shortlist) {
    const short = isShort(item.contentDetails?.duration);
    const baseline = baselineByChannel.get(channel?.id);
    const resolved = baseline ? baselineFor(baseline, item.id, short) : null;

    // Prefer a real recent median; fall back to the lifetime average. If neither
    // clears the credibility floor, we cannot honestly say how big an outlier
    // this is, so we leave it out rather than print a fabricated multiple.
    const value = resolved?.value ?? lifetimeAvg;
    if (value < MIN_CREDIBLE_BASELINE) continue;

    results.push({
      id: item.id,
      title: item.snippet.title,
      description: item.snippet.description || '',
      thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
      publishedAt: item.snippet.publishedAt,
      channelTitle: item.snippet.channelTitle,
      channelId: item.snippet.channelId,
      viewCount: item.statistics?.viewCount || '0',
      duration: item.contentDetails?.duration,
      subscriberCount: channel?.statistics?.subscriberCount || '0',
      outlierScore: computeOutlierScore(views, value),
      vph: computeVph(views, item.snippet.publishedAt),
      baseline: value,
      baselineSource: resolved?.source ?? 'lifetime',
    });
  }

  return results.sort((a, b) => b.outlierScore - a.outlierScore).slice(0, limit);
}

export interface ChannelLink {
  label: string;
  url: string;
}

/**
 * Scrapes a channel's public /about page for its curated "Links" section
 * (Instagram, X, store, etc.). These links are NOT exposed by the Data API,
 * so we read them from the page's embedded data. Best-effort: returns [] on any
 * failure so callers can fall back gracefully.
 */
export async function fetchChannelLinks(channelId: string): Promise<ChannelLink[]> {
  if (!channelId) return [];
  try {
    const res = await fetch(`https://www.youtube.com/channel/${channelId}/about`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    // Each About "Links" entry carries a creator-set title and a redirect
    // endpoint whose q= param holds the full (untruncated) destination URL.
    const re = /"channelExternalLinkViewModel":\{"title":\{"content":"([^"]+)"\}.{0,800}?q=([^"&\\]+)/g;
    const out: ChannelLink[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      let url = m[2];
      try { url = decodeURIComponent(m[2]); } catch { /* keep raw */ }
      const key = url.replace(/\/$/, '').toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push({ label: m[1], url }); }
    }
    return out;
  } catch (e) {
    console.warn('fetchChannelLinks failed:', e);
    return [];
  }
}

export async function fetchSupadataTranscript(videoId: string) { return null; }
export async function fetchAssemblyAITranscript(videoId: string) { return null; }
