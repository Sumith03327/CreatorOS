/**
 * @fileOverview Skill registry + progressive-disclosure helpers.
 *
 * Agents declare the skills they may reach. Only `buildSkillIndex()` (a few
 * lines per skill) is injected into the system prompt; the full playbook is
 * fetched by the `load_skill` tool when the agent decides it's relevant.
 */

import type { Skill } from './types';
import { hookWriting } from './hook-writing';
import { ctrTitlePatterns } from './ctr-title-patterns';
import { retentionStructure } from './retention-structure';
import { youtubeSeo } from './youtube-seo';
import { repurposingPlaybook } from './repurposing-playbook';
import { channelStrategy } from './channel-strategy';
import { sponsorshipNegotiation } from './sponsorship-negotiation';
import { opportunityScoring } from './opportunity-scoring';
import { analyticsInterpretation } from './analytics-interpretation';

export type { Skill };

const ALL: Skill[] = [
  hookWriting,
  ctrTitlePatterns,
  retentionStructure,
  youtubeSeo,
  repurposingPlaybook,
  channelStrategy,
  sponsorshipNegotiation,
  opportunityScoring,
  analyticsInterpretation,
];

export const SKILLS: Record<string, Skill> = Object.fromEntries(ALL.map((s) => [s.name, s]));

export const ALL_SKILL_NAMES = ALL.map((s) => s.name);

/** Resolve an agent's declared skills, silently dropping unknown names. */
export function resolveSkills(names?: string[]): Skill[] {
  if (!names?.length) return [];
  return names.map((n) => SKILLS[n]).filter(Boolean);
}

export function getSkill(name: string): Skill | null {
  return SKILLS[name] ?? null;
}

/**
 * The compact index injected into the system prompt. Deliberately small: the
 * agent sees WHAT exists and WHEN to reach for it — not the content.
 */
export function buildSkillIndex(skills: Skill[]): string {
  if (!skills.length) return '';
  const lines = skills
    .map((s) => `- ${s.name} — ${s.description} Use when: ${s.whenToUse}`)
    .join('\n');
  return (
    `\n\n--- YOUR SKILLS ---\n` +
    `You have expert playbooks available. They are NOT loaded yet — only their summaries are:\n` +
    `${lines}\n` +
    `Before doing substantive work that a skill covers, call the \`load_skill\` tool with its name to read the full playbook, ` +
    `then follow it closely. Load a skill at most once. Do not guess at a playbook's contents — load it.`
  );
}
