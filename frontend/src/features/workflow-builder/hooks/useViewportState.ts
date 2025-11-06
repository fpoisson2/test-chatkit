import { useRef } from "react";
import type { ReactFlowInstance, Viewport } from "reactflow";

interface UseViewportStateReturn {
  // ReactFlow Instance
  reactFlowInstanceRef: React.MutableRefObject<ReactFlowInstance | null>;
  reactFlowWrapperRef: React.MutableRefObject<HTMLDivElement | null>;

  // Viewport State
  viewportRef: React.MutableRefObject<Viewport | null>;
  viewportMemoryRef: React.MutableRefObject<Map<string, Viewport>>;
  viewportKeyRef: React.MutableRefObject<string | null>;
  hasUserViewportChangeRef: React.MutableRefObject<boolean>;
  pendingViewportRestoreRef: React.MutableRefObject<boolean>;

  // Block Library
  blockLibraryScrollRef: React.MutableRefObject<HTMLDivElement | null>;
  blockLibraryItemRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  blockLibraryAnimationFrameRef: React.MutableRefObject<number | null>;

  // Mobile Actions
  mobileActionsTriggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  mobileActionsMenuRef: React.MutableRefObject<HTMLDivElement | null>;

  // Import File
  importFileInputRef: React.MutableRefObject<HTMLInputElement | null>;
}

/**
 * Hook to manage viewport and UI element refs in the workflow builder.
 */
export const useViewportState = (): UseViewportStateReturn => {
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const reactFlowWrapperRef = useRef<HTMLDivElement | null>(null);

  const viewportRef = useRef<Viewport | null>(null);
  const viewportMemoryRef = useRef(new Map<string, Viewport>());
  const viewportKeyRef = useRef<string | null>(null);
  const hasUserViewportChangeRef = useRef(false);
  const pendingViewportRestoreRef = useRef(false);

  const blockLibraryScrollRef = useRef<HTMLDivElement | null>(null);
  const blockLibraryItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const blockLibraryAnimationFrameRef = useRef<number | null>(null);

  const mobileActionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileActionsMenuRef = useRef<HTMLDivElement | null>(null);

  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  return {
    reactFlowInstanceRef,
    reactFlowWrapperRef,
    viewportRef,
    viewportMemoryRef,
    viewportKeyRef,
    hasUserViewportChangeRef,
    pendingViewportRestoreRef,
    blockLibraryScrollRef,
    blockLibraryItemRefs,
    blockLibraryAnimationFrameRef,
    mobileActionsTriggerRef,
    mobileActionsMenuRef,
    importFileInputRef,
  };
};
