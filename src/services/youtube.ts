
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
  
  const idMatch = url.match(/channel\/([a-zA-Z0-9_-]+)/);
  let channelId = idMatch ? idMatch[1] : null;

  if (!channelId) {
    const handleMatch = url.match(/@([a-zA-Z0-9._-]+)/);
    const query = handleMatch ? `@${handleMatch[1]}` : url;
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

export async function fetchRecentVideos(playlistId: string, maxResults: number = 20): Promise<YouTubeVideoData[]> {
  if (!API_KEY || !playlistId) return [];
  const endpoint = `${BASE_URL}/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${maxResults}&key=${API_KEY}`;
  const response = await fetch(endpoint);
  const data = await handleYoutubeResponse(response);
  return (data.items || []).map((item: any) => ({
    id: item.contentDetails.videoId,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails.high?.url,
    publishedAt: item.snippet.publishedAt,
    viewCount: "0",
  }));
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

export async function fetchSupadataTranscript(videoId: string) { return null; }
export async function fetchAssemblyAITranscript(videoId: string) { return null; }
