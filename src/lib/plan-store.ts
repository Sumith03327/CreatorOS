'use client';

/**
 * @fileOverview Persistence for the Action Plan — the diagnosis, the plan, the
 * calendar, and the goal.
 *
 * Everything on the plan page used to live in React state, so navigating to
 * another feature threw away work that cost real API calls to produce. This
 * stores it, keyed by channel, so coming back restores where you were.
 *
 * It also gives us plan HISTORY for free: every generated plan is a snapshot of
 * what the channel looked like and what we told the creator to do, which is what
 * makes the "did you actually ship it?" check possible later.
 */

import type { ChannelMetrics, Finding } from '@/lib/channel-diagnosis';
import type { PlannedUpload } from '@/ai/flows/generate-content-calendar';
import type { GenerateContentActionPlanOutput } from '@/ai/flows/generate-content-action-plan';

const PLANS_KEY = 'creator-hub:v2:plans';
const GOAL_KEY = 'creator-hub:v2:goal';
const CHANGE_EVENT = 'creator-hub-plan-change';

/** Keep history bounded — a creator does not need last year's plans. */
const MAX_PLANS = 12;

export interface SavedPlan {
  id: string;
  channelId: string;
  createdAt: string;
  /** Snapshot of the channel at the moment we planned — history is only honest if it's frozen. */
  metrics: ChannelMetrics;
  findings: Finding[];
  brief: string;
  actionPlan?: GenerateContentActionPlanOutput;
  calendar?: PlannedUpload[];
}

export type GoalMetric = 'subscribers' | 'views';

export interface Goal {
  metric: GoalMetric;
  target: number;
  /** YYYY-MM-DD. */
  deadline: string;
  /** The channel's value when the goal was set — the baseline for real progress. */
  startValue: number;
  startedAt: string;
  channelId: string;
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
    console.error('plan-store write failed:', key, e);
  }
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// --- Plans ----------------------------------------------------------------

export function listPlans(channelId?: string): SavedPlan[] {
  const all = read<SavedPlan[]>(PLANS_KEY, []);
  const valid = Array.isArray(all) ? all.filter((p) => p && p.id && p.channelId) : [];
  return channelId ? valid.filter((p) => p.channelId === channelId) : valid;
}

/** The plan we restore on return, so a page navigation doesn't throw away work. */
export function latestPlan(channelId: string): SavedPlan | null {
  return listPlans(channelId)[0] ?? null;
}

export function savePlan(input: Omit<SavedPlan, 'id' | 'createdAt'>): SavedPlan {
  const plan: SavedPlan = { ...input, id: newId(), createdAt: new Date().toISOString() };
  write(PLANS_KEY, [plan, ...listPlans()].slice(0, MAX_PLANS));
  return plan;
}

/**
 * Merge into an existing plan — the action plan and the calendar are generated
 * by separate buttons, and both belong to the same session.
 */
export function updatePlan(id: string, patch: Partial<Omit<SavedPlan, 'id' | 'createdAt'>>): SavedPlan | null {
  const all = listPlans();
  let updated: SavedPlan | null = null;
  const next = all.map((p) => {
    if (p.id !== id) return p;
    updated = { ...p, ...patch };
    return updated;
  });
  if (updated) write(PLANS_KEY, next);
  return updated;
}

export function deletePlan(id: string): void {
  write(PLANS_KEY, listPlans().filter((p) => p.id !== id));
}

// --- Goal -----------------------------------------------------------------

export function getGoal(channelId?: string): Goal | null {
  const g = read<Goal | null>(GOAL_KEY, null);
  if (!g || typeof g.target !== 'number') return null;
  if (channelId && g.channelId !== channelId) return null;
  return g;
}

export function setGoal(goal: Goal): Goal {
  write(GOAL_KEY, goal);
  return goal;
}

export function clearGoal(): void {
  try {
    window.localStorage.removeItem(GOAL_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeToPlans(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}
