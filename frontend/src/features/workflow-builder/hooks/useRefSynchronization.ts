/**
 * useRefSynchronization
 *
 * Hook for synchronizing refs with React state.
 * Provides a reusable pattern for keeping refs in sync with state values,
 * useful for accessing latest values in callbacks and async functions.
 *
 * Responsibilities:
 * - Synchronize multiple refs with their corresponding state values
 * - Provide type-safe ref access
 * - Reduce boilerplate for ref synchronization
 *
 * @phase Phase 3.4 - Custom Hooks Creation
 */

import { useRef, useEffect, type MutableRefObject } from "react";

/**
 * A map of state values to synchronize with refs
 */
type SyncValues<T extends Record<string, any>> = T;

/**
 * A map of refs corresponding to the state values
 */
type SyncRefs<T extends Record<string, any>> = {
  [K in keyof T]: MutableRefObject<T[K]>;
};

/**
 * Hook for synchronizing refs with React state
 *
 * This hook creates and maintains refs that are automatically synchronized
 * with their corresponding state values. This is useful when you need to
 * access the latest state values in callbacks, async functions, or effects
 * without recreating them when state changes.
 *
 * @example
 * ```typescript
 * const syncedRefs = useRefSynchronization({
 *   nodes,
 *   edges,
 *   hasPendingChanges,
 *   selectedNodeId,
 * });
 *
 * // Access latest values in async functions
 * const handleSave = async () => {
 *   const currentNodes = syncedRefs.nodes.current;
 *   const hasChanges = syncedRefs.hasPendingChanges.current;
 *   // ...
 * };
 * ```
 *
 * @param values - Object containing state values to synchronize
 * @returns Object containing refs synchronized with the state values
 */
export function useRefSynchronization<T extends Record<string, any>>(values: SyncValues<T>): SyncRefs<T> {
  // Create refs for each value (only once, doesn't change on re-renders)
  const refsRef = useRef<SyncRefs<T> | null>(null);

  if (refsRef.current === null) {
    // Initialize refs on first render
    const refs = {} as SyncRefs<T>;
    for (const key in values) {
      // Create a ref for each key
      refs[key] = { current: values[key] } as MutableRefObject<T[typeof key]>;
    }
    refsRef.current = refs;
  }

  const refs = refsRef.current;

  // Synchronize refs with state values on every render
  // This is efficient because it only updates ref.current (no re-render)
  for (const key in values) {
    if (key in refs) {
      refs[key].current = values[key];
    }
  }

  return refs;
}

/**
 * Alternative implementation using useEffect
 * Can be used if you prefer explicit effect dependencies
 *
 * @example
 * ```typescript
 * const { nodesRef, edgesRef } = useRefSynchronizationWithEffect({
 *   nodes,
 *   edges,
 * });
 * ```
 */
export function useRefSynchronizationWithEffect<T extends Record<string, any>>(
  values: SyncValues<T>,
): SyncRefs<T> {
  // Create refs object only once
  const refsRef = useRef<SyncRefs<T> | null>(null);

  if (refsRef.current === null) {
    const refs = {} as SyncRefs<T>;
    for (const key in values) {
      refs[key] = { current: values[key] } as MutableRefObject<T[typeof key]>;
    }
    refsRef.current = refs;
  }

  const refs = refsRef.current;

  // Sync refs in an effect
  useEffect(() => {
    for (const key in values) {
      if (key in refs) {
        refs[key].current = values[key];
      }
    }
  }, [values, refs]);

  return refs;
}

/**
 * Create a single synced ref (simpler version for single values)
 *
 * @example
 * ```typescript
 * const nodesRef = useSyncedRef(nodes);
 * const edgesRef = useSyncedRef(edges);
 * ```
 */
export function useSyncedRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef<T>(value);
  ref.current = value;
  return ref;
}
