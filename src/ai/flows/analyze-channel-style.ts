'use server';
/**
 * @fileOverview Analyzes a YouTube channel's own thumbnails with a vision model
 * to produce a compact "style profile" the Thumbnail Studio can match.
 */

import { callMeshVision } from '@/services/mesh';
import { fetchYouTubeChannelData, fetchRecentVideos } from '@/services/youtube';

export interface ChannelStyleResult {
  channelTitle: string;
  styleProfile: string;
  sampleThumbnails: string[];
  isFaceDriven: boolean;
  creatorDescription: string;
}

const SYSTEM =
  "You are a senior YouTube thumbnail art director. You will be shown a single channel's real thumbnails. " +
  'Identify the channel\'s consistent visual SIGNATURE so another designer could reproduce it, and whether a recurring on-camera person (the creator) appears. ' +
  'Reply in STRICT JSON only: {"styleProfile": string, "isFaceDriven": boolean, "creatorDescription": string}. ' +
  '- styleProfile: ~4-6 short lines covering palette, text/typography, face usage, composition, mood (a reusable brief). ' +
  '- isFaceDriven: true if the SAME person appears across most thumbnails. ' +
  '- creatorDescription: if face-driven, a short physical description of that person (age range, gender presentation, hair, facial hair, notable features) to help reproduce their likeness; else empty string.';

export async function analyzeChannelStyle(channelUrl: string): Promise<ChannelStyleResult> {
  const channel = await fetchYouTubeChannelData(channelUrl);
  if (!channel) throw new Error('Could not find that channel. Check the URL or @handle.');

  let thumbnails: string[] = [];
  if (channel.uploadsPlaylistId) {
    const videos = await fetchRecentVideos(channel.uploadsPlaylistId, 8);
    thumbnails = videos.map((v) => v.thumbnail).filter(Boolean).slice(0, 6);
  }

  if (thumbnails.length === 0) {
    return {
      channelTitle: channel.title,
      styleProfile:
        'No recent thumbnails were available to analyze. Use a bold, high-contrast, high-CTR YouTube style.',
      sampleThumbnails: [],
      isFaceDriven: false,
      creatorDescription: '',
    };
  }

  const instruction =
    `These are recent thumbnails from the channel "${channel.title}". Analyze them and reply in the JSON format specified.`;

  let styleProfile = 'Bold, high-contrast, high-CTR YouTube thumbnail style with expressive subject and punchy text.';
  let isFaceDriven = false;
  let creatorDescription = '';
  try {
    const raw = (await callMeshVision(instruction, thumbnails, SYSTEM)).trim();
    // Vision models may wrap JSON in prose or code fences — extract the object.
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    if (parsed.styleProfile) styleProfile = String(parsed.styleProfile).trim();
    isFaceDriven = Boolean(parsed.isFaceDriven);
    creatorDescription = String(parsed.creatorDescription || '').trim();
  } catch (e) {
    console.error('Vision style analysis failed / unparseable:', e);
  }

  return { channelTitle: channel.title, styleProfile, sampleThumbnails: thumbnails, isFaceDriven, creatorDescription };
}
