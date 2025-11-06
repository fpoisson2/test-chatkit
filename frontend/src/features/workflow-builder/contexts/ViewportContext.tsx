import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import type { Viewport } from "reactflow";
import { viewportKeyFor, type DeviceType } from "../WorkflowBuilderUtils";

// Context types
type ViewportContextValue = {
  // State
  viewport: Viewport;
  minViewportZoom: number;
  initialViewport: Viewport | undefined;
  hasUserViewportChange: boolean;
  pendingViewportRestore: boolean;

  // Refs
  viewportRef: React.MutableRefObject<Viewport>;
  viewportMemoryRef: React.MutableRefObject<Map<string, Viewport>>;
  viewportKeyRef: React.MutableRefObject<string>;
  hasUserViewportChangeRef: React.MutableRefObject<boolean>;
  pendingViewportRestoreRef: React.MutableRefObject<boolean>;

  // Methods
  setViewport: (viewport: Viewport) => void;
  setMinViewportZoom: (zoom: number) => void;
  setInitialViewport: (viewport: Viewport | undefined) => void;
  setHasUserViewportChange: (hasChange: boolean) => void;
  setPendingViewportRestore: (pending: boolean) => void;
  saveViewport: (key: string, viewport: Viewport) => void;
  restoreViewport: (key: string) => Viewport | undefined;
  clearViewport: (key: string) => void;
  updateViewport: (viewport: Viewport) => void;
  calculateMinZoom: (isMobileLayout: boolean) => number;
  refreshViewportConstraints: () => void;
  generateViewportKey: (workflowId: string | number | null, versionId: number | null, deviceType: DeviceType) => string;
};

const ViewportContext = createContext<ViewportContextValue | null>(null);

export const useViewportContext = () => {
  const context = useContext(ViewportContext);
  if (!context) {
    throw new Error("useViewportContext must be used within ViewportProvider");
  }
  return context;
};

type ViewportProviderProps = {
  children: ReactNode;
};

export const ViewportProvider = ({ children }: ViewportProviderProps) => {
  // State
  const [viewport, setViewportState] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [minViewportZoom, setMinViewportZoom] = useState(0.5);
  const [initialViewport, setInitialViewport] = useState<Viewport | undefined>(undefined);
  const [hasUserViewportChange, setHasUserViewportChangeState] = useState(false);
  const [pendingViewportRestore, setPendingViewportRestoreState] = useState(false);

  // Refs for synchronization
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const viewportMemoryRef = useRef<Map<string, Viewport>>(new Map());
  const viewportKeyRef = useRef<string>("");
  const hasUserViewportChangeRef = useRef(false);
  const pendingViewportRestoreRef = useRef(false);

  // Sync refs with state
  viewportRef.current = viewport;
  hasUserViewportChangeRef.current = hasUserViewportChange;
  pendingViewportRestoreRef.current = pendingViewportRestore;

  // Enhanced setters
  const setViewport = useCallback((newViewport: Viewport) => {
    setViewportState(newViewport);
  }, []);

  const setHasUserViewportChange = useCallback((hasChange: boolean) => {
    setHasUserViewportChangeState(hasChange);
  }, []);

  const setPendingViewportRestore = useCallback((pending: boolean) => {
    setPendingViewportRestoreState(pending);
  }, []);

  // Save viewport to memory
  const saveViewport = useCallback((key: string, viewportToSave: Viewport) => {
    viewportMemoryRef.current.set(key, viewportToSave);
    viewportKeyRef.current = key;
  }, []);

  // Restore viewport from memory
  const restoreViewport = useCallback((key: string): Viewport | undefined => {
    return viewportMemoryRef.current.get(key);
  }, []);

  // Clear viewport from memory
  const clearViewport = useCallback((key: string) => {
    viewportMemoryRef.current.delete(key);
  }, []);

  // Update viewport
  const updateViewport = useCallback(
    (newViewport: Viewport) => {
      setViewport(newViewport);
    },
    [setViewport],
  );

  // Calculate minimum zoom based on layout
  const calculateMinZoom = useCallback((isMobileLayout: boolean) => {
    const MOBILE_MIN_VIEWPORT_ZOOM = 0.3;
    const DESKTOP_MIN_VIEWPORT_ZOOM = 0.5;
    return isMobileLayout ? MOBILE_MIN_VIEWPORT_ZOOM : DESKTOP_MIN_VIEWPORT_ZOOM;
  }, []);

  // Refresh viewport constraints
  const refreshViewportConstraints = useCallback(() => {
    // This can be implemented to recalculate viewport constraints
    // based on current layout and container size
  }, []);

  // Generate viewport key
  const generateViewportKey = useCallback(
    (workflowId: string | number | null, versionId: number | null, deviceType: DeviceType) => {
      return viewportKeyFor(workflowId, versionId, deviceType);
    },
    [],
  );

  const value = useMemo<ViewportContextValue>(
    () => ({
      // State
      viewport,
      minViewportZoom,
      initialViewport,
      hasUserViewportChange,
      pendingViewportRestore,

      // Refs
      viewportRef,
      viewportMemoryRef,
      viewportKeyRef,
      hasUserViewportChangeRef,
      pendingViewportRestoreRef,

      // Methods
      setViewport,
      setMinViewportZoom,
      setInitialViewport,
      setHasUserViewportChange,
      setPendingViewportRestore,
      saveViewport,
      restoreViewport,
      clearViewport,
      updateViewport,
      calculateMinZoom,
      refreshViewportConstraints,
      generateViewportKey,
    }),
    [
      viewport,
      minViewportZoom,
      initialViewport,
      hasUserViewportChange,
      pendingViewportRestore,
      setViewport,
      setHasUserViewportChange,
      setPendingViewportRestore,
      saveViewport,
      restoreViewport,
      clearViewport,
      updateViewport,
      calculateMinZoom,
      refreshViewportConstraints,
      generateViewportKey,
    ],
  );

  return <ViewportContext.Provider value={value}>{children}</ViewportContext.Provider>;
};
