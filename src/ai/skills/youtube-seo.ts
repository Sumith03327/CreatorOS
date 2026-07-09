import type { Skill } from './types';

export const youtubeSeo: Skill = {
  name: 'youtube-seo',
  title: 'YouTube SEO',
  description: 'Descriptions, tags, chapters, and pinned comments that actually affect discovery.',
  whenToUse: 'When writing a video description, tags, timestamps/chapters, or optimising for search.',
  content: `# YouTube SEO

Modern YouTube ranks on **satisfaction signals** (CTR, retention, session time) far more than metadata.
Metadata's real job: help YouTube *classify* the video, and help humans *decide* to watch.

## Description

**First 2 lines (~150 chars) are the only ones most people see** — they appear in search results
and above "Show more". Treat them as ad copy that restates the title's promise in plain language,
with the primary keyword used naturally.

Then:
- **Paragraph 1 (2–3 sentences)**: what the video covers and who it's for. Primary keyword + 1–2 variants.
- **Chapters** (see below).
- **Resources / links** mentioned in the video.
- **Boilerplate last**: socials, gear, subscribe. Never first.

Rules:
- Write for a human. Keyword stuffing is a ranking negative and reads like spam.
- Use the exact phrases a viewer would type, not internal jargon.
- 200–350 words is plenty. Length itself is not a ranking factor.

## Chapters (timestamps)
- Must start at **00:00**, be in ascending order, and have **at least 3** entries.
- Minimum **10 seconds** apart.
- **Derive them from the actual transcript.** Never invent a chapter that isn't in the video —
  it breaks trust and inflates drop-off at the fake chapter.
- Label with value, not structure: "Fixing the audio hiss" > "Part 2".

## Tags
- Low impact, but non-zero for disambiguation (e.g. distinguishing "Python" the language from the snake).
- 10–15 tags. Order: exact title phrase → primary keyword → close variants → topic → channel name.
- No competitor names, no irrelevant trending terms — that's a policy risk with no upside.

## Titles & keywords
- One primary keyword. Place it early, phrased how humans search.
- Don't sacrifice clickability for an exact-match keyword. CTR beats keyword placement.

## Pinned comment
The most under-used surface. Use it to:
- Ask **one** specific question that's easy to answer (drives comment volume → session signals).
- Correct an error, or add the resource everyone asks for.
- Never just say "Subscribe!" — it earns nothing.

Good: "What's the one thing you'd have done differently here? I'd redo the lighting first."

## Thumbnail + title + hook coherence
The single largest discovery lever is **coherence**: title, thumbnail, and first 15 seconds
must promise the same thing. Mismatch → click → immediate exit → the video stops being shown.

## What does NOT work
- Keyword-stuffed descriptions and tag walls.
- Hashtag spam (>3 is ignored; the first 3 render above the title).
- Re-uploading for "a fresh algorithm chance".
- Copying a big channel's tags. Their ranking comes from their audience, not their metadata.
`,
};
