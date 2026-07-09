'use client';

/**
 * Drives one agent run against /api/agents/chat and exposes it as UI state:
 * the live activity trail (skills loaded, tools called) and the final typed
 * deliverable. Used by every Agent Workspace.
 */

import { useCallback, useRef, useState } from 'react';

export interface AgentRunRequest {
  instructions: string;
  userMessage: string;
  deliverable: string;
  tools?: string[];
  connectors?: string[];
  skills?: string[];
  model?: string;
  memory?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export type RunPhase = 'idle' | 'running' | 'done' | 'error';

export function useAgentRun<T>() {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase('idle');
    setStatuses([]);
    setResult(null);
    setError(null);
  }, []);

  const run = useCallback(async (req: AgentRunRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('running');
    setStatuses([]);
    setResult(null);
    setError(null);

    try {
      const res = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: [], ...req }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let deliverable: string | null = null;

      const handle = (line: string) => {
        const t = line.trim();
        if (!t) return;
        let ev: { type: string; content: string };
        try {
          ev = JSON.parse(t);
        } catch {
          return;
        }
        if (ev.type === 'status') setStatuses((s) => [...s, ev.content]);
        else if (ev.type === 'deliverable') deliverable = ev.content;
        else if (ev.type === 'error') throw new Error(ev.content);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) handle(line);
      }
      if (buffer.trim()) handle(buffer);

      if (!deliverable) throw new Error('The agent did not return a result.');
      setResult(JSON.parse(deliverable) as T);
      setPhase('done');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      console.error('agent run failed:', e);
      setError(e?.message || 'Something went wrong.');
      setPhase('error');
    }
  }, []);

  return { run, reset, phase, statuses, result, error };
}
