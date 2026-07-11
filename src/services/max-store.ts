'use client';

/**
 * @fileOverview Persistence layer for "Script with Max" — chat threads and
 * the Projects (reusable style/tone/hook/reference context packs) they can
 * be grounded in.
 *
 * Same pattern as `agent-store.ts`: localStorage today, behind a small
 * `StorageBackend` seam so a real backend can be dropped in later with no
 * changes to callers.
 */

const NS = 'creator-hub';
const SCHEMA = 'v2';
const key = (...parts: string[]) => [NS, SCHEMA, 'max', ...parts].join(':');

const PROJECTS_KEY = key('projects');
const THREADS_KEY = key('threads');

/** Bounds storage the same way agent-store caps its lists. */
const MAX_THREADS = 100;

// --- Types ---------------------------------------------------------------

export type MaxFileKind = 'hookguide' | 'style' | 'reference' | 'tone' | 'other';

export interface MaxProjectFile {
  id: string;
  /** Original filename, e.g. "style.md". */
  name: string;
  kind: MaxFileKind;
  /** Extracted text content. */
  content: string;
  addedAt: string;
}

export interface MaxProject {
  id: string;
  name: string;
  description?: string;
  files: MaxProjectFile[];
  createdAt: string;
  updatedAt: string;
}

export interface MaxChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export type MaxSourceKind = 'url' | 'video' | 'note';

/** One resource collected in the Research tab — a link, video, or a plain note. */
export interface MaxSourceItem {
  id: string;
  kind: MaxSourceKind;
  /** Short user-facing label (defaults to the url/note text if not given). */
  label: string;
  /** The url or note body. */
  value: string;
  addedAt: string;
}

export interface MaxThread {
  id: string;
  title: string;
  projectIds: string[];
  model?: string;
  messages: MaxChatMessage[];
  /** Resources collected in the Research tab — separate from the write conversation. */
  sources: MaxSourceItem[];
  /** The Research tab's own Q&A scratchpad, kept apart from `messages`. */
  researchMessages: MaxChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// --- Storage backend (the swap point) ------------------------------------

interface StorageBackend {
  read<T>(k: string): Promise<T | null>;
  write<T>(k: string, value: T): Promise<void>;
  remove(k: string): Promise<void>;
}

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
      console.error('max-store write failed:', k, e);
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

const backend: StorageBackend = localBackend;

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// --- Projects CRUD ---------------------------------------------------------

export async function listProjects(): Promise<MaxProject[]> {
  return (await backend.read<MaxProject[]>(PROJECTS_KEY)) ?? [];
}

export async function getProject(id: string): Promise<MaxProject | null> {
  return (await listProjects()).find((p) => p.id === id) ?? null;
}

export async function createProject(input: { name: string; description?: string }): Promise<MaxProject> {
  const projects = await listProjects();
  const now = new Date().toISOString();
  const project: MaxProject = {
    id: newId(),
    name: input.name.trim() || 'Untitled project',
    description: input.description,
    files: [],
    createdAt: now,
    updatedAt: now,
  };
  await backend.write(PROJECTS_KEY, [project, ...projects]);
  return project;
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<MaxProject, 'id' | 'createdAt'>>
): Promise<MaxProject | null> {
  const projects = await listProjects();
  let updated: MaxProject | null = null;
  const next = projects.map((p) => {
    if (p.id !== id) return p;
    updated = { ...p, ...patch, updatedAt: new Date().toISOString() };
    return updated;
  });
  if (updated) await backend.write(PROJECTS_KEY, next);
  return updated;
}

export async function deleteProject(id: string): Promise<void> {
  const projects = await listProjects();
  await backend.write(PROJECTS_KEY, projects.filter((p) => p.id !== id));
  // Detach the project from any threads that referenced it, rather than
  // leaving dangling ids around.
  const threads = await listThreads();
  const detached = threads.map((t) =>
    t.projectIds.includes(id) ? { ...t, projectIds: t.projectIds.filter((pid) => pid !== id) } : t
  );
  await backend.write(THREADS_KEY, detached);
}

// --- Files within a project ------------------------------------------------

export async function addProjectFile(
  projectId: string,
  file: { name: string; kind: MaxFileKind; content: string }
): Promise<MaxProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const entry: MaxProjectFile = { ...file, id: newId(), addedAt: new Date().toISOString() };
  return updateProject(projectId, { files: [...project.files, entry] });
}

export async function removeProjectFile(projectId: string, fileId: string): Promise<MaxProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  return updateProject(projectId, { files: project.files.filter((f) => f.id !== fileId) });
}

