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

export interface Connector {
  slug: string;
  name: string;
  /** Official brand logo, served by Composio's logo CDN. */
  logo: string;
}

/** Connectors we surface in the Connections UI (curated from Composio's 250+). */
export const CONNECTORS: Connector[] = [
  { slug: 'gmail', name: 'Gmail', logo: 'https://logos.composio.dev/api/gmail' },
  { slug: 'googlesheets', name: 'Google Sheets', logo: 'https://logos.composio.dev/api/googlesheets' },
  { slug: 'googledocs', name: 'Google Docs', logo: 'https://logos.composio.dev/api/googledocs' },
  { slug: 'notion', name: 'Notion', logo: 'https://logos.composio.dev/api/notion' },
  { slug: 'googlecalendar', name: 'Google Calendar', logo: 'https://logos.composio.dev/api/googlecalendar' },
  { slug: 'slack', name: 'Slack', logo: 'https://logos.composio.dev/api/slack' },
];

export function composioEnabled(): boolean {
  return !!process.env.COMPOSIO_API_KEY;
}

export interface ToolkitInfo {
  slug: string;
  name: string;
  logo: string;
  toolsCount?: number;
  /** True if Composio manages the OAuth for this app (so one-click connect works). */
  managedAuth: boolean;
}

/**
 * Search Composio's full catalog (1,000+ apps). Empty query returns the most
 * popular apps. Uses the REST endpoint directly for a compact, stable shape.
 */
export async function searchToolkits(query: string, limit = 24): Promise<ToolkitInfo[]> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return [];
  const url = new URL('https://backend.composio.dev/api/v3/toolkits');
  if (query.trim()) url.searchParams.set('search', query.trim());
  url.searchParams.set('limit', String(limit));
  try {
    const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.items ?? []).map((t: any) => ({
      slug: t.slug,
      name: t.name,
      logo: t.meta?.logo || `https://logos.composio.dev/api/${t.slug}`,
      toolsCount: t.meta?.tools_count,
      managedAuth: Array.isArray(t.composio_managed_auth_schemes) && t.composio_managed_auth_schemes.length > 0,
    }));
  } catch (e) {
    console.error('searchToolkits failed:', e);
    return [];
  }
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
