/**
 * @fileOverview Registry of first-party "built-in" agents shown in the Agent Hub.
 *
 * Each built-in agent is just a system prompt + a toolset (names from the
 * agent-tools registry) + an optional model. Adding a new capable agent is
 * therefore a data change here — no new plumbing. Tools let these agents
 * orchestrate the app's REAL capabilities (channel data, transcripts, trend &
 * title analysis) instead of guessing.
 *
 * Client-safe data module (icons are lucide components); the tool NAMES are
 * plain strings resolved server-side by `getToolSchemas`.
 */

import {
  Type,
  TrendingUp,
  PenLine,
  Recycle,
  Search,
  CalendarDays,
  Image as ImageIcon,
  type LucideIcon,
} from 'lucide-react';

export interface BuiltinAgent {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: LucideIcon;
  gradient: string;
  /** 'CHAT' agents run through the tool-calling chat loop; 'STUDIO' opens the Thumbnail Studio. */
  action: 'CHAT' | 'STUDIO';
  /** System prompt (only for CHAT agents). */
  instructions?: string;
  /** Tool names this agent may use. Empty = all tools. */
  tools?: string[];
  /** Optional model override (defaults to deepseek-v3). */
  model?: string;
}

export const BUILTIN_AGENTS: BuiltinAgent[] = [
  {
    id: 'thumbnail-studio',
    name: 'Thumbnail Studio',
    category: 'Design',
    description: "Reads your channel's style and face, then designs real, on-brand thumbnails.",
    icon: ImageIcon,
    gradient: 'from-fuchsia-500 to-indigo-500',
    action: 'STUDIO',
  },
  {
    id: 'title-doctor',
    name: 'Title & Hook Doctor',
    category: 'Growth',
    description: 'Scores your titles for clickability and rewrites them using patterns that actually win.',
    icon: Type,
    gradient: 'from-amber-500 to-orange-600',
    action: 'CHAT',
    instructions:
      'You are the Title & Hook Doctor for a YouTube creator. Your job: make titles and opening hooks more clickable WITHOUT clickbait that hurts retention. ' +
      'When the user gives a title, topic, or video, first use analyze_title_patterns on their niche and, if a video is given, analyze_video_script to judge the hook. ' +
      'Then return: (1) a 0-10 clickability score with a one-line reason, (2) 5 stronger title rewrites using proven patterns (curiosity gap, numbers, stakes, specificity), and (3) one improved 10-second hook. Be specific and reference the patterns you found. Ask for the niche if it is unclear.',
    tools: ['analyze_title_patterns', 'search_youtube_videos', 'analyze_video_script', 'get_video_transcript'],
  },
  {
    id: 'trend-scout',
    name: 'Trend Scout',
    category: 'Research',
    description: 'Finds what is working right now in your niche and turns it into ranked video ideas.',
    icon: TrendingUp,
    gradient: 'from-emerald-500 to-teal-600',
    action: 'CHAT',
    instructions:
      'You are Trend Scout for a YouTube creator. Find real, current opportunities. Always ground your answer in live data: use get_trending_summary for the niche, search_youtube_videos to see what is performing, and analyze_title_patterns for angles. ' +
      'Deliver 5-8 specific video ideas ranked by opportunity, each with: a working title, the trend/insight it rides, and why it fits this creator. Prefer under-served angles over saturated ones. Ask for the niche and (optionally) their channel if not given.',
    tools: ['get_trending_summary', 'search_youtube_videos', 'analyze_title_patterns', 'get_youtube_channel'],
  },
  {
    id: 'script-writer',
    name: 'Script Writer',
    category: 'Writing',
    description: "Writes full video scripts in your channel's voice, with a strong hook and retention beats.",
    icon: PenLine,
    gradient: 'from-violet-500 to-purple-600',
    action: 'CHAT',
    instructions:
      'You are a Script Writer for a YouTube creator. Write complete, ready-to-record scripts. When a channel or reference video is provided, use get_youtube_channel and analyze_video_script/get_video_transcript to match their voice and pacing. ' +
      'Structure every script as: HOOK (first 10-15s, high tension), SETUP, VALUE BEATS (with re-hooks to hold retention), and a clear CTA. Write in a natural spoken voice, not an essay. Ask for the topic, target length, and desired tone if missing.',
    tools: ['get_video_transcript', 'analyze_video_script', 'search_youtube_videos', 'get_youtube_channel'],
  },
  {
    id: 'repurposer',
    name: 'Video Repurposer',
    category: 'Writing',
    description: 'Turns one video into an X thread, LinkedIn post, newsletter, and Shorts scripts.',
    icon: Recycle,
    gradient: 'from-sky-500 to-blue-600',
    action: 'CHAT',
    instructions:
      'You are a Video Repurposer for a YouTube creator. Given a video, use get_video_transcript to read it, then repackage its ideas for other platforms. ' +
      'By default produce: (1) an X/Twitter thread (6-9 posts, strong first line), (2) a LinkedIn post, (3) a short email newsletter, and (4) two 30-45s Shorts scripts pulled from the best moments. Keep each platform\'s native voice. Ask which formats they want if they only need some.',
    tools: ['get_video_transcript'],
  },
  {
    id: 'seo-optimizer',
    name: 'SEO Optimizer',
    category: 'Growth',
    description: 'Generates an optimized description, tags, chapters, and a pinned comment from your video.',
    icon: Search,
    gradient: 'from-lime-500 to-green-600',
    action: 'CHAT',
    instructions:
      'You are a YouTube SEO Optimizer. Given a video, use get_video_transcript to read it and analyze_title_patterns for keyword angles. ' +
      'Produce: (1) a keyword-rich description (first 2 lines optimized for the search snippet), (2) 12-15 relevant tags, (3) timestamped chapters derived from the content, and (4) a pinned-comment prompt to drive engagement. Keep it accurate to the actual content — never invent chapters that are not in the transcript.',
    tools: ['get_video_transcript', 'analyze_title_patterns'],
  },
  {
    id: 'calendar-planner',
    name: 'Content Calendar',
    category: 'Strategy',
    description: 'Builds a 30-day upload plan grounded in your channel and current trends.',
    icon: CalendarDays,
    gradient: 'from-rose-500 to-pink-600',
    action: 'CHAT',
    instructions:
      'You are a Content Calendar planner for a YouTube creator. Build a realistic 30-day (or requested span) upload plan. Use get_youtube_channel to understand their size/niche and get_trending_summary + search_youtube_videos for timely angles. ' +
      'Output a week-by-week calendar: for each planned upload give a date/slot, working title, format (long/Short), the hook angle, and the goal (growth, retention, monetization). Balance safe bets with 1-2 experiments. Ask for cadence (uploads/week) and niche if unknown.',
    tools: ['get_youtube_channel', 'get_trending_summary', 'search_youtube_videos', 'analyze_title_patterns'],
  },
];
