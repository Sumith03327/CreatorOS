'use server';
/**
 * @fileOverview Runs a user-built custom agent (Build Your Own Agent) through the Mesh API,
 * optionally enriching the conversation with live YouTube context.
 */

import { callMeshChat, type MeshMessage } from '@/services/mesh';
import { fetchYouTubeChannelData, fetchVideoDetails } from '@/services/youtube';

export interface RunCustomAgentInput {
  instructions: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  youtubeUrl?: string;
}

function extractVideoId(url: string): string | null {
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  return null;
}

async function buildYouTubeContext(url: string): Promise<string | null> {
  try {
    const videoId = extractVideoId(url);
    if (videoId) {
      const video = await fetchVideoDetails(videoId);
      if (!video) return null;
      return `Video Title: ${video.title}\nChannel: ${video.channelTitle || 'Unknown'}\nViews: ${video.viewCount || 'N/A'}\nPublished: ${video.publishedAt}`;
    }

    const channel = await fetchYouTubeChannelData(url);
    if (!channel) return null;
    return `Channel: ${channel.title}\nDescription: ${channel.description}\nSubscribers: ${channel.statistics.subscriberCount}\nTotal Views: ${channel.statistics.viewCount}\nVideos: ${channel.statistics.videoCount}`;
  } catch (e) {
    console.error('YouTube context lookup failed:', e);
    return null;
  }
}

export async function runCustomAgent(input: RunCustomAgentInput): Promise<string> {
  let userContent = input.userMessage;

  if (input.youtubeUrl?.trim()) {
    const context = await buildYouTubeContext(input.youtubeUrl.trim());
    if (context) {
      userContent = `[YouTube Context]\n${context}\n\n[User Message]\n${input.userMessage}`;
    }
  }

  const messages: MeshMessage[] = [
    { role: 'system', content: input.instructions },
    ...input.history.map((h) => ({ role: h.role, content: h.content } as MeshMessage)),
    { role: 'user', content: userContent },
  ];

  return callMeshChat(messages);
}
