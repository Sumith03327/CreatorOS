
'use server';

/**
 * STANDALONE YOUTUBE SERVICE
 * All data fetching remains server-side.
 * Caching has been simplified to avoid Firestore dependencies.
 */

import { YoutubeTranscript } from 'youtube-transcript';

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

export async function fetchBoomingChannels(niche: string): Promise<any[]> {
  if (!API_KEY) throw new Error('YouTube API Key missing');

  const queries = [`${niche} tips`, `${niche} tutorial`];

  try {
    const searchPromises = queries.map(q => 
      fetch(`${BASE_URL}/search?part=snippet&type=channel&q=${encodeURIComponent(q)}&maxResults=5&key=${API_KEY}`)
        .then(r => handleYoutubeResponse(r))
    );
    const searchResults = await Promise.all(searchPromises);
    const allChannelIds = searchResults.flatMap(res => res.items?.map((i: any) => i.id.channelId) || []).filter(Boolean);
    const uniqueIds = Array.from(new Set(allChannelIds)).slice(0, 50);

    if (uniqueIds.length === 0) return [];

    const idsString = uniqueIds.join(',');
    const url = `${BASE_URL}/channels?part=snippet,statistics,contentDetails&id=${idsString}&key=${API_KEY}`;
    const channelsResponse = await fetch(url);
    const channelsData = await handleYoutubeResponse(channelsResponse);
    
    return (channelsData.items || []).map((c: any) => {
      const videoCount = parseInt(c.statistics.videoCount || "0");
      const subCount = parseInt(c.statistics.subscriberCount || "0");
      const viewCount = parseInt(c.statistics.viewCount || "0");
      return {
        id: c.id,
        title: c.snippet.title,
        description: c.snippet.description,
        thumbnails: c.snippet.thumbnails,
        statistics: c.statistics,
        handle: c.snippet.customUrl || `@${c.id}`,
        uploadsPerMonth: Math.round(videoCount / 24),
        channelAgeMonths: 24,
        growthScore: (viewCount / Math.max(1, subCount)) * 5,
        isFaceless: false
      };
    });
  } catch (err) {
    console.error(err);
    throw err;
  }
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
