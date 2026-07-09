'use server';

/**
 * Server actions bridging the client Agent Hub to the Composio connector
 * service. Kept thin: the real logic lives in `src/services/composio.ts`.
 */

import {
  CONNECTORS,
  composioEnabled,
  initiateConnection,
  listConnections,
  searchToolkits,
  type ConnectionStatus,
  type Connector,
  type ToolkitInfo,
} from '@/services/composio';

/** Search Composio's full catalog (1,000+ apps). */
export async function searchApps(query: string): Promise<ToolkitInfo[]> {
  return searchToolkits(query);
}

export async function getConnectorCatalog(): Promise<{
  enabled: boolean;
  connectors: Connector[];
}> {
  return { enabled: composioEnabled(), connectors: CONNECTORS };
}

export async function getConnections(): Promise<ConnectionStatus[]> {
  return listConnections();
}

/** Begin OAuth for an app; returns a redirect URL the user opens to authorize. */
export async function connectApp(slug: string): Promise<{ redirectUrl: string; id: string }> {
  return initiateConnection(slug);
}