/**
 * Replaces the file with a matching `name` if one exists, else appends —
 * the primitive Research's live autosave is built on, so a repeated
 * citation or a running "Research Notes" file updates in place instead of
 * piling up duplicates.
 */
export async function upsertProjectFile(
  projectId: string,
  file: { name: string; kind: MaxFileKind; content: string }
): Promise<MaxProject | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const existing = project.files.find((f) => f.name === file.name);
  if (!existing) return addProjectFile(projectId, file);
  const files = project.files.map((f) =>
    f.name === file.name ? { ...f, kind: file.kind, content: file.content, addedAt: new Date().toISOString() } : f
  );
  return updateProject(projectId, { files });
}

// --- Threads CRUD ------------------------------------------------------------

/** Backfills fields added after a thread was first created (older localStorage data). */
function normalizeThread(t: MaxThread): MaxThread {
  return { ...t, sources: t.sources ?? [], researchMessages: t.researchMessages ?? [] };
}

export async function listThreads(): Promise<MaxThread[]> {
  const threads = (await backend.read<MaxThread[]>(THREADS_KEY)) ?? [];
  return threads.map(normalizeThread);
}

export async function getThread(id: string): Promise<MaxThread | null> {
  return (await listThreads()).find((t) => t.id === id) ?? null;
}

export async function createThread(input: {
  title?: string;
  projectIds?: string[];
  model?: string;
}): Promise<MaxThread> {
  const threads = await listThreads();
  const now = new Date().toISOString();
  const thread: MaxThread = {
    id: newId(),
    title: input.title?.trim() || 'New chat',
    projectIds: input.projectIds ?? [],
    model: input.model,
    messages: [],
    sources: [],
    researchMessages: [],
    createdAt: now,
    updatedAt: now,
  };
  await backend.write(THREADS_KEY, [thread, ...threads].slice(0, MAX_THREADS));
  return thread;
}

export async function updateThread(
  id: string,
  patch: Partial<Omit<MaxThread, 'id' | 'createdAt'>>
): Promise<MaxThread | null> {
  const threads = await listThreads();
  let updated: MaxThread | null = null;
  const next = threads.map((t) => {
    if (t.id !== id) return t;
    updated = { ...t, ...patch, updatedAt: new Date().toISOString() };
    return updated;
  });
  if (updated) await backend.write(THREADS_KEY, next);
  return updated;
}

export async function deleteThread(id: string): Promise<void> {
  const threads = await listThreads();
  await backend.write(THREADS_KEY, threads.filter((t) => t.id !== id));
}

/** Appends messages and, if this is the thread's first exchange, derives a title from it. */
export async function appendMessages(id: string, messages: MaxChatMessage[]): Promise<MaxThread | null> {
  const thread = await getThread(id);
  if (!thread) return null;
  const nextMessages = [...thread.messages, ...messages];
  const patch: Partial<MaxThread> = { messages: nextMessages };
  if (thread.title === 'New chat') {
    const firstUser = nextMessages.find((m) => m.role === 'user');
    if (firstUser) patch.title = firstUser.content.trim().slice(0, 60) || 'New chat';
  }
  return updateThread(id, patch);
}

// --- Research tab: sources + its own Q&A scratchpad -----------------------

export async function addSource(
  threadId: string,
  source: { kind: MaxSourceKind; label: string; value: string }
): Promise<MaxThread | null> {
  return addSources(threadId, [source]);
}

/**
 * Adds several sources in one read-modify-write cycle. A research answer
 * can cite many sources at once; adding them one call at a time would race
 * on localStorage's non-transactional read-then-write and silently drop all
 * but the last one, so callers with a batch should always use this instead
 * of looping `addSource`.
 */
export async function addSources(
  threadId: string,
  sources: { kind: MaxSourceKind; label: string; value: string }[]
): Promise<MaxThread | null> {
  if (!sources.length) return getThread(threadId);
  const thread = await getThread(threadId);
  if (!thread) return null;
  const now = new Date().toISOString();
  const entries: MaxSourceItem[] = sources.map((s) => ({ ...s, id: newId(), addedAt: now }));
  return updateThread(threadId, { sources: [...thread.sources, ...entries] });
}

export async function removeSource(threadId: string, sourceId: string): Promise<MaxThread | null> {
  const thread = await getThread(threadId);
  if (!thread) return null;
  return updateThread(threadId, { sources: thread.sources.filter((s) => s.id !== sourceId) });
}

export async function appendResearchMessages(id: string, messages: MaxChatMessage[]): Promise<MaxThread | null> {
  const thread = await getThread(id);
  if (!thread) return null;
  return updateThread(id, { researchMessages: [...thread.researchMessages, ...messages] });
}
