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
  /**
   * Ground the result against what the agent actually saw. Models will invent a
   * plausible "outlier video" or confirm a chapter that isn't in the transcript;
   * asking them not to is not enough. `toolOutputs` are the raw tool results
   * from this run — anything claimed as evidence must appear there.
   */
  validate?: (parsed: any, toolOutputs: string[]) => any;
}

/** Case-insensitive haystack of everything the agent's tools returned. */
function haystack(toolOutputs: string[]): string {
  return toolOutputs.join('\n').toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A Winning Formula entry is rendered as `- [kind] "text" — …`. Only [video]
 * entries carry a channel and view count, so only they can be cited as evidence.
 * A model given a pasted hook will happily present it as a video with an
 * invented channel — this catches that.
 */
function citedANonVideoFormulaItem(hay: string, title: string): boolean {
  const probe = escapeRegex(title.slice(0, Math.min(40, title.length)));
  return new RegExp(`\\[(title|hook|description)\\]\\s*"${probe}`, 'i').test(hay);
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

export interface RepurposeResult {
  /** X/Twitter thread — one post per entry, first line must stand alone. */
  thread: string[];
  linkedin: string;
  newsletter: { subject: string; body: string };
  /** 30–45s vertical scripts pulled from the video's strongest moments. */
  shorts: { hook: string; script: string }[];
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
  repurposer: {
    key: 'repurposer',
    composingLabel: 'Repackaging for each platform…',
    instruction:
      'Now produce your final answer as STRICT JSON only, no prose outside it.\n' +
      'Shape: {"thread": ["string"], "linkedin": "string", "newsletter": {"subject": "string", "body": "string"}, ' +
      '"shorts": [{"hook": "string", "script": "string"}]}\n' +
      '`thread` is 6-9 X/Twitter posts — the first must stand alone as a hook, each under 280 characters, no numbering prefixes.\n' +
      '`linkedin` is one post in LinkedIn\'s native voice (a story or insight, short paragraphs, no hashtag spam).\n' +
      '`newsletter.body` is a short email in plain paragraphs.\n' +
      '`shorts` is exactly 2 vertical scripts of 30-45 seconds, each pulled from a real moment in the video — ' +
      '`hook` is the opening line, `script` is the spoken body.\n' +
      'Every item must be grounded in what the transcript actually said. Do not invent claims the video did not make.',
  },

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
    /**
     * Strip any "evidence" the agent didn't actually see:
     *  - a video title that never appeared in a tool result, or
     *  - a Winning Formula entry that isn't a [video] (a pasted title or hook
     *    dressed up as a video, complete with an invented channel).
     */
    validate(parsed, toolOutputs) {
      const hay = haystack(toolOutputs);
      parsed.ideas = (parsed.ideas ?? []).map((idea: any) => {
        if (!idea?.evidence) return idea;
        const title = String(idea.evidence.videoTitle ?? '').toLowerCase().trim();
        // Match on a prefix so minor truncation/quoting differences still count.
        const seen = title.length >= 8 && hay.includes(title.slice(0, Math.min(40, title.length)));
        const misattributed = seen && citedANonVideoFormulaItem(hay, title);
        if (!seen || misattributed) {
          const { evidence, ...rest } = idea;
          return rest;
        }
        return idea;
      });
      return parsed;
    },
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
    // Downgrade `verified` unless the label's own words show up in the transcript.
    validate(parsed, toolOutputs) {
      const hay = haystack(toolOutputs);
      if (!hay) return parsed;
      parsed.chapters = (parsed.chapters ?? []).map((c: any) => {
        const words = String(c?.label ?? '')
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 4);
        // A real chapter shares at least one substantive word with the transcript.
        const grounded = words.length > 0 && words.some((w) => hay.includes(w));
        return { ...c, verified: Boolean(c?.verified) && grounded };
      });
      return parsed;
    },
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
