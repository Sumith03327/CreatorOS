'use client';

/**
 * @fileOverview Unified persistence layer for the Agents feature.
 *
 * This is the SINGLE source of truth for agents, their chat threads, their
 * durable memory, and generated thumbnails. Today it is backed by
 * `localStorage`, but every function is async and goes through a small
 * `StorageBackend` interface — that indirection is the deliberate SEAM so a
 * real backend (Firestore + Storage, once auth is wired) can be dropped in by
 * implementing one object, with no changes to callers.
 *
 * It also migrates the older, scattered raw-localStorage keys
 * (`creator-hub-agents`, `creator-hub-agent-chat-*`, `creator-hub-thumbnails`)
 * into this namespaced schema on first load, so existing users keep their data.
 */

// --- Schema / namespacing ------------------------------------------------

const NS = 'creator-hub';
const SCHEMA = 'v2';
const key = (...parts: string[]) => [NS, SCHEMA, ...parts].join(':');

const AGENTS_KEY = key('agents');
const THUMBS_KEY = key('thumbnails');
const threadKey = (agentId: string) => key('thread', agentId);
const memoryKey = (agentId: string) => key('memory', agentId);
const MIGRATED_FLAG = key('migrated');

// Legacy keys (pre-v2) we migrate from once.
const LEGACY_AGENTS = 'creator-hub-agents';
const LEGACY_CHAT = (id: string) => `creator-hub-agent-chat-${id}`;
const LEGACY_THUMBS = 'creator-hub-thumbnails';

// --- Types ---------------------------------------------------------------

