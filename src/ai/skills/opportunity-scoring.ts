import type { Skill } from './types';

export const opportunityScoring: Skill = {
  name: 'opportunity-scoring',
  title: 'Opportunity Scoring',
  description: 'How to judge whether a trend or idea is a real opening for THIS channel, or a trap.',
  whenToUse: 'When ranking video ideas, evaluating a trend, or finding gaps in a niche.',
  content: `# Opportunity Scoring

Most "trending" topics are traps: high volume, high competition, no edge.
A real opportunity is **demand the incumbents aren't serving well**.

## The outlier signal
The strongest signal is a video with **views far above its channel's subscriber count**
(e.g. a 20k-sub channel with a 900k-view video). That gap means the *topic and format* carried
it — not the audience. That's a repeatable opening.

Ignore raw view counts on huge channels: MrBeast gets 20M views on anything. That's audience, not signal.

## Score an idea 1–5 on each

1. **Demand** — is anyone actually searching for / watching this? (search results, outliers, comments)
2. **Under-served** — are the existing videos mediocre, outdated, or missing an angle?
3. **Edge** — can this creator say something others genuinely can't? (experience, access, data, taste)
4. **Format fit** — does it fit a shape this channel already executes well?
5. **Effort** — realistically producible at quality? (invert: low effort scores high)

**Opportunity = (Demand × Under-served × Edge) / Effort**

Kill anything scoring ≤2 on **Edge**. Without an edge you're competing on production budget, and you'll lose.

## Finding gaps
- Search the niche; read the **top comments** on the best videos. Unanswered questions are gaps.
- Look for topics where every result is >2 years old.
- Look for topics where the top results are *thin* (listicles, no first-hand experience).
- Look for the question people ask *after* watching the popular video. That's your video.

## Saturation test
If the top 5 results are all from large channels with the same angle, the topic is saturated **for that angle**.
It may still be wide open for:
- A different **audience** ("…for beginners", "…for Indian students")
- A different **format** (teardown vs tutorial, experiment vs explainer)
- A different **stance** (the contrarian read)

## Timing
- **Riding a trend**: only if you can ship within days and have an edge. Otherwise you arrive last.
- **Evergreen**: compounds. Prefer it unless the trend is squarely in your pillar.
- A trend you can't ship fast **and** have no edge on is the worst use of a week.

## Presenting ideas
For each recommendation give:
- The **working title**
- The **signal** it rides (name the outlier, gap, or trend — with the evidence you found)
- **Why this creator** (the edge)
- The **format** and rough effort

Never present an idea without naming its signal. An idea with no evidence is a guess.
`,
};
