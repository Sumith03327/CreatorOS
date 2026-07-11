
'use server';

/**
 * STANDALONE YOUTUBE SERVICE
 * All data fetching remains server-side.
 * Caching has been simplified to avoid Firestore dependencies.
 */

import { YoutubeTranscript } from 'youtube-transcript';
import { computeMomentum, computeOutlierScore, computeVph, median, overlapCoefficient, toNum } from '@/lib/research-metrics';
import { isShort } from '@/lib/video-utils';
import { findIrrelevant } from '@/ai/flows/niche-relevance-flow';
import { getCompetitorQueries, getNicheSeedQueries } from '@/ai/flows/seed-queries-flow';

// One key, server-side only. The old NEXT_PUBLIC_ fallback would have bundled
// this into client JS, and VITE_ was a leftover from a different build tool.
const API_KEY = process.env.YOUTUBE_API_KEY;
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

// --- Channel discovery ------------------------------------------------------

/** Resolves an @handle to a channel ID for 1 quota unit. Returns null if unknown. */
async function resolveHandle(handle: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${API_KEY}`);
    const data = await handleYoutubeResponse(res);
    return data.items?.[0]?.id ?? null;
  } catch (e) {
    console.warn(`forHandle failed for @${handle}:`, e);
    return null;
  }
}

const CHANNEL_ID_RE = /(?:youtube\.com\/channel\/)(UC[a-zA-Z0-9_-]{22})/g;
const HANDLE_RE = /(?:youtube\.com\/@|(?:^|\s|ft\.?\s*|feat\.?\s*|with\s+))@([a-zA-Z0-9._-]{3,30})/gi;

/**
 * Creators cite each other. Their video descriptions link collaborators, their
 * own second channels, and the people they learned from — which is a citation
 * graph we can walk for free, because `snippet.description` already arrives with
 * every video we fetch. No extra quota is spent to read it.
 */
function extractChannelMentions(descriptions: string[]): { ids: string[]; handles: string[] } {
  const ids = new Set<string>();
  const handles = new Set<string>();

  for (const text of descriptions) {
    if (!text) continue;
    for (const match of text.matchAll(CHANNEL_ID_RE)) ids.add(match[1]);
    for (const match of text.matchAll(HANDLE_RE)) handles.add(match[1].replace(/[.\-_]+$/, ''));
  }
  return { ids: Array.from(ids), handles: Array.from(handles) };
}

// --- Channel baselines ------------------------------------------------------

interface BaselineVideo {
  id: string;
  title: string;
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

/**
 * Momentum needs uploads older than the 7-day maturity window. A channel posting
 * several videos a day has none in its most recent 50, so we pull one more page
 * (2 more quota units) when the first page doesn't reach back far enough. True
 * firehoses — 30 uploads a day — stay unreachable and are scored as unproven.
 */
const BASELINE_MIN_SPAN_DAYS = 14;
const BASELINE_MAX_PAGES = 2;

async function fetchChannelBaseline(channelId: string, uploadsPlaylistId: string): Promise<ChannelBaseline | null> {
  const cached = baselineCache.get(channelId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const videos: BaselineVideo[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < BASELINE_MAX_PAGES; page++) {
      const params = new URLSearchParams({
        part: 'contentDetails', playlistId: uploadsPlaylistId,
        maxResults: String(BASELINE_SAMPLE_SIZE), key: API_KEY!,
      });
      if (pageToken) params.set('pageToken', pageToken);

      const listRes = await fetch(`${BASE_URL}/playlistItems?${params.toString()}`);
      const listData = await handleYoutubeResponse(listRes);
      pageToken = listData.nextPageToken;

      const ids: string[] = (listData.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
      if (ids.length === 0) break;

      const items = await fetchVideosByIds(ids);
      for (const v of items) {
        if (isLiveBroadcast(v)) continue;
        videos.push({
          id: v.id,
          title: v.snippet?.title ?? '',
          views: toNum(v.statistics?.viewCount),
          publishedAt: v.snippet?.publishedAt,
          short: isShort(v.contentDetails?.duration),
        });
      }

      const oldest = Math.min(...videos.map(v => new Date(v.publishedAt).getTime()).filter(Number.isFinite));
      const spanDays = (Date.now() - oldest) / (1000 * 60 * 60 * 24);
      if (!pageToken || spanDays >= BASELINE_MIN_SPAN_DAYS) break;
    }

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

  // 3. A handle (@name), either bare or inside a /@name URL. channels.list?forHandle
  //    resolves this for 1 quota unit; the text search below costs 100 for the same
  //    answer, and can silently resolve to the wrong channel.
  if (!channelId) {
    const handleMatch = input.match(/@([a-zA-Z0-9._-]+)/);
    if (handleMatch) channelId = await resolveHandle(handleMatch[1]);
  }

  if (!channelId) {
    // 4. Free text, or a legacy /c/ vanity URL → fall back to the 100-unit search.
    const searchUrl = `${BASE_URL}/search?part=snippet&q=${encodeURIComponent(input)}&type=channel&maxResults=1&key=${API_KEY}`;
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
  /** Which format is carrying the channel, from the medians of its recent uploads. */
  formatFocus: 'shorts' | 'long' | 'mixed';
  /** How many of the niche's current top videos this channel produced. */
  poolVideoCount: number;
}

// How many candidates we deep-sample for momentum. Each costs ~2 quota units, so
// this is the main lever on the Channels tab's cost and its recall.
const MOMENTUM_SAMPLE_LIMIT = 60;
// Of those, how many slots are reserved for the youngest channels. Ranking the
// candidate pool purely by subscribers would truncate away the young channels in
// a crowded niche — the exact ones the breakout radar exists to surface.
const YOUNG_CHANNEL_RESERVE = 10;

function channelAgeMonthsOf(channel: any): number {
  const publishedAt = channel?.snippet?.publishedAt ? new Date(channel.snippet.publishedAt).getTime() : Date.now();
  return Math.max(1, Math.round((Date.now() - publishedAt) / (1000 * 60 * 60 * 24 * 30)));
}

// Seed queries describe a niche's long-tail, which changes slowly. One cheap LLM
// call per niche per day.
const SEED_QUERY_TTL_MS = 24 * 60 * 60 * 1000;
const seedQueryCache = new Map<string, { value: string[]; expiresAt: number }>();

async function getSeedQueries(niche: string, count: number): Promise<string[]> {
  const cached = seedQueryCache.get(niche);
  if (cached && cached.expiresAt > Date.now()) return cached.value.slice(0, count);
  try {
    const { queries } = await getNicheSeedQueries({ niche });
    seedQueryCache.set(niche, { value: queries, expiresAt: Date.now() + SEED_QUERY_TTL_MS });
    return queries.slice(0, count);
  } catch (e) {
    // Widening is an optimisation, not a requirement.
    console.warn('Seed query generation failed; searching the head term only:', e);
    return [];
  }
}

// Each extra seed query is another 100-unit search. Two is a reasonable ceiling.
// Both research tabs use the same count so their pools share a cache key.
const SEED_QUERIES_PER_POOL = 2;
// Ceiling for the widened pass, used only when a narrow filter starves the pool.
const SEED_QUERIES_WIDENED = 4;
const MIN_CANDIDATES_BEFORE_WIDENING = 20;
// Empty shells and one-subscriber spam aren't worth 2 units of baseline sampling.
const MIN_CHANNEL_SUBSCRIBERS = 1000;
const MIN_CHANNEL_VIDEOS = 3;

export interface BoomingChannelOptions {
  /**
   * Subscriber band and age cap are applied to the candidate pool *before* we
   * spend two quota units per channel sampling its uploads. Filtering the ranked
   * output instead would pay for sixty channels and then show four of them.
   */
  subscriberMin?: number;
  subscriberMax?: number;
  maxAgeMonths?: number;
  region?: 'IN' | 'global';
  language?: string;
}

/**
 * Which format the channel is actually winning with. A channel whose Shorts
 * median is several times its long-form median is running a different playbook,
 * and a creator studying it should know that before copying anything.
 */
function resolveFormatFocus(baseline: ChannelBaseline | null): 'shorts' | 'long' | 'mixed' {
  if (!baseline) return 'mixed';
  const { shorts, longForm } = baseline;
  if (shorts > 0 && longForm === 0) return 'shorts';
  if (longForm > 0 && shorts === 0) return 'long';
  if (shorts === 0 && longForm === 0) return 'mixed';
  const ratio = shorts / longForm;
  if (ratio >= 2) return 'shorts';
  if (ratio <= 0.5) return 'long';
  return 'mixed';
}

/**
 * Finds channels in a niche and ranks them by *current* momentum.
 *
 * Channels are discovered through their videos rather than through
 * `search?type=channel`. Both cost 100 quota units, but a channel search returns
 * at most a handful of channels matched on their self-description, while a video
 * search returns 50 videos each carrying a channelId — channels found by what
 * they are *doing*, not by what their bio claims. The pool is shared with the
 * Content tab, so a user visiting both pays for the searches once.
 *
 * Ranking then comes from each channel's recent uploads: how fast the newest are
 * gaining views, and whether they beat the channel's own older ones. A channel
 * that was huge three years ago and is quiet now scores low.
 */
export async function fetchBoomingChannels(niche: string, options: BoomingChannelOptions = {}): Promise<BoomingChannel[]> {
  if (!API_KEY) throw new Error('YouTube API Key missing');

  const {
    subscriberMin = MIN_CHANNEL_SUBSCRIBERS,
    subscriberMax = Infinity,
    maxAgeMonths = Infinity,
    region = 'global',
    language = 'all',
  } = options;

  const publishedAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const seeds = await getSeedQueries(niche, SEED_QUERIES_WIDENED);

  const poolFor = (extraQueries: { q: string; order: string }[]) =>
    gatherNichePool({ niche, publishedAfter, language, contentType: 'all', region, depth: 'deep', extraQueries });

  const passesFilters = (c: any) => {
    const subs = toNum(c.statistics?.subscriberCount);
    return (
      toNum(c.statistics?.videoCount) >= MIN_CHANNEL_VIDEOS &&
      subs >= Math.max(subscriberMin, MIN_CHANNEL_SUBSCRIBERS) &&
      subs < subscriberMax &&
      channelAgeMonthsOf(c) <= maxAgeMonths
    );
  };

  let { videos, channelById } = await poolFor(seeds.slice(0, SEED_QUERIES_PER_POOL).map(q => ({ q, order: 'viewCount' })));
  let candidates = Array.from(channelById.values()).filter(passesFilters);

  /**
   * A narrow filter — "micro channels under two years old" — can leave a single
   * survivor in a hundred-channel pool. That's a recall failure, not an honest
   * empty result, so we widen: more long-tail queries, and `order=date` searches,
   * which return recent uploads regardless of channel size and are therefore where
   * the small channels are. Paid only when the filter actually starves the pool.
   */
  if (candidates.length < MIN_CANDIDATES_BEFORE_WIDENING && seeds.length > SEED_QUERIES_PER_POOL) {
    const widened = [
      ...seeds.slice(0, 4).map(q => ({ q, order: 'viewCount' })),
      ...seeds.slice(0, 2).map(q => ({ q, order: 'date' })),
    ];
    ({ videos, channelById } = await poolFor(widened));
    candidates = Array.from(channelById.values()).filter(passesFilters);
  }

  if (channelById.size === 0) return [];

  // What each channel actually published into this niche. The count is a prior on
  // whether it belongs here; the titles are the evidence the classifier judges on,
  // and they are far more telling than a channel's own bio.
  const poolVideoCounts = new Map<string, number>();
  const poolTitles = new Map<string, string[]>();
  for (const video of videos) {
    const id = video.snippet?.channelId;
    if (!id) continue;
    poolVideoCounts.set(id, (poolVideoCounts.get(id) ?? 0) + 1);
    const titles = poolTitles.get(id) ?? [];
    if (titles.length < 3) titles.push(video.snippet.title);
    poolTitles.set(id, titles);
  }

  if (candidates.length === 0) return [];

  // Pass 1 (coarse): drop what clearly isn't this niche before spending 2 quota
  // units per channel on baselines. All we know here is the channel's bio and the
  // one or two videos it put into the pool, so this pass only catches the obvious.
  const irrelevant = new Set(
    await findIrrelevant({
      niche,
      kind: 'channel',
      candidates: candidates.map((c: any) => ({
        id: c.id,
        title: c.snippet.title,
        description: c.snippet.description,
        sampleTitles: poolTitles.get(c.id),
      })),
    })
  );
  const relevant = candidates.filter((c: any) => !irrelevant.has(c.id));
  if (relevant.length === 0) return [];

  // Deep-sampling costs quota, so we can only afford MOMENTUM_SAMPLE_LIMIT of
  // them. Fill most slots by reach and reserve the rest for the youngest
  // channels — ranking purely by subscribers would truncate away exactly the
  // channels the breakout radar exists to surface.
  const bySubscribers = [...relevant].sort(
    (a: any, b: any) => toNum(b.statistics?.subscriberCount) - toNum(a.statistics?.subscriberCount)
  );
  const selected = new Map<string, any>(
    bySubscribers.slice(0, MOMENTUM_SAMPLE_LIMIT - YOUNG_CHANNEL_RESERVE).map((c: any) => [c.id, c])
  );

  const byAge = [...relevant].sort((a: any, b: any) => channelAgeMonthsOf(a) - channelAgeMonthsOf(b));
  for (const channel of byAge) {
    if (selected.size >= MOMENTUM_SAMPLE_LIMIT) break;
    selected.set(channel.id, channel);
  }
  const ranked = Array.from(selected.values());

  const baselines = await mapWithConcurrency(ranked, 8, async (c: any) => {
    const uploads = c.contentDetails?.relatedPlaylists?.uploads;
    return uploads ? await fetchChannelBaseline(c.id, uploads) : null;
  });

  // Pass 2 (fine): the baselines just handed us each channel's last 50 upload
  // titles at no extra quota cost. That is a far better description of what a
  // channel is actually about than its own bio, and it's how brand accounts,
  // meme channels and general-news outlets get caught.
  const stillIrrelevant = new Set(
    await findIrrelevant({
      niche,
      kind: 'channel',
      candidates: ranked.map((c: any, index: number) => ({
        id: c.id,
        title: c.snippet.title,
        description: c.snippet.description,
        sampleTitles: baselines[index]?.videos.slice(0, 6).map(v => v.title).filter(Boolean),
      })),
    })
  );

  const survivors = ranked
    .map((channel: any, index: number) => ({ channel, baseline: baselines[index] }))
    .filter(({ channel }) => !stillIrrelevant.has(channel.id));

  return survivors.map(({ channel: c, baseline }): BoomingChannel => {
    const videoCount = toNum(c.statistics?.videoCount);
    const channelAgeMonths = channelAgeMonthsOf(c);

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
      formatFocus: resolveFormatFocus(baseline),
      poolVideoCount: poolVideoCounts.get(c.id) ?? 0,
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
// Handle lookups cost 1 unit each; cap how many mined mentions we chase per pool.
const MAX_MENTION_HANDLES = 12;
// A pool is expensive (hundreds of units). Both research tabs draw from the same
// one, and a user flipping between them within half an hour pays for it once.
const POOL_TTL_MS = 30 * 60 * 1000;

interface NichePool {
  /** Non-live videos clearing the view floor, enriched with stats and duration. */
  videos: any[];
  /** Every channel behind those videos, plus channels mined from descriptions. */
  channelById: Map<string, any>;
}

const poolCache = new Map<string, { value: NichePool; expiresAt: number }>();

interface PoolOptions {
  niche: string;
  publishedAfter: string;
  language: string;
  contentType: 'all' | 'long' | 'short';
  region: 'IN' | 'global';
  depth: 'quick' | 'deep';
  /** Extra long-tail searches to widen discovery. Each costs 100 units. */
  extraQueries?: { q: string; order: string }[];
}

/**
 * Builds the candidate pool a niche's research is computed from.
 *
 * `search?type=video` and `search?type=channel` both cost 100 quota units, but a
 * video search returns 50 results each carrying a `channelId`, while a channel
 * search returns channels matched on their *name and description keywords* —
 * i.e. how a channel describes itself, not what it is currently doing. So we
 * discover channels through their videos, at up to 50 channels per 100 units
 * instead of 8, and get the videos themselves for free.
 *
 * Enrichment is nearly free by comparison: `videos.list` and `channels.list`
 * take 50 ids per request for 1 unit.
 */
async function gatherNichePool(options: PoolOptions): Promise<NichePool> {
  const { niche, publishedAfter, language, contentType, region, depth, extraQueries = [] } = options;

  const cacheKey = JSON.stringify(options);
  const cached = poolCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const videoDuration = contentType === 'short' ? 'short' : contentType === 'long' ? 'long' : 'any';
  const searches: { q: string; order: string }[] =
    depth === 'quick'
      ? [{ q: niche, order: 'viewCount' }]
      : [
          // Top performers, newest uploads (where small-channel breakouts hide),
          // and relevance — three complementary views of the same niche.
          { q: niche, order: 'viewCount' },
          { q: niche, order: 'date' },
          { q: niche, order: 'relevance' },
          ...extraQueries,
        ];

  const failures: Error[] = [];
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
        failures.push(e as Error);
        return [] as string[];
      }
    })
  );

  // If every search failed we have no pool at all. Swallowing that would render
  // an exhausted quota as "this niche has no channels", which is a lie — and it
  // denies the caller the chance to fall back to its cache.
  if (failures.length === searches.length) throw failures[0];

  const videoIds = Array.from(new Set(searchResults.flat()));
  if (videoIds.length === 0) return { videos: [], channelById: new Map() };

  const items = await fetchVideosByIds(videoIds);
  const videos = items.filter(
    (v: any) => !isLiveBroadcast(v) && toNum(v.statistics?.viewCount) >= MIN_VIEWS_FOR_OUTLIER
  );

  // Walk the citation graph in the descriptions we already paid for.
  const mentions = extractChannelMentions(videos.map((v: any) => v.snippet?.description ?? ''));
  const resolvedHandles = await mapWithConcurrency(
    mentions.handles.slice(0, MAX_MENTION_HANDLES),
    6,
    resolveHandle
  );

  const channelIds = Array.from(
    new Set([
      ...videos.map((v: any) => v.snippet?.channelId),
      ...mentions.ids,
      ...resolvedHandles,
    ].filter(Boolean))
  ) as string[];

  const channels = await fetchChannelsByIds(channelIds);
  const pool: NichePool = { videos, channelById: new Map(channels.map((c: any) => [c.id, c])) };

  // A pool built from a partially-failed set of searches is thinner than it should
  // be. Don't pin that degraded result in the cache for the next half hour.
  if (failures.length === 0) poolCache.set(cacheKey, { value: pool, expiresAt: Date.now() + POOL_TTL_MS });
  return pool;
}

/**
 * The research page's video search.
 *
 * A single `order=viewCount` search returns big-channel videos, so any
 * small-channel breakout is filtered out *before* outlier math can find it. The
 * pool draws on complementary searches instead, then ranks the union here.
 *
 * Off-topic hits are dropped before we spend baseline quota on them: a keyword
 * search for "Finance" returns political clips and hashtag spam, and sampling a
 * channel's uploads costs 2 units we'd rather not waste.
 *
 * Results are sorted by outlier score; callers re-sort client-side for free.
 */
export async function searchOutlierVideos(options: OutlierSearchOptions): Promise<ResearchVideo[]> {
  if (!API_KEY) throw new Error('YouTube API Key is missing');
  const { niche, publishedAfter, language, contentType, region, limit = 36, depth = 'deep' } = options;

  // The head term surfaces the channels that already rank for it. The long tail is
  // where small channels win, so it's where the interesting outliers are. Agent
  // tools stay on 'quick' and skip this — they shouldn't spend 200 extra units.
  const seeds = depth === 'deep' ? await getSeedQueries(niche, SEED_QUERIES_PER_POOL) : [];
  const extraQueries = seeds.map(q => ({ q, order: 'viewCount' }));

  const { videos: eligible, channelById } = await gatherNichePool({
    niche, publishedAfter, language, contentType, region, depth, extraQueries,
  });
  if (eligible.length === 0) return [];

  const { subscriberMin = 0, subscriberMax = Infinity } = options;

  // Pass 1: rank on the free lifetime average (channel views ÷ video count) to
  // decide which candidates are worth paying for an accurate baseline.
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

  // Pass 2: drop what clearly isn't about this niche, then take the shortlist.
  // We classify three times the requested count so the filter has room to cut.
  const preFilter = scored.slice(0, Math.min(scored.length, limit * 3));
  const irrelevant = new Set(
    await findIrrelevant({
      niche,
      kind: 'video',
      candidates: preFilter.map(s => ({
        id: s.item.id,
        title: s.item.snippet.title,
        context: s.item.snippet.channelTitle,
        description: s.item.snippet.description,
      })),
    })
  );
  const shortlist = preFilter.filter(s => !irrelevant.has(s.item.id)).slice(0, limit * 2);

  // Pass 3: real baselines for the channels behind the surviving candidates.
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

// --- Similar channels -------------------------------------------------------

export interface SimilarChannel {
  id: string;
  title: string;
  handle: string;
  avatarUrl: string;
  subscriberCount: string;
  /** How many of the source channel's search queries this channel also ranked for. */
  coRankCount: number;
  /** The source channel linked to this one from a video description. */
  cited: boolean;
  /** The source channel lists this one under Featured Channels. */
  featured: boolean;
  /**
   * Share of this channel's sampled commenters who also comment on the source.
   * The closest legitimate proxy for "viewers also watch" — YouTube exposes no
   * audience data, but it does expose who leaves comments.
   */
  audienceOverlap: number;
  /** How many commenters we could sample. Small samples make overlap unreliable. */
  overlapSampleSize: number;
  /** Raw count of commenters seen on both channels. Unrelated channels share zero. */
  sharedCommenters: number;
  /** This channel's subscribers ÷ the source's. 1 = same size, 10 = ten times bigger. */
  sizeRatio: number;
  /** Within an order of magnitude of the source — a channel you could actually model. */
  isPeer: boolean;
  /** The strongest signal behind this match, for grouping in the UI. */
  matchKind: 'audience' | 'featured' | 'linked' | 'topic';
  /** 0–100, blending every signal above. */
  score: number;
  reasons: string[];
}

/** A search page returns at most 50 results; rank weights are relative to that. */
const SEARCH_PAGE_SIZE = 50;
/**
 * Beyond this size gap the channel stops being a peer. National Geographic and a
 * 19K-subscriber science channel can rank for the same query without one being
 * remotely useful as a model for the other, so vast channels are damped rather
 * than dropped — they're still context, just not the answer.
 */
const PEER_SIZE_RATIO = 10;
const SIZE_MISMATCH_FLOOR = 0.35;

/**
 * Damps a channel's score by how far its size is from the source's. Symmetric in
 * log space: ten times bigger and ten times smaller are equally unlike you.
 */
function sizeProximity(sizeRatio: number): number {
  if (!Number.isFinite(sizeRatio) || sizeRatio <= 0) return SIZE_MISMATCH_FLOOR;
  const decades = Math.abs(Math.log10(sizeRatio));
  return Math.max(SIZE_MISMATCH_FLOOR, 1 - decades / 3);
}

/**
 * Comment pages cost 1 unit each and cap at 100 top-level threads.
 *
 * Sampling is deliberately asymmetric. The overlap coefficient works out to
 * roughly `ρ × nSource / N`, so it scales with the *larger* sample — which means
 * sampling the source channel deeply lifts every candidate's measured overlap
 * out of the noise, and we pay for that depth exactly once. Candidates stay
 * shallow at ~8 units each. Measured on real channels, a shallow-source sample
 * put related pairs at ~1% overlap on 4-9 shared commenters: the right ordering,
 * but too fragile to show anyone.
 */
const COMMENT_PAGES_SOURCE = 5;
const COMMENT_VIDEOS_SOURCE = 8;
const COMMENT_PAGES_CANDIDATE = 2;
const COMMENT_VIDEOS_CANDIDATE = 4;
// Overlap below this sample size is noise, not measurement.
const MIN_OVERLAP_SAMPLE = 40;
// Fewer shared commenters than this can't distinguish a real audience from chance.
const MIN_SHARED_COMMENTERS = 3;
/**
 * Measured on channels whose relationship we know: genuinely related creators
 * (Graham Stephan / Andrei Jikh / Meet Kevin) land at 1.4–2.4% overlap, while
 * unrelated controls (a finance channel against a cooking channel) land at
 * 0.0–0.2%. A raw shared-commenter count doesn't separate them — a big enough
 * sample finds a few coincidental commenters anywhere — but the coefficient does.
 */
const MIN_MEANINGFUL_OVERLAP = 0.005;
const MAX_SIMILAR_CANDIDATES = 20;
const SIMILAR_TTL_MS = 12 * 60 * 60 * 1000;

const similarCache = new Map<string, { value: SimilarChannel[]; expiresAt: number }>();

/** Featured channels the creator curated by hand. 1 quota unit, perfect precision. */
async function fetchFeaturedChannels(channelId: string): Promise<string[]> {
  try {
    const res = await fetch(`${BASE_URL}/channelSections?part=contentDetails&channelId=${channelId}&key=${API_KEY}`);
    const data = await handleYoutubeResponse(res);
    const ids: string[] = [];
    for (const section of data.items || []) {
      for (const id of section.contentDetails?.channels || []) ids.push(id);
    }
    return Array.from(new Set(ids));
  } catch (e) {
    console.warn('channelSections failed:', e);
    return [];
  }
}

/**
 * The channel IDs of people who left top-level comments. `commentThreads` costs
 * 1 unit per page of 100, and comments are frequently disabled, so this returns
 * whatever it can rather than failing.
 */
async function fetchCommenters(videoIds: string[], pages: number): Promise<Set<string>> {
  const commenters = new Set<string>();

  await mapWithConcurrency(videoIds, 4, async (videoId) => {
    let pageToken: string | undefined;
    for (let page = 0; page < pages; page++) {
      try {
        const params = new URLSearchParams({
          part: 'snippet', videoId, maxResults: '100', order: 'relevance', key: API_KEY!,
        });
        if (pageToken) params.set('pageToken', pageToken);
        const res = await fetch(`${BASE_URL}/commentThreads?${params.toString()}`);
        const data = await handleYoutubeResponse(res);
        for (const thread of data.items || []) {
          const author = thread.snippet?.topLevelComment?.snippet?.authorChannelId?.value;
          if (author) commenters.add(author);
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      } catch {
        // Comments disabled, or the video is age-restricted. Move on.
        break;
      }
    }
  });

  return commenters;
}

/** Top-viewed videos from a channel's baseline sample, newest-heavy by construction. */
async function topVideoIds(channelId: string, uploadsPlaylistId: string, count: number): Promise<string[]> {
  const baseline = await fetchChannelBaseline(channelId, uploadsPlaylistId);
  if (!baseline) return [];
  return [...baseline.videos].sort((a, b) => b.views - a.views).slice(0, count).map(v => v.id);
}

/**
 * The engaged-commenter sample for one channel: the people who left top-level
 * comments on its best-performing recent videos. Exported so the overlap signal
 * can be measured against real channels rather than assumed to work.
 */
export async function sampleChannelCommenters(
  channelId: string,
  videoCount = COMMENT_VIDEOS_SOURCE,
  pages = COMMENT_PAGES_SOURCE
): Promise<string[]> {
  const [channel] = await fetchChannelsByIds([channelId]);
  const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];
  const videoIds = await topVideoIds(channelId, uploads, videoCount);
  return Array.from(await fetchCommenters(videoIds, pages));
}

/**
 * Finds the channels most like this one.
 *
 * YouTube removed `search?relatedToVideoId` in 2023, so similarity has to be
 * constructed. Four signals, cheapest first:
 *
 *   citations  — channels this one links from its own video descriptions (0 units)
 *   featured   — channels it lists under Featured Channels (1 unit)
 *   co-ranking — channels that rank for the same viewer queries (~300 units)
 *   overlap    — share of engaged commenters the two channels have in common
 *
 * Co-ranking finds who competes for the same viewers; overlap measures whether
 * they actually share them.
 */
export async function findSimilarChannels(channelId: string): Promise<SimilarChannel[]> {
  if (!API_KEY) throw new Error('YouTube API Key is missing');

  const cached = similarCache.get(channelId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [source] = await fetchChannelsByIds([channelId]);
  const uploads = source?.contentDetails?.relatedPlaylists?.uploads;
  if (!source || !uploads) return [];

  const baseline = await fetchChannelBaseline(channelId, uploads);
  if (!baseline) return [];

  const bestVideos = [...baseline.videos].sort((a, b) => b.views - a.views);
  const topTitles = bestVideos.slice(0, 8).map(v => v.title).filter(Boolean);

  // Citations: read the descriptions of the channel's own best videos (1 unit).
  const described = await fetchVideosByIds(bestVideos.slice(0, 30).map(v => v.id), 'snippet');
  const mentions = extractChannelMentions(described.map((v: any) => v.snippet?.description ?? ''));
  const citedHandles = await mapWithConcurrency(mentions.handles.slice(0, MAX_MENTION_HANDLES), 6, resolveHandle);
  const cited = new Set([...mentions.ids, ...citedHandles.filter(Boolean)] as string[]);

  const featured = new Set(await fetchFeaturedChannels(channelId));

  // Co-ranking: who else shows up for the queries this channel wins on.
  //
  // Position matters. Counting a bare appearance gives the channel ranked #1 and
  // the channel ranked #48 the same credit, and since a search returns 50 results
  // across only three queries, almost every candidate ends up on exactly 1 — every
  // row scores identically and the list isn't ranked at all. Weight by rank instead.
  const coRankCounts = new Map<string, number>();
  const coRankWeights = new Map<string, number>();
  try {
    const { queries } = await getCompetitorQueries({ channelTitle: source.snippet.title, topTitles });
    const publishedAfter = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

    const perQuery = await Promise.all(
      queries.map(async (q) => {
        const params = new URLSearchParams({
          part: 'snippet', type: 'video', q, order: 'viewCount', maxResults: '50', publishedAfter, key: API_KEY!,
        });
        try {
          const res = await fetch(`${BASE_URL}/search?${params.toString()}`);
          const data = await handleYoutubeResponse(res);
          // Keep each channel's best position within this query.
          const best = new Map<string, number>();
          (data.items || []).forEach((item: any, index: number) => {
            const id = item.snippet?.channelId;
            if (id && !best.has(id)) best.set(id, index);
          });
          return best;
        } catch {
          return new Map<string, number>();
        }
      })
    );

    for (const best of perQuery) {
      for (const [id, index] of best) {
        coRankCounts.set(id, (coRankCounts.get(id) ?? 0) + 1);
        coRankWeights.set(id, (coRankWeights.get(id) ?? 0) + (1 - index / SEARCH_PAGE_SIZE));
      }
    }
  } catch (e) {
    console.warn('Competitor query generation failed; relying on citations and featured channels:', e);
  }

  const candidateIds = Array.from(new Set([...coRankCounts.keys(), ...cited, ...featured])).filter(
    id => id !== channelId
  );
  if (candidateIds.length === 0) return [];

  // Rank cheaply before paying for comments: hand-curated links first, then the
  // channels that co-ranked most often.
  const prioritised = candidateIds
    .sort((a, b) => {
      const weight = (id: string) =>
        (featured.has(id) ? 4 : 0) + (cited.has(id) ? 3 : 0) + (coRankCounts.get(id) ?? 0);
      return weight(b) - weight(a);
    })
    .slice(0, MAX_SIMILAR_CANDIDATES);

  const candidates = await fetchChannelsByIds(prioritised);
  if (candidates.length === 0) return [];

  // Paid once, deeply — every candidate's measured overlap scales with this sample.
  const sourceCommenters = await fetchCommenters(
    bestVideos.slice(0, COMMENT_VIDEOS_SOURCE).map(v => v.id),
    COMMENT_PAGES_SOURCE
  );

  const overlaps = await mapWithConcurrency(candidates, 4, async (candidate: any) => {
    const empty = { overlap: 0, sample: 0, shared: 0 };
    const candidateUploads = candidate.contentDetails?.relatedPlaylists?.uploads;
    if (!candidateUploads || sourceCommenters.size < MIN_OVERLAP_SAMPLE) return empty;

    const videoIds = await topVideoIds(candidate.id, candidateUploads, COMMENT_VIDEOS_CANDIDATE);
    const commenters = await fetchCommenters(videoIds, COMMENT_PAGES_CANDIDATE);
    if (commenters.size < MIN_OVERLAP_SAMPLE) return { ...empty, sample: commenters.size };

    let shared = 0;
    for (const id of commenters) if (sourceCommenters.has(id)) shared++;

    const overlap = overlapCoefficient(sourceCommenters, commenters);
    const meaningful = shared >= MIN_SHARED_COMMENTERS && overlap >= MIN_MEANINGFUL_OVERLAP;
    return { overlap: meaningful ? overlap : 0, sample: commenters.size, shared };
  });

  const sourceSubs = toNum(source.statistics?.subscriberCount);

  const results: SimilarChannel[] = candidates.map((c: any, index: number) => {
    const coRankCount = coRankCounts.get(c.id) ?? 0;
    const coRankWeight = coRankWeights.get(c.id) ?? 0;
    const isCited = cited.has(c.id);
    const isFeatured = featured.has(c.id);
    const { overlap, sample, shared } = overlaps[index];

    const subs = toNum(c.statistics?.subscriberCount);
    const sizeRatio = sourceSubs > 0 && subs > 0 ? subs / sourceSubs : 0;
    const isPeer = sizeRatio > 0 && sizeRatio <= PEER_SIZE_RATIO && sizeRatio >= 1 / PEER_SIZE_RATIO;

    const reasons: string[] = [];
    if (overlap > 0) {
      reasons.push(`${shared} of its ${sample} sampled commenters also comment on ${source.snippet.title}`);
    }
    if (isFeatured) reasons.push(`${source.snippet.title} lists it under featured channels`);
    if (isCited) reasons.push(`Linked from ${source.snippet.title}'s video descriptions`);
    if (coRankCount > 0) {
      reasons.push(`Ranks alongside them for ${coRankCount} shared viewer ${coRankCount === 1 ? 'query' : 'queries'}`);
    }
    if (!isPeer && sizeRatio > 0) {
      reasons.push(sizeRatio > 1 ? `${Math.round(sizeRatio)}x bigger — context, not a model` : 'Much smaller audience');
    }

    // Overlap is the only *measured* signal — the others are structural hints — so
    // it dominates when present. Its scale is set by how deeply we sampled the
    // source, so it ranks within one result set rather than being portable.
    // Co-ranking is rank-weighted, not counted, or every row ties.
    const raw = overlap * 2000 + coRankWeight * 26 + (isCited ? 18 : 0) + (isFeatured ? 22 : 0);
    const score = Math.round(Math.min(100, raw * sizeProximity(sizeRatio)));

    const matchKind: SimilarChannel['matchKind'] =
      overlap > 0 ? 'audience' : isFeatured ? 'featured' : isCited ? 'linked' : 'topic';

    return {
      id: c.id,
      title: c.snippet.title,
      handle: c.snippet.customUrl || `@${c.id}`,
      avatarUrl: c.snippet.thumbnails?.default?.url,
      subscriberCount: c.statistics?.subscriberCount ?? '0',
      coRankCount,
      cited: isCited,
      featured: isFeatured,
      audienceOverlap: overlap,
      overlapSampleSize: sample,
      sharedCommenters: shared,
      sizeRatio,
      isPeer,
      matchKind,
      score,
      reasons,
    };
  });

  const sorted = results.filter(r => r.score > 0).sort((a, b) => b.score - a.score);
  similarCache.set(channelId, { value: sorted, expiresAt: Date.now() + SIMILAR_TTL_MS });
  return sorted;
}

/**
 * What Creator Times needs to know about a creator to judge whether a platform
 * change affects them. `shortsShare` is the field that does most of the work: a
 * Shorts monetization change is urgent for a Shorts channel and irrelevant to a
 * long-form one, and nothing else we store tells us which they are.
 *
 * Costs ~3 quota units (one channel lookup, one uploads page, one stats batch),
 * and the baseline is cached for 12h, so a repeat visit is free.
 */
export async function buildCreatorProfile(channelId: string): Promise<{
  channelTitle: string;
  subscriberCount: number;
  shortsShare: number;
} | null> {
  if (!API_KEY || !channelId) return null;

  const [channel] = await fetchChannelsByIds([channelId]);
  const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!channel || !uploads) return null;

  const baseline = await fetchChannelBaseline(channelId, uploads);
  const sample = baseline?.videos ?? [];

  return {
    channelTitle: channel.snippet.title,
    subscriberCount: toNum(channel.statistics?.subscriberCount),
    shortsShare: sample.length > 0 ? sample.filter(v => v.short).length / sample.length : 0,
  };
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
