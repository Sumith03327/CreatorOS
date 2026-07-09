'use client';

/**
 * Workspace registry. An agent with a dedicated interface opens here instead of
 * the generic chat view. Agents without one still fall back to chat, so the hub
 * degrades gracefully as we add workspaces.
 */

import type { BuiltinAgent } from '@/ai/agents/builtin-agents';
import { TitleDoctorWorkspace } from './TitleDoctorWorkspace';

/** Agent ids that have a dedicated workspace. */
export const WORKSPACE_IDS = new Set<string>(['title-doctor']);

export function hasWorkspace(id: string): boolean {
  return WORKSPACE_IDS.has(id);
}

export function AgentWorkspaceRouter({ agent, onBack }: { agent: BuiltinAgent; onBack: () => void }) {
  switch (agent.id) {
    case 'title-doctor':
      return <TitleDoctorWorkspace agent={agent} onBack={onBack} />;
    default:
      return null;
  }
}
