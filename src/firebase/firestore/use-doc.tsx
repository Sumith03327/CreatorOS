
'use client';
    
import { useState, useEffect } from 'react';

/**
 * STANDALONE DOC HOOK MOCK
 */

type WithId<T> = T & { id: string };

export interface UseDocResult<T> {
  data: WithId<T> | null;
  isLoading: boolean;
  error: any;
}

export function useDoc<T = any>(
  memoizedDocRef: any
): UseDocResult<T> {
  const [data, setData] = useState<WithId<T> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    if (!memoizedDocRef) return;
    setIsLoading(true);
    const stored = localStorage.getItem(`fs_${memoizedDocRef.path}`);
    if (stored) {
      setData({ ...JSON.parse(stored), id: memoizedDocRef.path.split('/').pop() });
    }
    setIsLoading(false);
  }, [memoizedDocRef]);

  return { data, isLoading, error };
}
