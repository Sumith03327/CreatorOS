/**
 * @fileOverview Structured deliverables — the contract between an agent and its
 * dedicated interface.
 *
 * A score dial cannot render a paragraph. So instead of streaming prose, an
 * agent in "workspace" mode runs its normal tool + skill loop, then composes a
 * final JSON object matching one of these schemas. The UI renders the typed
 * result; the chat drawer stays available for follow-up refinement.
 *
 * Each spec carries the JSON instruction sent as the final turn. Keep the
 * instructions explicit — models honour concrete shapes far better than prose.
 */

export interface DeliverableSpec {
  key: string;
  /** Shown in the UI while the JSON is being composed. */
  composingLabel: string;
  /** The final instruction appended to the conversation. */
  instruction: string;
}

// --- Typed results (mirrored by the UI renderers) --------------------------

export type Lever = 'curiosity' | 'stakes' | 'specificity' | 'clarity' | 'deliverability';

export interface TitleDoctorResult {
  score: number; // 0–10
  levers: Record<Lever, number>; // each 0–2
  verdict: string;
  rewrites: { title: string; levers: string[] }[];
  hook?: { line: string; why: string };
}

export interface TrendScoutResult {
  ideas: {
    title: string;
    score: number; // 0–10 opportunity
    signal: string;
    evidence?: { videoTitle: string; channel: string; views: number; subscribers: number };
    saturation: 'low' | 'medium' | 'high';
    effort: 'low' | 'medium' | 'high';
    why: string;
  }[];
}

export interface SeoResult {
  description: string;
  tags: string[];
  chapters: { time: string; label: string; verified: boolean }[];
  pinnedComment: string;
}

export interface SponsorshipResult {
  deals: {
    brand: string;
    from?: string;
    offer?: string;
    deliverable?: string;
    deadline?: string;
    summary: string;
    /** Scope terms the brand did NOT specify (from the sponsorship skill). */
    missing: string[];
  }[];
  rate?: { medianViews: number; cpm: number; low: number; high: number; basis: string };
}

// --- Specs ----------------------------------------------------------------

export const DELIVERABLES: Record<string, DeliverableSpec> = {
  'title-doctor': {
    key: 'title-doctor',
    composingLabel: 'Scoring the title…',
    instruction:
      'Now produce your final answer as STRICT JSON only, no prose outside it.\n' +
      'Use the ctr-title-patterns rubric: score each lever 0-2 (curiosity, stakes, specificity, clarity, deliverability); ' +
      'the overall `score` is their sum (0-10).\n' +
      'Shape: {"score": number, "levers": {"curiosity": number, "stakes": number, "specificity": number, "clarity": number, "deliverability": number}, ' +
      '"verdict": "one sentence", "rewrites": [{"title": "string", "levers": ["curiosity","specificity"]}], "hook": {"line": "string", "why": "string"}}\n' +
      'Give exactly 5 rewrites, strongest first. Each rewrite must keep the creator\'s actual subject matter. ' +
      '`hook` is an improved 10-second opening line for the video.',
  },

  'trend-scout': {
    key: 'trend-scout',
    composingLabel: 'Ranking opportunities…',
    instruction:
      'Now produce your final answer as STRICT JSON only, no prose outside it.\n' +
      'Shape: {"ideas": [{"title": "string", "score": number, "signal": "string", ' +
      '"evidence": {"videoTitle": "string", "channel": "string", "views": number, "subscribers": number}, ' +
      '"saturation": "low"|"medium"|"high", "effort": "low"|"medium"|"high", "why": "string"}]}\n' +
      'Give 5-6 ideas ranked by opportunity (`score` 0-10, one decimal allowed). ' +
      '`signal` names the evidence (an outlier, a gap, a trend). ' +
      '`evidence` MUST come from a real video you actually saw via your tools — if you have no real video, omit `evidence` entirely rather than inventing one. ' +
      '`why` is one sentence on why it fits this creator.',
  },

  'seo-optimizer': {
    key: 'seo-optimizer',
    composingLabel: 'Building your upload package…',
    instruction:
      'Now produce your final answer as STRICT JSON only, no prose outside it.\n' +
      'Shape: {"description": "string", "tags": ["string"], "chapters": [{"time": "MM:SS", "label": "string", "verified": boolean}], "pinnedComment": "string"}\n' +
      'The description\'s first two lines must work as a search snippet. Give 12-15 tags. ' +
      'Chapters must start at 00:00, ascend, and be at least 10 seconds apart. ' +
      'Set `verified` to true ONLY for a chapter whose topic you actually found in the transcript; ' +
      'set it to false if you inferred or guessed it. Never invent a chapter and mark it verified.',
  },

  'sponsorship-manager': {
    key: 'sponsorship-manager',
    composingLabel: 'Triaging your deals…',
    instruction:
      'Now produce your final answer as STRICT JSON only, no prose outside it.\n' +
      'Shape: {"deals": [{"brand": "string", "from": "string", "offer": "string", "deliverable": "string", "deadline": "string", ' +
      '"summary": "string", "missing": ["string"]}], "rate": {"medianViews": number, "cpm": number, "low": number, "high": number, "basis": "string"}}\n' +
      'Use the sponsorship-negotiation skill. `missing` lists which required scope terms the brand did NOT specify, ' +
      'drawn from: deliverable, usage rights, exclusivity, timeline, payment terms. ' +
      'Only include `rate` if you know the creator\'s median views; otherwise omit it. ' +
      'If there are no sponsorship emails, return {"deals": []}.',
  },
};

export function getDeliverable(key?: string): DeliverableSpec | null {
  if (!key) return null;
  return DELIVERABLES[key] ?? null;
}
