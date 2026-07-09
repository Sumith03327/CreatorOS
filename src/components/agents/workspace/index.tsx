'use client';

/**
 * Workspace registry. An agent with a dedicated interface opens here instead of
 * the generic chat view. Agents without one still fall back to chat, so the hub
 * degrades gracefully as we add workspaces.
 */

import type { BuiltinAgent } from '@/ai/agents/builtin-agents';
import { TitleDoctorWorkspace } from './TitleDoctorWorkspace';
import { TrendScoutWorkspace } from './TrendScoutWorkspace';
import { SeoOptimizerWorkspace } from './SeoOptimizerWorkspace';
import { SponsorshipWorkspace } from './SponsorshipWorkspace';

/** Agent ids that have a dedicated workspace. */
export const WORKSPACE_IDS = new Set<string>([
  'title-doctor',
  'trend-scout',
  'seo-optimizer',
  'sponsorship-manager',
]);

export function hasWorkspace(id: string): boolean {
  return WORKSPACE_IDS.has(id);
}

export function AgentWorkspaceRouter({ agent, onBack }: { agent: BuiltinAgent; onBack: () => void }) {
  switch (agent.id) {
    case 'title-doctor':
      return <TitleDoctorWorkspace agent={agent} onBack={onBack} />;
    case 'trend-scout':
      return <TrendScoutWorkspace agent={agent} onBack={onBack} />;
    case 'seo-optimizer':
      return <SeoOptimizerWorkspace agent={agent} onBack={onBack} />;
    case 'sponsorship-manager':
      return <SponsorshipWorkspace agent={agent} onBack={onBack} />;
    default:
      return null;
  }
}