export interface CustomAgent {
  id: string;
  name: string;
  category: string;
  description: string;
  instructions: string;
  useYouTubeContext: boolean;
  /** Optional model override; defaults to the cheap deepseek-v3 in the service. */
  model?: string;
  /** Per-agent toolset (tool names from the agent-tools registry). Empty = all. */
  tools?: string[];
  /** Composio connector toolkits this agent can act through (e.g. ['gmail']). */
  connectors?: string[];
  /** Expert skill playbooks this agent can load on demand. */
  skills?: string[];
  /** Durable, distilled facts this agent has learned about the user, injected
   *  into its system prompt so it "remembers" across separate conversations. */
  memory?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SavedThumbnail {
  id: string;
  src: string;
  title: string;
  channelTitle?: string;
  createdAt: string;
}

// --- Storage backend (the swap point) ------------------------------------

interface StorageBackend {
  read<T>(k: string): Promise<T | null>;
  write<T>(k: string, value: T): Promise<void>;
  remove(k: string): Promise<void>;
}

/** Default backend: browser localStorage, JSON-encoded. SSR-safe (no-ops on server). */
const localBackend: StorageBackend = {
  async read<T>(k: string): Promise<T | null> {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async write<T>(k: string, value: T): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(k, JSON.stringify(value));
    } catch (e) {
      // Quota or serialization failure — surface in console, never throw at callers.
      console.error('agent-store write failed:', k, e);
    }
  },
  async remove(k: string): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

// To move to a real backend later, implement this same interface (e.g. a
// FirestoreBackend keyed by the signed-in uid) and assign it here.
const backend: StorageBackend = localBackend;

// --- One-time migration from legacy keys ---------------------------------

async function migrateLegacyOnce(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (await backend.read<boolean>(MIGRATED_FLAG)) return;

  try {
    // Agents
    const legacyAgentsRaw = window.localStorage.getItem(LEGACY_AGENTS);
    if (legacyAgentsRaw && !(await backend.read(AGENTS_KEY))) {
      const legacyAgents = JSON.parse(legacyAgentsRaw) as CustomAgent[];
      await backend.write(AGENTS_KEY, legacyAgents);
      // Per-agent chat threads
      for (const a of legacyAgents) {
        const chatRaw = window.localStorage.getItem(LEGACY_CHAT(a.id));
        if (chatRaw) {
          await backend.write(threadKey(a.id), JSON.parse(chatRaw));
        }
      }
    }

    // Legacy thumbnails were a bare string[] of image srcs — wrap them.
    const legacyThumbsRaw = window.localStorage.getItem(LEGACY_THUMBS);
    if (legacyThumbsRaw && !(await backend.read(THUMBS_KEY))) {
      const srcs = JSON.parse(legacyThumbsRaw) as string[];
      if (Array.isArray(srcs)) {
        const wrapped: SavedThumbnail[] = srcs.map((src, i) => ({
          id: `legacy-${i}-${Math.random().toString(36).slice(2)}`,
          src,
          title: 'Untitled',
          createdAt: new Date().toISOString(),
        }));
        await backend.write(THUMBS_KEY, wrapped);
      }
    }
  } catch (e) {
    console.error('agent-store migration failed (continuing):', e);
  } finally {
    await backend.write(MIGRATED_FLAG, true);
  }
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// --- Agents CRUD ---------------------------------------------------------

export async function listAgents(): Promise<CustomAgent[]> {
  await migrateLegacyOnce();
  return (await backend.read<CustomAgent[]>(AGENTS_KEY)) ?? [];
}

export async function getAgent(id: string): Promise<CustomAgent | null> {
  const agents = await listAgents();
  return agents.find((a) => a.id === id) ?? null;
}

export async function createAgent(
  input: Omit<CustomAgent, 'id' | 'createdAt' | 'updatedAt'>
): Promise<CustomAgent> {
  const agents = await listAgents();
  const now = new Date().toISOString();
  const agent: CustomAgent = { ...input, id: newId(), createdAt: now, updatedAt: now };
  await backend.write(AGENTS_KEY, [agent, ...agents]);
  return agent;
}

export async function updateAgent(
  id: string,
  patch: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>
): Promise<CustomAgent | null> {
  const agents = await listAgents();
  let updated: CustomAgent | null = null;
  const next = agents.map((a) => {
    if (a.id !== id) return a;
    updated = { ...a, ...patch, updatedAt: new Date().toISOString() };
    return updated;
  });
  if (updated) await backend.write(AGENTS_KEY, next);
  return updated;
}

export async function deleteAgent(id: string): Promise<void> {
  const agents = await listAgents();
  await backend.write(AGENTS_KEY, agents.filter((a) => a.id !== id));
  await backend.remove(threadKey(id));
  await backend.remove(memoryKey(id));
}

// --- Durable memory (dedicated keyspace, works for custom AND built-in agents) ---

export async function getAgentMemory(id: string): Promise<string> {
  return (await backend.read<string>(memoryKey(id))) ?? '';
}

export async function setAgentMemory(id: string, memory: string): Promise<void> {
  if (memory) await backend.write(memoryKey(id), memory);
  else await backend.remove(memoryKey(id));
}

// --- Chat threads --------------------------------------------------------

export async function getThread(agentId: string): Promise<ChatMessage[]> {
  return (await backend.read<ChatMessage[]>(threadKey(agentId))) ?? [];
}

export async function saveThread(agentId: string, messages: ChatMessage[]): Promise<void> {
  await backend.write(threadKey(agentId), messages);
}

export async function clearThread(agentId: string): Promise<void> {
  await backend.remove(threadKey(agentId));
}

// --- Thumbnail gallery ---------------------------------------------------

export async function listThumbnails(): Promise<SavedThumbnail[]> {
  await migrateLegacyOnce();
  return (await backend.read<SavedThumbnail[]>(THUMBS_KEY)) ?? [];
}

/** Prepend newly generated thumbnails to the gallery and return the full list. */
export async function addThumbnails(
  srcs: string[],
  meta: { title: string; channelTitle?: string }
): Promise<SavedThumbnail[]> {
  const existing = await listThumbnails();
  const now = new Date().toISOString();
  const added: SavedThumbnail[] = srcs.map((src) => ({
    id: newId(),
    src,
    title: meta.title || 'Untitled',
    channelTitle: meta.channelTitle,
    createdAt: now,
  }));
  const next = [...added, ...existing].slice(0, 60); // cap to keep storage bounded
  await backend.write(THUMBS_KEY, next);
  return next;
}

export async function removeThumbnail(id: string): Promise<SavedThumbnail[]> {
  const next = (await listThumbnails()).filter((t) => t.id !== id);
  await backend.write(THUMBS_KEY, next);
  return next;
}
