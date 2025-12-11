import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import type { ReactFlowInstance, Viewport } from "@xyflow/react";
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
  viewportRef: React.MutableRefObject<Viewport | null>;
  viewportMemoryRef: React.MutableRefObject<Map<string, Viewport>>;
  viewportKeyRef: React.MutableRefObject<string | null>;
  hasUserViewportChangeRef: React.MutableRefObject<boolean>;
  pendingViewportRestoreRef: React.MutableRefObject<boolean>;
  reactFlowInstanceRef: React.MutableRefObject<ReactFlowInstance | null>;
  isHydratingRef: React.MutableRefObject<boolean>;

  // Methods
  setViewport: (viewport: Viewport) => void;
  setMinViewportZoom: (zoom: number) => void;
  setInitialViewport: (viewport: Viewport | undefined) => void;
  setHasUserViewportChange: (hasChange: boolean) => void;
  setPendingViewportRestore: (pending: boolean) => void;
  saveViewport: (key: string, viewport: Viewport) => void;
  restoreViewport: () => void;
  clearViewport: (key: string) => void;
  updateViewport: (viewport: Viewport) => void;
  calculateMinZoom: (isMobileLayout: boolean) => number;
  refreshViewportConstraints: (flowInstance?: ReactFlowInstance | null) => number;
  generateViewportKey: (workflowId: string | number | null, versionId: number | null, deviceType: DeviceType) => string;
  persistViewportMemory: () => void;
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
  reactFlowInstanceRef?: React.MutableRefObject<ReactFlowInstance | null>;
  isHydratingRef?: React.MutableRefObject<boolean>;
  persistViewportMemory?: () => void;
  restoreViewport?: () => void;
  refreshViewportConstraints?: (flowInstance?: ReactFlowInstance | null) => number;
};

export const ViewportProvider = ({
  children,
  reactFlowInstanceRef: injectedReactFlowInstanceRef,
  isHydratingRef: injectedIsHydratingRef,
  persistViewportMemory: injectedPersistViewportMemory,
  restoreViewport: injectedRestoreViewport,
  refreshViewportConstraints: injectedRefreshViewportConstraints,
}: ViewportProviderProps) => {
  const parentContext = useContext(ViewportContext);
  const hasOverrides =
    parentContext !== null &&
    (
      injectedReactFlowInstanceRef !== undefined ||
      injectedIsHydratingRef !== undefined ||
      injectedPersistViewportMemory !== undefined ||
      injectedRestoreViewport !== undefined ||
      injectedRefreshViewportConstraints !== undefined
    );

  if (hasOverrides && parentContext) {
    const value = useMemo<ViewportContextValue>(
      () => ({
        ...parentContext,
        reactFlowInstanceRef: injectedReactFlowInstanceRef ?? parentContext.reactFlowInstanceRef,
        isHydratingRef: injectedIsHydratingRef ?? parentContext.isHydratingRef,
        persistViewportMemory: injectedPersistViewportMemory ?? parentContext.persistViewportMemory,
        restoreViewport: injectedRestoreViewport ?? parentContext.restoreViewport,
        refreshViewportConstraints:
          injectedRefreshViewportConstraints ?? parentContext.refreshViewportConstraints,
      }),
      [
        parentContext,
        injectedReactFlowInstanceRef,
        injectedIsHydratingRef,
        injectedPersistViewportMemory,
        injectedRestoreViewport,
        injectedRefreshViewportConstraints,
      ],
    );

    return <ViewportContext.Provider value={value}>{children}</ViewportContext.Provider>;
  }

  // State
  const [viewport, setViewportState] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [minViewportZoom, setMinViewportZoom] = useState(0.5);
  const [initialViewport, setInitialViewport] = useState<Viewport | undefined>(undefined);
  const [hasUserViewportChange, setHasUserViewportChangeState] = useState(false);
  const [pendingViewportRestore, setPendingViewportRestoreState] = useState(false);

  // Refs for synchronization
  const viewportRef = useRef<Viewport | null>({ x: 0, y: 0, zoom: 1 });
  const viewportMemoryRef = useRef<Map<string, Viewport>>(new Map());
  const viewportKeyRef = useRef<string | null>(null);
  const hasUserViewportChangeRef = useRef(false);
  const pendingViewportRestoreRef = useRef(false);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const isHydratingRef = useRef(false);

  // Sync refs with state
  hasUserViewportChangeRef.current = hasUserViewportChange;
  pendingViewportRestoreRef.current = pendingViewportRestore;

  // Enhanced setters
  const setViewport = useCallback((newViewport: Viewport) => {
    setViewportState(newViewport);
    viewportRef.current = newViewport;
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

  // Restore viewport from memory and apply to React Flow
  const restoreViewport = useCallback(() => {
    const instance = reactFlowInstanceRef.current;
    if (!instance) {
      pendingViewportRestoreRef.current = true;
      return;
    }

    const key = viewportKeyRef.current;
    const storedViewport = key ? viewportMemoryRef.current.get(key) ?? null : null;
    const targetViewport = storedViewport ?? viewportRef.current;

    if (!targetViewport) {
      pendingViewportRestoreRef.current = false;
      return;
    }

    pendingViewportRestoreRef.current = false;
    const normalizedViewport: Viewport = {
      x: targetViewport.x ?? 0,
      y: targetViewport.y ?? 0,
      zoom: targetViewport.zoom ?? 1,
    };

    viewportRef.current = { ...normalizedViewport };
    instance.setViewport(normalizedViewport, { duration: 0 });
  }, [reactFlowInstanceRef, viewportKeyRef, viewportMemoryRef, viewportRef, pendingViewportRestoreRef]);

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
  const refreshViewportConstraints = useCallback(
    (_flowInstance?: ReactFlowInstance | null) => {
      return minViewportZoom;
    },
    [minViewportZoom],
  );

  // Generate viewport key
  const generateViewportKey = useCallback(
    (workflowId: string | number | null, versionId: number | null, deviceType: DeviceType) => {
      return viewportKeyFor(workflowId, versionId, deviceType);
    },
    [],
  );

  const persistViewportMemory = useCallback(() => {
    // Persistence is handled by WorkflowBuilderPage via useWorkflowViewportPersistence
  }, []);

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
      reactFlowInstanceRef,
      isHydratingRef,

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
      persistViewportMemory,
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
      persistViewportMemory,
    ],
  );

  return <ViewportContext.Provider value={value}>{children}</ViewportContext.Provider>;
};
