
'use client';

import { useState, useEffect } from 'react';

/**
 * STANDALONE COLLECTION HOOK MOCK
 */

export type WithId<T> = T & { id: string };

export interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: any;
}

export function useCollection<T = any>(
    memoizedTargetRefOrQuery: any
): UseCollectionResult<T> {
  const [data, setData] = useState<WithId<T>[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    if (!memoizedTargetRefOrQuery) return;
    setIsLoading(true);
    // In standalone mode, we could read all items from localStorage that start with this path
    const results: any[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`fs_${memoizedTargetRefOrQuery.path}/`)) {
        results.push({ ...JSON.parse(localStorage.getItem(key)!), id: key.split('/').pop() });
      }
    }
    setData(results);
    setIsLoading(false);
  }, [memoizedTargetRefOrQuery]);

  return { data, isLoading, error };
}
