'use client';

import { useEffect, useState } from 'react';

/** Mirrors ChatModel in src/services/mesh-models.ts (server-side). */
export interface ChatModel {
  id: string;
  name: string;
  brand: string;
  inputPricePerMTok: number | null;
  outputPricePerMTok: number | null;
  description?: string;
  recommended: boolean;
}

/**
 * The Mesh chat-model catalog. Fetched once per mount and shared through
 * a module-level promise so several pickers on one page don't each refetch.
 */
let inflight: Promise<ChatModel[]> | null = null;

function fetchModels(): Promise<ChatModel[]> {
  if (!inflight) {
    inflight = fetch('/api/chat-models')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Failed to load models (${res.status})`);
        return (data.models ?? []) as ChatModel[];
      })
      .catch((e) => {
        inflight = null; // let a later mount retry
        throw e;
      });
  }
  return inflight;
}

export function useChatModels() {
  const [models, setModels] = useState<ChatModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchModels()
      .then((m) => alive && setModels(m))
      .catch((e) => alive && setError(e?.message ?? 'Could not load models'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return { models, loading, error };
}

/** "$3.00 / 1M in · $15.00 / 1M out", or "pricing n/a" when Mesh doesn't expose it. */
export function formatChatModelPrice(m: ChatModel): string {
  if (m.inputPricePerMTok === null && m.outputPricePerMTok === null) return 'pricing n/a';
  const inTok = m.inputPricePerMTok !== null ? `$${m.inputPricePerMTok.toFixed(2)}/1M in` : '—';
  const outTok = m.outputPricePerMTok !== null ? `$${m.outputPricePerMTok.toFixed(2)}/1M out` : '—';
  return `${inTok} · ${outTok}`;
}
