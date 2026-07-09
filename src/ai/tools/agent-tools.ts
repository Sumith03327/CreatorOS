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
import { analyzeScript } from '@/ai/flows/analyze-script-flow';
import { getTrendSummary, getTitlePatterns } from '@/ai/flows/get-insane-insights-flow';

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

// --- Tool 4: analyze_video_script (wraps the existing analyze-script flow) ---

const analyzeVideoScript: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'analyze_video_script',
      description:
        "Deeply analyze a YouTube video's SCRIPT/structure from its transcript: hook strength (0-10), pacing/structure rating, best moment, likely drop-off points, emotional tone, and concrete improvements. Use this to critique or learn from a video's writing — the user's own or a competitor's.",
      parameters: {
        type: 'object',
        properties: {
          video: { type: 'string', description: 'A YouTube video URL or 11-character video ID.' },
        },
        required: ['video'],
      },
    },
  },
  async execute(args) {
    const videoId = extractVideoId(String(args.video ?? '').trim());
    if (!videoId) return `tool failed: "${args.video}" is not a recognizable YouTube video.`;
    try {
      const [details, segments] = await Promise.all([
        fetchVideoDetails(videoId).catch(() => null),
        fetchTranscript(videoId),
      ]);
      if (!segments.length) return 'tool failed: no transcript/captions available for this video.';
      const transcript = segments.map((s) => s.text).join(' ');
      const a = await analyzeScript({ transcript, videoTitle: details?.title || 'Untitled' });
      return [
        `Title: ${details?.title || 'Unknown'}`,
        `Hook: ${a.hook.score}/10 — "${a.hook.text}"`,
        `Structure: ${a.structure.rating} — ${a.structure.details}`,
        `Best moment: ${a.bestMoment}`,
        `Weak spots: ${a.weakSpots.join('; ')}`,
        `Emotional tone: ${a.emotionalTone}`,
        `Improvements: ${a.improvements.join('; ')}`,
      ].join('\n');
    } catch (e: any) {
      return `tool failed: ${e?.message || 'error analyzing script'}.`;
    }
  },
};

// --- Tool 5: get_trending_summary (wraps get-insane-insights) ---

const getTrendingSummary: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'get_trending_summary',
      description:
        'Get a punchy 3-bullet summary of what is working RIGHT NOW in a given niche on YouTube. Use to ground ideas, hooks, or strategy in current trends.',
      parameters: {
        type: 'object',
        properties: {
          niche: { type: 'string', description: 'The content niche or topic (e.g. "beginner Python tutorials", "personal finance").' },
        },
        required: ['niche'],
      },
    },
  },
  async execute(args) {
    const niche = String(args.niche ?? '').trim();
    if (!niche) return 'tool failed: no niche provided.';
    try {
      const { bullets } = await getTrendSummary({ niche });
      return `What's working in "${niche}" right now:\n` + bullets.map((b) => `- ${b}`).join('\n');
    } catch (e: any) {
      return `tool failed: ${e?.message || 'error fetching trends'}.`;
    }
  },
};

// --- Tool 6: analyze_title_patterns (composite: search + get-title-patterns) ---

const analyzeTitlePatterns: AgentTool = {
  schema: {
    type: 'function',
    function: {
      name: 'analyze_title_patterns',
      description:
        'Discover the TITLE patterns driving views in a niche: searches the current top-performing videos, then extracts 3 concrete patterns (formats, power words, structures) you can reuse. Use before writing or optimizing titles.',
      parameters: {
        type: 'object',
        properties: {
          niche: { type: 'string', description: 'The content niche or topic to study titles in.' },
        },
        required: ['niche'],
      },
    },
  },
  async execute(args) {
    const niche = String(args.niche ?? '').trim();
    if (!niche) return 'tool failed: no niche provided.';
    try {
      const publishedAfter = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const videos = await searchTrendingVideos(niche, publishedAfter, 'all', 'all', 'global', 'viewCount');
      const titles = videos.slice(0, 15).map((v) => v.title).filter(Boolean);
      if (!titles.length) return `No recent top videos found for "${niche}" to study.`;
      const { insights } = await getTitlePatterns({ niche, titles });
      return (
        `Title patterns in "${niche}" (from ${titles.length} top videos):\n` +
        insights.map((i) => `- ${i}`).join('\n') +
        `\n\nSample titles studied:\n` +
        titles.slice(0, 6).map((t) => `• ${t}`).join('\n')
      );
    } catch (e: any) {
      return `tool failed: ${e?.message || 'error analyzing title patterns'}.`;
    }
  },
};

// --- Registry ---

const REGISTRY: Record<string, AgentTool> = {
  get_youtube_channel: getYouTubeChannel,
  get_video_transcript: getVideoTranscript,
  search_youtube_videos: searchYouTubeVideos,
  analyze_video_script: analyzeVideoScript,
  get_trending_summary: getTrendingSummary,
  analyze_title_patterns: analyzeTitlePatterns,
};

/** All tool schemas, to pass to Mesh's `tools` param. */
export const AGENT_TOOL_SCHEMAS: MeshToolSchema[] = Object.values(REGISTRY).map((t) => t.schema);

/** Names of every registered tool (for building per-agent toolsets in the UI). */
export const ALL_TOOL_NAMES = Object.keys(REGISTRY);

/**
 * Resolve a per-agent toolset to Mesh schemas. Pass a list of tool names to
 * expose only those (unknown names are ignored); pass nothing/empty to expose
 * ALL tools (backward-compatible default).
 */
export function getToolSchemas(names?: string[]): MeshToolSchema[] {
  if (!names || names.length === 0) return AGENT_TOOL_SCHEMAS;
  return names.map((n) => REGISTRY[n]?.schema).filter(Boolean) as MeshToolSchema[];
}

/**
 * Execute a tool call by name. Always resolves to a string (never throws) so the
 * agent loop stays alive on tool failures.
 */
export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  const tool = REGISTRY[name];
  if (!tool) return `tool failed: unknown tool "${name}".`;
  return tool.execute(args);
}
