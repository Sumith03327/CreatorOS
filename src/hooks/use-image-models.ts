'use client';

import { useEffect, useState } from 'react';

/** Mirrors ImageModel in src/services/mesh-models.ts (server-side). */
export interface ImageModel {
  id: string;
  name: string;
  brand: string;
  pricePerImage: number | null;
  supportsReference: boolean;
  supportsEdit: boolean;
  description?: string;
  recommended: boolean;
}

/**
 * The Mesh image-model catalog. Fetched once per mount and shared through
 * a module-level promise so several pickers on one page don't each refetch.
 */
let inflight: Promise<ImageModel[]> | null = null;

function fetchModels(): Promise<ImageModel[]> {
  if (!inflight) {
    inflight = fetch('/api/models')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Failed to load models (${res.status})`);
        return (data.models ?? []) as ImageModel[];
      })
      .catch((e) => {
        inflight = null; // let a later mount retry
        throw e;
      });
  }
  return inflight;
}

export function useImageModels() {
  const [models, setModels] = useState<ImageModel[]>([]);
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

/** "$0.04 / image", or "per-token" when Mesh doesn't price this model per image. */
export function formatModelPrice(m: ImageModel): string {
  if (m.pricePerImage === null) return 'per-token';
  if (m.pricePerImage < 0.01) return `$${m.pricePerImage.toFixed(4)} / image`;
  return `$${m.pricePerImage.toFixed(2)} / image`;
}
