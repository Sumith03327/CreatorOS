/**
 * @fileOverview System prompt + tool selection for "Script with Max", the
 * chat-first scriptwriting/analysis workspace. Runs through the same
 * tool-calling loop as custom agents (`runCustomAgentStream`), so this file
 * only owns Max's persona and which tools he's allowed to reach for.
 */

import type { MaxProject, MaxSourceItem } from '@/services/max-store';

export const MAX_INSTRUCTIONS = `You are Max, an expert YouTube scriptwriter and script analyst having a live chat with a creator.

You can do three things, all conversationally — infer which one the user wants from what they say, don't ask them to pick a "mode":

1. ANALYZE A VIDEO — when the user gives you a YouTube URL (or asks about "this video"), call get_video_transcript and/or analyze_video_script to read it for real before you comment. Cover: hook strength, structure/pacing, strongest and weakest moments, and 2-3 concrete rewrites. Never invent numbers or quotes you haven't actually read.
2. REVIEW A PASTED SCRIPT — when the user pastes their own draft, give direct, specific feedback: what the hook does and doesn't do, where energy sags, what to cut, what to punch up. Be a sharp, honest editor, not a cheerleader.
3. GENERATE A SCRIPT — when the user gives a topic (and ideally audience/tone/length), write a complete script with a strong hook, clear structure, and a natural CTA. Ask a quick clarifying question only if the brief is too thin to write anything useful.

You can also call search_youtube_videos, get_trending_summary, or analyze_title_patterns to ground ideas, hooks, or titles in what's actually working right now instead of generic advice — use them when it would materially improve the answer, not on every turn.

Write in plain, direct prose formatted with markdown (headings, bold, bullets) where it helps readability. When you produce a script, format it clearly with speaker/section labels so it's easy to lift straight into a teleprompter.`;

/** The subset of agent-tools.ts Max is allowed to call. */
export const MAX_TOOLS = [
  'get_video_transcript',
  'analyze_video_script',
  'search_youtube_videos',
  'get_trending_summary',
  'analyze_title_patterns',
];

const KIND_LABEL: Record<string, string> = {
  hookguide: 'Hook Guide',
  style: 'Style Guide',
  reference: 'Reference Material',
  tone: 'Tone Guide',
  other: 'Additional Notes',
};

/** Keep the injected context from swallowing the whole model context window. */
const MAX_CONTEXT_CHARS = 12000;

/**
 * Folds the attached projects' files into Max's system prompt as a labeled,
 * fenced context block — the same technique run-custom-agent-flow.ts uses
 * for durable memory and the Winning Formula.
 */
export function buildMaxInstructions(projects: MaxProject[]): string {
  if (!projects.length) return MAX_INSTRUCTIONS;

  const sections: string[] = [];
  let used = 0;
  outer: for (const project of projects) {
    for (const file of project.files) {
      const label = KIND_LABEL[file.kind] ?? file.kind;
      const heading = `--- ${project.name} / ${label} (${file.name}) ---`;
      const remaining = MAX_CONTEXT_CHARS - used;
      if (remaining <= 0) break outer;
      const body = file.content.length > remaining ? file.content.slice(0, remaining) + ' …[truncated]' : file.content;
      sections.push(`${heading}\n${body}`);
      used += heading.length + body.length;
    }
  }

  if (!sections.length) return MAX_INSTRUCTIONS;

  return (
    `${MAX_INSTRUCTIONS}\n\n` +
    `--- PROJECT CONTEXT (the creator's own style/tone/hook/reference material — follow it closely) ---\n` +
    sections.join('\n\n')
  );
}

// --- Research tab: a notebook-style research assistant ---------------------

export const RESEARCH_INSTRUCTIONS = `You are Max, helping a YouTube creator research a topic before they write anything.

The creator collects sources — links, videos, or their own notes — into a running list. Your job: answer their questions grounded in those sources plus your own live web knowledge, and help them synthesize scattered material into clear, usable findings (key facts, angles, contrasting takes, what's surprising). Cite which source a claim came from when it matters. If a source is just a URL with no fetched content, reason about it from the URL/context you're given and your own knowledge — don't pretend to have read a page you haven't seen.

You can also call search_youtube_videos, get_trending_summary, or analyze_title_patterns to ground findings in what's actually working right now. Keep answers tight and scannable — this is a research scratchpad, not a final draft.

When your answer draws on real, specific web sources (search results, cited pages, articles you know of), end it with a line containing exactly "## Sources" on its own, followed by one markdown link per source: "- [Short Source Title](https://example.com)". This list is parsed automatically into the creator's source collection, so only include real sources you actually referenced — never invent a URL — and skip this section entirely when you have nothing genuine to cite.`;

/** Perplexity's live web grounding makes it the natural default for research. Only used when the thread has no explicit model override. */
export const DEFAULT_RESEARCH_MODEL = 'perplexity/sonar-pro';

/** Research skews toward discovery/grounding tools; script-structure tools (analyze_video_script) belong to Write. */
export const RESEARCH_TOOLS = ['get_video_transcript', 'search_youtube_videos', 'get_trending_summary', 'analyze_title_patterns'];

const SOURCE_KIND_LABEL: Record<string, string> = {
  url: 'Link',
  video: 'Video',
  note: 'Note',
};

/**
 * Folds the Research tab's collected sources (and any attached projects) into
 * Max's system prompt — same fenced-context technique as buildMaxInstructions.
 */
export function buildResearchInstructions(sources: MaxSourceItem[], projects: MaxProject[]): string {
  const base = projects.length ? buildMaxInstructions(projects).replace(MAX_INSTRUCTIONS, RESEARCH_INSTRUCTIONS) : RESEARCH_INSTRUCTIONS;
  if (!sources.length) return base;

  const list = sources
    .map((s) => `- [${SOURCE_KIND_LABEL[s.kind] ?? s.kind}] ${s.label}: ${s.value}`)
    .join('\n');

  return `${base}\n\n--- COLLECTED SOURCES (${sources.length}) ---\n${list}`;
}

/** Matches a "## Sources" heading on its own line, case-insensitive. */
const SOURCES_HEADING = /^##\s*sources\s*$/im;

/**
 * Extracts the `[Title](url)` links Max listed under a trailing "## Sources"
 * heading. Returns [] if the heading is absent — a model that skips the
 * format simply contributes no auto-discovered sources for that answer.
 */
export function parseResearchSources(text: string): { label: string; url: string }[] {
  const match = SOURCES_HEADING.exec(text);
  if (!match) return [];
  const tail = text.slice(match.index);
  const links = [...tail.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)];
  return links.map((l) => ({ label: l[1].trim(), url: l[2].trim() }));
}

/**
 * Cuts the "## Sources" trailer (and everything after it) out of displayed
 * text. Safe to call on partial/streaming text too — if the heading hasn't
 * fully arrived yet this is a no-op, so the block only ever disappears once
 * complete rather than flashing raw markdown into the chat bubble.
 */
export function stripSourcesSection(text: string): string {
  const match = SOURCES_HEADING.exec(text);
  return match ? text.slice(0, match.index).trimEnd() : text;
}
