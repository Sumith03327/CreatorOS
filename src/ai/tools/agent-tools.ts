/**
 * @fileOverview Tool registry for the "Build Your Own Agent" tool-calling loop.
 *
 * Each tool exposes an OpenAI-compatible JSON schema (sent to Mesh via the
 * `tools` param) and an `execute(args)` function that wraps an EXISTING
 * youtube.ts service. Executors return a compact string and swallow their own
 * errors (returning a readable "tool failed: …" message) so the agent loop
 * never crashes — the model can see the failure and react.
 *
 * This is a plain server-side module (no 'use server') because it exports
 * schema objects, not just async functions. It's imported by the agent flow,
 * which runs on the server.
 */

import type { MeshToolSchema } from '@/services/mesh';
import {
  fetchYouTubeChannelData,
  fetchVideoDetails,
  fetchTranscript,
  searchTrendingVideos,
} from '@/services/youtube';

// --- Shared helper (mirrors the regex previously inline in run-custom-agent-flow) ---

export function extractVideoId(url: string): string | null {
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const embedMatch = url.match(/youtube\.com\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  // Bare 11-char id
  if (/^[a-zA-Z0-9_-]{11}$/.test(url.trim())) return url.trim();
  return null;
}

// --- Tool definition type ---

interface AgentTool {
  schema: MeshToolSchema;
  execute: (args: Record<string, any>) => Promise<string>;
}

// --- Tool 1: get_youtube_channel ---

const getYouTubeChannel: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'get_youtube_channel',
      description:
        "Fetch real, current statistics for a YouTube channel: subscriber count, total views, video count, and description. Use this whenever the user asks about a channel's size, growth, or identity, or refers to 'my channel' with a URL/handle.",
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'A YouTube channel URL, @handle, or channel ID (e.g. https://youtube.com/@MrBeast or @MrBeast).',
          },
        },
        required: ['channel'],
      },
    },
  },
  async execute(args) {
    const channel = String(args.channel ?? '').trim();
    if (!channel) return 'tool failed: no channel provided.';
    try {
      const data = await fetchYouTubeChannelData(channel);
      if (!data) return `tool failed: could not find a YouTube channel for "${channel}".`;
      return [
        `Channel: ${data.title}`,
        `Handle: ${data.customUrl || 'N/A'}`,
        `Subscribers: ${data.statistics.subscriberCount}`,
        `Total Views: ${data.statistics.viewCount}`,
        `Video Count: ${data.statistics.videoCount}`,
        `Created: ${data.publishedAt}`,
        `Description: ${(data.description || '').slice(0, 500)}`,
      ].join('\n');
    } catch (e: any) {
      return `tool failed: ${e?.message || 'error fetching channel'}.`;
    }
  },
};

// --- Tool 2: get_video_transcript ---

const getVideoTranscript: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'get_video_transcript',
      description:
        "Fetch a YouTube video's title, basic stats, and full spoken transcript. Use this to summarize, repurpose (into threads, newsletters, scripts), fact-check, or analyze the actual content of a specific video.",
      parameters: {
        type: 'object',
        properties: {
          video: {
            type: 'string',
            description: 'A YouTube video URL (watch, youtu.be, shorts, or embed) or an 11-character video ID.',
          },
        },
        required: ['video'],
      },
    },
  },
  async execute(args) {
    const input = String(args.video ?? '').trim();
    const videoId = extractVideoId(input);
    if (!videoId) return `tool failed: "${input}" is not a recognizable YouTube video URL or ID.`;
    try {
      const [details, segments] = await Promise.all([
        fetchVideoDetails(videoId).catch(() => null),
        fetchTranscript(videoId),
      ]);
      const header = details
        ? `Title: ${details.title}\nChannel: ${details.channelTitle || 'Unknown'}\nViews: ${details.viewCount || 'N/A'}\nPublished: ${details.publishedAt}\n\n`
        : '';
      if (!segments.length) {
        return `${header}Transcript: (unavailable — this video has no captions, or they are disabled.)`;
      }
      // Cap length so we don't blow the context window on long videos.
      const transcript = segments.map((s) => s.text).join(' ');
      const capped = transcript.length > 6000 ? transcript.slice(0, 6000) + ' …[transcript truncated]' : transcript;
      return `${header}Transcript:\n${capped}`;
    } catch (e: any) {
      return `tool failed: ${e?.message || 'error fetching transcript'}.`;
    }
  },
};

// --- Tool 3: search_youtube_videos ---

const searchYouTubeVideos: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'search_youtube_videos',
      description:
        'Search YouTube for real, current videos on a topic or niche — returns titles, channels, view counts, and subscriber counts. Use this to research what is working now, scout competitors, find trending formats, or validate a content idea against reality.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The topic, niche, or keywords to search for.' },
          timeframe: {
            type: 'string',
            enum: ['week', 'month', 'year', 'all'],
            description: 'How recent the videos should be. Defaults to month.',
          },
          contentType: {
            type: 'string',
            enum: ['all', 'long', 'short'],
            description: 'Filter by long-form, shorts, or all. Defaults to all.',
          },
        },
        required: ['query'],
      },
    },
  },
  async execute(args) {
    const query = String(args.query ?? '').trim();
    if (!query) return 'tool failed: no search query provided.';
    const timeframe = (args.timeframe as string) || 'month';
    const contentType = (['all', 'long', 'short'].includes(args.contentType) ? args.contentType : 'all') as
      | 'all'
      | 'long'
      | 'short';

    const now = Date.now();
    const days = timeframe === 'week' ? 7 : timeframe === 'year' ? 365 : timeframe === 'all' ? 3650 : 30;
    const publishedAfter = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

    try {
      const videos = await searchTrendingVideos(query, publishedAfter, 'all', contentType, 'global', 'viewCount');
      if (!videos.length) return `No videos found for "${query}" in the selected timeframe.`;
      return videos
        .slice(0, 10)
        .map(
          (v, i) =>
            `${i + 1}. "${v.title}" — ${v.channelTitle || 'Unknown'} | ${Number(v.viewCount || 0).toLocaleString()} views | ${Number(
              v.subscriberCount || 0
            ).toLocaleString()} subs`
        )
        .join('\n');
    } catch (e: any) {
      return `tool failed: ${e?.message || 'error searching YouTube'}.`;
    }
  },
};

// --- Registry ---

const REGISTRY: Record<string, AgentTool> = {
  get_youtube_channel: getYouTubeChannel,
  get_video_transcript: getVideoTranscript,
  search_youtube_videos: searchYouTubeVideos,
};

/** All tool schemas, to pass to Mesh's `tools` param. */
export const AGENT_TOOL_SCHEMAS: MeshToolSchema[] = Object.values(REGISTRY).map((t) => t.schema);

/**
 * Execute a tool call by name. Always resolves to a string (never throws) so the
 * agent loop stays alive on tool failures.
 */
export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  const tool = REGISTRY[name];
  if (!tool) return `tool failed: unknown tool "${name}".`;
  return tool.execute(args);
}
