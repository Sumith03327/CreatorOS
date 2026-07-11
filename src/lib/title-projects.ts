'use client';

/**
 * @fileOverview Title projects — a named bundle of ideas you keep working on.
 *
 * The Title & Hook Doctor used to be a one-shot: type a title, get a score, lose
 * it. That's fine for a spot-check and useless for real work, where a creator is
 * juggling ten candidate titles for next month. A project holds the ideas, and
 * the score sticks to the idea once the Doctor has graded it — so you can come
 * back, see which of your ten actually scored well, and keep going.
 *
 * The `inbox` is the handoff channel: the Action Plan drops a batch of ideas in
 * and redirects to the Doctor, which offers to save them into a project. Passing
 * ten titles through a URL would be unreadable and lossy; this is neither.
 */

const PROJECTS_KEY = 'creator-hub:v2:title-projects';
const INBOX_KEY = 'creator-hub:v2:title-inbox';
const CHANGE_EVENT = 'creator-hub-title-projects-change';

export type IdeaStatus = 'idea' | 'scored' | 'chosen';

export interface TitleIdea {
  id: string;
  title: string;
  /** Where it came from, so the project keeps its provenance. */
  source: 'plan' | 'manual' | 'rewrite';
  status: IdeaStatus;
  /** 0-10, written back when the Doctor scores it. */
  score?: number;
  verdict?: string;
  /** Stronger rewrites the Doctor produced for this idea. */
  rewrites?: string[];
  createdAt: string;
}

export interface TitleProject {
  id: string;
  name: string;
  ideas: TitleIdea[];
  createdAt: string;
  updatedAt: string;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch (e) {
    console.error('title-projects write failed:', key, e);
  }
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function makeIdea(title: string, source: TitleIdea['source'] = 'manual'): TitleIdea {
  return { id: newId(), title: title.trim(), source, status: 'idea', createdAt: new Date().toISOString() };
}

// --- Projects -------------------------------------------------------------

export function listTitleProjects(): TitleProject[] {
  const all = read<TitleProject[]>(PROJECTS_KEY, []);
  return Array.isArray(all) ? all.filter((p) => p && p.id && Array.isArray(p.ideas)) : [];
}

export function getTitleProject(id: string): TitleProject | null {
  return listTitleProjects().find((p) => p.id === id) ?? null;
}

export function createTitleProject(name: string, ideas: TitleIdea[] = []): TitleProject {
  const now = new Date().toISOString();
  const project: TitleProject = {
    id: newId(),
    name: name.trim() || 'Untitled project',
    ideas,
    createdAt: now,
    updatedAt: now,
  };
  write(PROJECTS_KEY, [project, ...listTitleProjects()]);
  return project;
}

export function updateTitleProject(
  id: string,
  patch: Partial<Omit<TitleProject, 'id' | 'createdAt'>>
): TitleProject | null {
  let updated: TitleProject | null = null;
  const next = listTitleProjects().map((p) => {
    if (p.id !== id) return p;
    updated = { ...p, ...patch, updatedAt: new Date().toISOString() };
    return updated;
  });
  if (updated) write(PROJECTS_KEY, next);
  return updated;
}

/** Rename — the creator's own label matters more than ours. */
export function renameTitleProject(id: string, name: string): TitleProject | null {
  return updateTitleProject(id, { name: name.trim() || 'Untitled project' });
}

export function deleteTitleProject(id: string): void {
  write(PROJECTS_KEY, listTitleProjects().filter((p) => p.id !== id));
}

// --- Ideas within a project -----------------------------------------------

/** Adds ideas, skipping any title the project already holds (case-insensitive). */
export function addIdeas(projectId: string, ideas: TitleIdea[]): TitleProject | null {
  const project = getTitleProject(projectId);
  if (!project) return null;
  const seen = new Set(project.ideas.map((i) => i.title.trim().toLowerCase()));
  const fresh = ideas.filter((i) => {
    const key = i.title.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!fresh.length) return project;
  return updateTitleProject(projectId, { ideas: [...project.ideas, ...fresh] });
}

export function updateIdea(
  projectId: string,
  ideaId: string,
  patch: Partial<Omit<TitleIdea, 'id' | 'createdAt'>>
): TitleProject | null {
  const project = getTitleProject(projectId);
  if (!project) return null;
  return updateTitleProject(projectId, {
    ideas: project.ideas.map((i) => (i.id === ideaId ? { ...i, ...patch } : i)),
  });
}

export function removeIdea(projectId: string, ideaId: string): TitleProject | null {
  const project = getTitleProject(projectId);
  if (!project) return null;
  return updateTitleProject(projectId, { ideas: project.ideas.filter((i) => i.id !== ideaId) });
}

// --- Handoff inbox --------------------------------------------------------

/** The Action Plan drops ideas here, then redirects to the Doctor. */
export function setInbox(titles: string[]): void {
  write(INBOX_KEY, titles.filter(Boolean));
}

export function peekInbox(): string[] {
  const v = read<string[]>(INBOX_KEY, []);
  return Array.isArray(v) ? v : [];
}

/** Read once and clear — an inbox that never empties would re-prompt forever. */
export function takeInbox(): string[] {
  const v = peekInbox();
  clearInbox();
  return v;
}

export function clearInbox(): void {
  try {
    window.localStorage.removeItem(INBOX_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeToTitleProjects(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}
