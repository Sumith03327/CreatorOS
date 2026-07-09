/**
 * @fileOverview Agent Skills — expert playbooks loaded on demand.
 *
 * Progressive disclosure (the Claude-skills model):
 *   1. Only the skill INDEX (title + description + whenToUse) is injected into
 *      an agent's system prompt. Cheap, and it fits in any context window.
 *   2. When a skill is actually relevant, the agent calls the `load_skill` tool
 *      to pull the FULL playbook into context.
 *
 * This keeps prompts lean while letting agents reason from real domain
 * expertise instead of vibes.
 */

export interface Skill {
  /** Stable slug, used as the `load_skill` argument. */
  name: string;
  /** Human title, shown in the "Loading skill…" status chip. */
  title: string;
  /** One line: what this skill contains. Goes in the index. */
  description: string;
  /** One line: when the agent should load it. Goes in the index. */
  whenToUse: string;
  /** The full playbook (markdown). Only sent when loaded. */
  content: string;
}
