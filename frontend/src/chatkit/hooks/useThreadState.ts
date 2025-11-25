/**
 * Hook pour gérer l'état du thread et les refs associées
 */
import { useState, useCallback, useRef } from 'react';
import type { Thread } from '../types';

export interface UseThreadStateReturn {
  thread: Thread | null;
  setThread: React.Dispatch<React.SetStateAction<Thread | null>>;
  activeThreadIdRef: React.MutableRefObject<string | null>;
  visibleThreadIdRef: React.MutableRefObject<string | null>;
  threadCacheRef: React.MutableRefObject<Map<string, Thread>>;
  getThreadKey: (threadId: string | null | undefined) => string;
  generateTempThreadId: () => string;
  isTempThreadId: (threadId: string | null | undefined) => boolean;
}

export function useThreadState(initialThreadId: string | null | undefined): UseThreadStateReturn {
  const [thread, setThread] = useState<Thread | null>(null);

  const activeThreadIdRef = useRef<string | null>(initialThreadId || null);
  const visibleThreadIdRef = useRef<string | null>(initialThreadId || null);
  const threadCacheRef = useRef<Map<string, Thread>>(new Map());
  const tempThreadIdCounterRef = useRef<number>(0);

  const getThreadKey = useCallback((threadId: string | null | undefined) => threadId ?? '__new_thread__', []);

  const generateTempThreadId = useCallback(() => {
    tempThreadIdCounterRef.current += 1;
    return `__temp_thread_${tempThreadIdCounterRef.current}__`;
  }, []);

  const isTempThreadId = useCallback((threadId: string | null | undefined): boolean => {
    return typeof threadId === 'string' && threadId.startsWith('__temp_thread_');
  }, []);

  return {
    thread,
    setThread,
    activeThreadIdRef,
    visibleThreadIdRef,
    threadCacheRef,
    getThreadKey,
    generateTempThreadId,
    isTempThreadId,
  };
}
