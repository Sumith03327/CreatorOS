'use server';
/**
 * @fileOverview Mesh API flows that turn a fetched set of trending videos into
 * research a creator can act on.
 *
 * These flows are deliberately *grounded*: every prompt carries the actual
 * videos we just pulled from YouTube. An earlier version passed only the niche
 * name and asked the model what was trending — which it answered from training
 * memory, describing a plausible-sounding past rather than this week.
 */

import { callMesh } from '@/services/mesh';
import { parseMeshJson } from '@/lib/mesh-json';

/** The evidence one video contributes to a prompt. */
export interface BriefVideo {
  title: string;
  views: number;
  /** How far this beat its own channel's normal performance. */
  outlierScore: number;
  ageDays: number;
  durationSeconds: number;
  subscriberCount: number;
  channelTitle?: string;
}

const SYSTEM_PROMPT =
  'You are a YouTube research analyst. You only make claims supported by the data you are given. Always return valid JSON only.';

/**
 * Renders the videos as a compact table. Outlier score comes first because it's
 * the column that should drive the model's conclusions — a 40x video from a tiny
 * channel is a stronger signal than a 2M-view video from a channel that always
 * gets 2M.
 */
function renderEvidence(videos: BriefVideo[]): string {
  const rows = videos.slice(0, 30).map(v => {
    const mins = Math.round(v.durationSeconds / 60);
    const length = v.durationSeconds <= 60 ? 'Short' : `${mins}m`;
    return [
      `${v.outlierScore.toFixed(1)}x`,
      `${Math.round(v.views).toLocaleString()} views`,
      `${Math.round(v.subscriberCount).toLocaleString()} subs`,
      `${v.ageDays}d old`,
      length,
      `"${v.title}"`,
    ].join(' | ');
  });

  return [
    'Columns: outlier multiple | views | channel subscribers | age | length | title',
    '(Outlier multiple = this video\'s views divided by that channel\'s typical views. Higher means the topic and packaging worked regardless of audience size.)',
    '',
    ...rows,
  ].join('\n');
}

// --- Trend summary ----------------------------------------------------------

export interface TrendSummaryInput {
  niche: string;
  videos: BriefVideo[];
}

export interface TrendSummaryOutput {
  bullets: string[];
}

export async function getTrendSummary(input: TrendSummaryInput): Promise<TrendSummaryOutput> {
  if (input.videos.length === 0) {
    return { bullets: ['No videos matched these filters, so there is nothing to read a trend from yet.'] };
  }

  const prompt = `Below are the top-performing YouTube videos in the "${input.niche}" niche right now, ranked by outlier multiple.

${renderEvidence(input.videos)}

Write exactly 3 bullets describing what is working in this niche RIGHT NOW. Rules:
- Every bullet must be grounded in the table above. Do not mention topics or formats that do not appear there.
- Name the specific topic, angle, or format — not generic advice like "post consistently".
- Prefer patterns that show up in the HIGH outlier rows, especially those from small channels, since those transfer to a creator without an audience.
- One sentence each, max 20 words. Written for a creator deciding what to make next.

Return JSON: { "bullets": ["string", "string", "string"] }`;

  const response = await callMesh(prompt, SYSTEM_PROMPT);
  return parseMeshJson<TrendSummaryOutput>(response);
}

// --- Title formulas ---------------------------------------------------------

/**
 * A reusable title skeleton with its slots left open, plus the evidence for it.
 * Prose insights ("use numbers in titles") are unusable; a fill-in-the-blank
 * template is something a creator can apply in ten seconds.
 */
export interface TitleFormula {
  /** e.g. "How I [result] in [timeframe] without [common pain]" */
  template: string;
  /** A real title from the data that follows this template. */
  example: string;
  /** Why it works, in one sentence. */
  why: string;
}

export interface TitleFormulasInput {
  niche: string;
  videos: BriefVideo[];
}

export interface TitleFormulasOutput {
  formulas: TitleFormula[];
}

export async function getTitleFormulas(input: TitleFormulasInput): Promise<TitleFormulasOutput> {
  if (input.videos.length < 3) return { formulas: [] };

  const prompt = `Here are the top-performing YouTube videos in the "${input.niche}" niche right now.

${renderEvidence(input.videos)}

Extract exactly 3 reusable TITLE TEMPLATES that the high-outlier titles share. Rules:
- A template is a fill-in-the-blank skeleton using [square bracket] slots, e.g. "How I [result] in [timeframe] without [common pain]".
- Each template must be derived from at least two titles above, and the "example" must be copied verbatim from the table.
- Weight the high outlier multiples most heavily.
- "why" is one sentence on the psychological mechanism (curiosity gap, specificity, stakes, contrarian claim, etc).

Return JSON: { "formulas": [{ "template": "string", "example": "string", "why": "string" }] }`;

  const response = await callMesh(prompt, SYSTEM_PROMPT);
  const parsed = parseMeshJson<TitleFormulasOutput>(response);
  return { formulas: (parsed.formulas || []).slice(0, 3) };
}

// --- Title scoring ----------------------------------------------------------

export interface ScoreTitleInput {
  niche: string;
  title: string;
  formulas: TitleFormula[];
  /** Titles of the current top outliers, for comparison. */
  winningTitles: string[];
}

export interface ScoreTitleOutput {
  /** 0–100, how well the draft matches what's currently winning. */
  score: number;
  verdict: string;
  /** Concrete rewrites, strongest first. */
  suggestions: string[];
}

/**
 * Scores a creator's draft title against the patterns actually winning in their
 * niche this week. Reading an insight and applying one are different acts; this
 * closes the gap.
 */
export async function scoreTitle(input: ScoreTitleInput): Promise<ScoreTitleOutput> {
  const formulaList = input.formulas.map(f => `- ${f.template} (e.g. "${f.example}")`).join('\n');
  const winners = input.winningTitles.slice(0, 12).map(t => `- ${t}`).join('\n');

  const prompt = `Niche: "${input.niche}"

Title templates currently winning:
${formulaList || '(none extracted)'}

Actual top-outlier titles right now:
${winners}

The creator's draft title:
"${input.title}"

Score the draft 0-100 on how well it matches what is winning in this niche right now. Be a harsh grader: an average title scores around 40. Then give a one-sentence verdict and exactly 3 rewritten titles, strongest first. Each rewrite must keep the creator's actual subject matter — do not change what the video is about.

Return JSON: { "score": number, "verdict": "string", "suggestions": ["string", "string", "string"] }`;

  const response = await callMesh(prompt, SYSTEM_PROMPT);
  const parsed = parseMeshJson<ScoreTitleOutput>(response);
  return {
    score: Math.max(0, Math.min(100, Math.round(parsed.score ?? 0))),
    verdict: parsed.verdict ?? '',
    suggestions: (parsed.suggestions || []).slice(0, 3),
  };
}
