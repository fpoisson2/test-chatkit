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

// Délai pour différencier un vrai unmount d'un remount StrictMode
const UNMOUNT_DELAY_MS = 100;

export function useAbortControllers(): UseAbortControllersReturn {
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const unmountTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount - avec délai pour ignorer les remounts StrictMode
  useEffect(() => {
    // Annuler tout abort programmé lors du remount
    if (unmountTimeoutRef.current) {
      clearTimeout(unmountTimeoutRef.current);
      unmountTimeoutRef.current = null;
    }

    return () => {
      // Programmer l'abort avec un délai
      // Si le composant se remonte rapidement (StrictMode), le timeout sera annulé
      unmountTimeoutRef.current = setTimeout(() => {
        abortControllersRef.current.forEach((controller) => controller.abort());
        abortControllersRef.current.clear();
      }, UNMOUNT_DELAY_MS);
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
