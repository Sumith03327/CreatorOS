/**
 * @fileOverview Composio connector service — the "act on real work" layer.
 * Server-only: imported only by the agent flow and 'use server' actions.
 *
 * Composio is a managed-connector gateway (250+ apps: Gmail, Sheets, Notion…).
 * It hands back tools already in OpenAI function-calling shape, so they drop
 * straight into our Mesh tool-calling loop (`MeshToolSchema`), and executes the
 * real action against the user's connected account.
 *
 * Single-user app: every connection/execution is scoped to one entity id.
 * (When real auth lands, swap COMPOSIO_USER_ID for the signed-in uid.)
 *
 * Server-only (wraps the Node SDK + the API key). Consumed by the agent flow
 * and by the 'use server' connection actions.
 */

import { Composio } from '@composio/core';
import type { MeshToolSchema } from '@/services/mesh';

const COMPOSIO_USER_ID = 'creator-hub-user';

/** Connectors we surface in the Connections UI (curated from Composio's 250+). */
export const CONNECTORS: { slug: string; name: string }[] = [
  { slug: 'gmail', name: 'Gmail' },
  { slug: 'googlesheets', name: 'Google Sheets' },
  { slug: 'googledocs', name: 'Google Docs' },
  { slug: 'notion', name: 'Notion' },
  { slug: 'googlecalendar', name: 'Google Calendar' },
  { slug: 'slack', name: 'Slack' },
];

export function composioEnabled(): boolean {
  return !!process.env.COMPOSIO_API_KEY;
}

let _client: Composio | null = null;
function client(): Composio {
  if (!_client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) throw new Error('COMPOSIO_API_KEY is missing');
    _client = new Composio({ apiKey });
  }
  return _client;
}

/**
 * Find (or create) a Composio-managed OAuth auth config for a toolkit. We reuse
 * an existing managed config when present so we don't spawn duplicates.
 */
async function getAuthConfigId(slug: string): Promise<string> {
  const c = client();
  const list: any = await c.authConfigs.list();
  const items: any[] = list.items ?? list ?? [];
  const existing = items.find(
    (a) => (a.toolkit?.slug ?? a.toolkit) === slug && (a.isComposioManaged ?? a.is_composio_managed)
  );
  if (existing) return existing.id;
  const created: any = await c.authConfigs.create(slug, { type: 'use_composio_managed_auth' });
  return created.id;
}

/**
 * Begin connecting an app: returns an OAuth redirect URL the user opens to
 * authorize. Once they approve, the connection becomes ACTIVE for this user.
 */
export async function initiateConnection(slug: string): Promise<{ redirectUrl: string; id: string }> {
  const authConfigId = await getAuthConfigId(slug);
  const conn: any = await client().connectedAccounts.link(COMPOSIO_USER_ID, authConfigId);
  return { redirectUrl: conn.redirectUrl, id: conn.id };
}

export interface ConnectionStatus {
  slug: string;
  status: string; // ACTIVE | INITIATED | FAILED | …
}

/** List this user's connected accounts (which apps are live). */
export async function listConnections(): Promise<ConnectionStatus[]> {
  if (!composioEnabled()) return [];
  const list: any = await client().connectedAccounts.list({ userIds: [COMPOSIO_USER_ID] });
  const items: any[] = list.items ?? [];
  return items.map((a) => ({ slug: a.toolkit?.slug ?? a.toolkit ?? 'unknown', status: a.status }));
}

/**
 * Fetch Composio tools for the given toolkits as Mesh tool schemas. Capped so a
 * broad toolkit (Gmail has 60+ actions) doesn't flood the model's tool list.
 */
export async function getComposioTools(slugs: string[]): Promise<MeshToolSchema[]> {
  if (!slugs.length || !composioEnabled()) return [];
  try {
    const tools: any = await client().tools.get(COMPOSIO_USER_ID, { toolkits: slugs, limit: 25 });
    return (Array.isArray(tools) ? tools : []) as MeshToolSchema[];
  } catch (e) {
    console.error('getComposioTools failed:', e);
    return [];
  }
}

/**
 * Execute a Composio action by tool name. Always resolves to a readable string
 * (never throws) so the agent loop survives failures — e.g. an app that the
 * user hasn't connected yet reports back as a tool failure the model can relay.
 */
// Composio's "latest" toolkit-version alias; manual execution requires a version.
const LATEST_VERSION = '00000000_00';

export async function executeComposioTool(name: string, args: Record<string, any>): Promise<string> {
  try {
    const res: any = await client().tools.execute(name, {
      userId: COMPOSIO_USER_ID,
      arguments: args,
      version: LATEST_VERSION,
    });
    if (res && res.successful === false) {
      return `tool failed: ${res.error || 'the connected app rejected the request.'} Do not retry; tell the user to check the connection in Connections.`;
    }
    const data = res?.data ?? res;
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return str.length > 4000 ? str.slice(0, 4000) + ' …[truncated]' : str;
  } catch (e: any) {
    // Most common cause: the app isn't connected for this user yet.
    return `tool failed: ${e?.message || 'Composio execution error'}. The app may not be connected — tell the user to connect it in Connections. Do not retry.`;
  }
}
