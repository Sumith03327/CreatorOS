'use server';
/**
 * @fileOverview Takes the raw links pulled from a channel's About page + description
 * and returns a clean, de-duplicated, strategically ordered set of social / external
 * handles. The model classifies each provided URL, never invents new ones, and only
 * repairs an obviously-truncated handle by matching it to the channel's known handle.
 */

import { z } from 'zod';
import { callMesh } from '@/services/mesh';
import { parseMeshJson } from '@/lib/mesh-json';

const OrganizeSocialsInputSchema = z.object({
  channelTitle: z.string(),
  channelHandle: z.string().optional(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
});
export type OrganizeSocialsInput = z.infer<typeof OrganizeSocialsInputSchema>;

const SocialItemSchema = z.object({
  platform: z.string().describe("Lowercase platform id: instagram, x, tiktok, facebook, youtube, twitch, linkedin, discord, telegram, threads, snapchat, website, store, newsletter, other."),
  label: z.string().describe("Short display text: the @handle for socials, or a concise name for a website/store."),
  url: z.string().describe("The full destination URL, taken verbatim from the input."),
  category: z.enum(['social', 'business', 'website', 'other']).describe("social = personal social profile; business = store/course/app/sponsor; website = homepage/link-hub; other = anything else."),
});

const OrganizeSocialsOutputSchema = z.object({
  socials: z.array(SocialItemSchema),
});
export type OrganizeSocialsOutput = z.infer<typeof OrganizeSocialsOutputSchema>;

export async function organizeChannelSocials(input: OrganizeSocialsInput): Promise<OrganizeSocialsOutput> {
  if (!input.links || input.links.length === 0) return { socials: [] };

  const systemPrompt = "You are a data-cleaning assistant that organizes a YouTube channel's external links. Always return valid JSON only. Never fabricate URLs.";

  const linkList = input.links.map((l, i) => `${i + 1}. label="${l.label || '(none)'}" url="${l.url}"`).join('\n');

  const promptStr = `Organize the external links for the channel "${input.channelTitle}"${input.channelHandle ? ` (handle: ${input.channelHandle})` : ''}.

Raw links found (from the About "Links" section and the channel description):
${linkList}

Rules:
- Use ONLY the URLs provided above. Never invent a URL.
- Classify each into a platform and category.
- For social profiles, set "label" to the @handle (derive it from the URL path).
- If a social URL's handle looks TRUNCATED (cut short), you may complete it ONLY if the channel handle "${input.channelHandle || input.channelTitle}" makes the full handle unambiguous; otherwise keep it as-is.
- Drop pure tracking/duplicate entries; keep one entry per distinct destination.
- Order strategically: personal social profiles first (Instagram, X, TikTok, etc.), then business/store/app links, then website/link-hub, then other.

Return JSON:
{
  "socials": [
    { "platform": "instagram", "label": "@handle", "url": "https://...", "category": "social" }
  ]
}`;

  const response = await callMesh(promptStr, systemPrompt);
  return parseMeshJson<OrganizeSocialsOutput>(response);
}
