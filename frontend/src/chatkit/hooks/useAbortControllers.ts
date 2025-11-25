/**
 * Hook pour gérer les abort controllers des requêtes en cours
 */
import { useRef, useEffect, useCallback } from 'react';

export interface UseAbortControllersReturn {
  abortControllersRef: React.MutableRefObject<Map<string, AbortController>>;
  getOrCreateController: (key: string) => AbortController;
  abortAndReplace: (key: string) => AbortController;
  cleanup: (key: string) => void;
  cleanupMultiple: (keys: string[]) => void;
}

export function useAbortControllers(): UseAbortControllersReturn {
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllersRef.current.forEach((controller) => controller.abort());
      abortControllersRef.current.clear();
    };
  }, []);

  const getOrCreateController = useCallback((key: string): AbortController => {
    const existing = abortControllersRef.current.get(key);
    if (existing) {
      return existing;
    }
    const controller = new AbortController();
    abortControllersRef.current.set(key, controller);
    return controller;
  }, []);

  const abortAndReplace = useCallback((key: string): AbortController => {
    const existing = abortControllersRef.current.get(key);
    if (existing) {
      existing.abort();
    }
    const controller = new AbortController();
    abortControllersRef.current.set(key, controller);
    return controller;
  }, []);

  const cleanup = useCallback((key: string) => {
    abortControllersRef.current.delete(key);
  }, []);

  const cleanupMultiple = useCallback((keys: string[]) => {
    keys.forEach((key) => abortControllersRef.current.delete(key));
  }, []);

  return {
    abortControllersRef,
    getOrCreateController,
    abortAndReplace,
    cleanup,
    cleanupMultiple,
  };
}
