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
import { RepurposerWorkspace } from './RepurposerWorkspace';
import { CalendarWorkspace } from './CalendarWorkspace';

/** Agent ids that have a dedicated workspace. */
export const WORKSPACE_IDS = new Set<string>([
  'title-doctor',
  'trend-scout',
  'seo-optimizer',
  'sponsorship-manager',
  'repurposer',
  'calendar-planner',
]);

export function hasWorkspace(id: string): boolean {
  return WORKSPACE_IDS.has(id);
}

export function AgentWorkspaceRouter({
  agent,
  onBack,
  initialTitle,
}: {
  agent: BuiltinAgent;
  onBack: () => void;
  /** Seed text from a deep link, e.g. a content idea sent from the Action Plan. */
  initialTitle?: string;
}) {
  switch (agent.id) {
    case 'title-doctor':
      return <TitleDoctorWorkspace agent={agent} onBack={onBack} initialTitle={initialTitle} />;
    case 'trend-scout':
      return <TrendScoutWorkspace agent={agent} onBack={onBack} />;
    case 'seo-optimizer':
      return <SeoOptimizerWorkspace agent={agent} onBack={onBack} />;
    case 'sponsorship-manager':
      return <SponsorshipWorkspace agent={agent} onBack={onBack} />;
    case 'repurposer':
      return <RepurposerWorkspace agent={agent} onBack={onBack} />;
    case 'calendar-planner':
      return <CalendarWorkspace agent={agent} onBack={onBack} />;
    default:
      return null;
  }
}
