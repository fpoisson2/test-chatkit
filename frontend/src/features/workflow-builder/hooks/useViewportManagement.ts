import { useCallback, type MutableRefObject } from "react";
import type { Viewport } from "reactflow";

export interface UseViewportManagementParams {
  viewportRef: MutableRefObject<Viewport>;
  viewportKeyRef: MutableRefObject<string | null>;
  viewportMemoryRef: MutableRefObject<Map<string, Viewport>>;
  hasUserViewportChangeRef: MutableRefObject<boolean>;
  setViewport: (viewport: Viewport) => void;
  setHasUserViewportChange: (value: boolean) => void;
  persistViewportMemory: () => void;
}

export interface UseViewportManagementReturn {
  updateViewportState: (
    nextViewport: Viewport | null | undefined,
    options?: { persist?: boolean }
  ) => void;
}

/**
 * Hook for managing viewport state updates and persistence
 */
export const useViewportManagement = ({
  viewportRef,
  viewportKeyRef,
  viewportMemoryRef,
  hasUserViewportChangeRef,
  setViewport,
  setHasUserViewportChange,
  persistViewportMemory,
}: UseViewportManagementParams): UseViewportManagementReturn => {
  const updateViewportState = useCallback(
    (nextViewport: Viewport | null | undefined, options?: { persist?: boolean }) => {
      if (!nextViewport) {
        return;
      }

      const { persist = true } = options ?? {};

      viewportRef.current = nextViewport;
      setViewport(nextViewport);
      hasUserViewportChangeRef.current = true;
      setHasUserViewportChange(true);

      const key = viewportKeyRef.current;
      if (persist && key) {
        viewportMemoryRef.current.set(key, { ...nextViewport });
        persistViewportMemory();
      }
    },
    [
      hasUserViewportChangeRef,
      persistViewportMemory,
      setHasUserViewportChange,
      setViewport,
      viewportKeyRef,
      viewportMemoryRef,
      viewportRef,
    ],
  );

  return {
    updateViewportState,
  };
};
