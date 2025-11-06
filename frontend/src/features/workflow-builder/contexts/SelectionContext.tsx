import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from "react";

// Context types
type SelectionContextValue = {
  // State
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  previousSelectedElement: { type: "node" | "edge"; id: string } | null;

  // Refs
  selectedNodeIdRef: React.MutableRefObject<string | null>;
  selectedEdgeIdRef: React.MutableRefObject<string | null>;
  selectedNodeIdsRef: React.MutableRefObject<Set<string>>;
  selectedEdgeIdsRef: React.MutableRefObject<Set<string>>;
  previousSelectedElementRef: React.MutableRefObject<{ type: "node" | "edge"; id: string } | null>;

  // Methods
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  selectMultipleNodes: (ids: string[]) => void;
  selectMultipleEdges: (ids: string[]) => void;
  clearSelection: () => void;
  handleSelectionChange: (selection: { nodes: string[]; edges: string[] }) => void;

  // Setters
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setSelectedNodeIds: (ids: Set<string>) => void;
  setSelectedEdgeIds: (ids: Set<string>) => void;
  setPreviousSelectedElement: (element: { type: "node" | "edge"; id: string } | null) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export const useSelectionContext = () => {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error("useSelectionContext must be used within SelectionProvider");
  }
  return context;
};

type SelectionProviderProps = {
  children: ReactNode;
};

export const SelectionProvider = ({ children }: SelectionProviderProps) => {
  // State
  const [selectedNodeId, setSelectedNodeIdState] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeIdState] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIdsState] = useState<Set<string>>(new Set());
  const [selectedEdgeIds, setSelectedEdgeIdsState] = useState<Set<string>>(new Set());
  const [previousSelectedElement, setPreviousSelectedElementState] = useState<
    { type: "node" | "edge"; id: string } | null
  >(null);

  // Refs for synchronization
  const selectedNodeIdRef = useRef<string | null>(null);
  const selectedEdgeIdRef = useRef<string | null>(null);
  const selectedNodeIdsRef = useRef<Set<string>>(new Set());
  const selectedEdgeIdsRef = useRef<Set<string>>(new Set());
  const previousSelectedElementRef = useRef<{ type: "node" | "edge"; id: string } | null>(null);

  // Sync refs with state
  selectedNodeIdRef.current = selectedNodeId;
  selectedEdgeIdRef.current = selectedEdgeId;
  selectedNodeIdsRef.current = selectedNodeIds;
  selectedEdgeIdsRef.current = selectedEdgeIds;
  previousSelectedElementRef.current = previousSelectedElement;

  // Enhanced setters
  const setSelectedNodeId = useCallback((id: string | null) => {
    setSelectedNodeIdState(id);
    if (id) {
      setPreviousSelectedElementState({ type: "node", id });
    }
  }, []);

  const setSelectedEdgeId = useCallback((id: string | null) => {
    setSelectedEdgeIdState(id);
    if (id) {
      setPreviousSelectedElementState({ type: "edge", id });
    }
  }, []);

  const setSelectedNodeIds = useCallback((ids: Set<string>) => {
    setSelectedNodeIdsState(ids);
  }, []);

  const setSelectedEdgeIds = useCallback((ids: Set<string>) => {
    setSelectedEdgeIdsState(ids);
  }, []);

  const setPreviousSelectedElement = useCallback((element: { type: "node" | "edge"; id: string } | null) => {
    setPreviousSelectedElementState(element);
  }, []);

  // Select a single node
  const selectNode = useCallback(
    (id: string | null) => {
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      setSelectedNodeIds(id ? new Set([id]) : new Set());
      setSelectedEdgeIds(new Set());
    },
    [setSelectedNodeId, setSelectedEdgeId, setSelectedNodeIds, setSelectedEdgeIds],
  );

  // Select a single edge
  const selectEdge = useCallback(
    (id: string | null) => {
      setSelectedEdgeId(id);
      setSelectedNodeId(null);
      setSelectedEdgeIds(id ? new Set([id]) : new Set());
      setSelectedNodeIds(new Set());
    },
    [setSelectedNodeId, setSelectedEdgeId, setSelectedNodeIds, setSelectedEdgeIds],
  );

  // Select multiple nodes
  const selectMultipleNodes = useCallback(
    (ids: string[]) => {
      const nodeSet = new Set(ids);
      setSelectedNodeIds(nodeSet);
      setSelectedEdgeIds(new Set());

      if (ids.length === 1) {
        setSelectedNodeId(ids[0]);
        setSelectedEdgeId(null);
      } else {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      }
    },
    [setSelectedNodeId, setSelectedEdgeId, setSelectedNodeIds, setSelectedEdgeIds],
  );

  // Select multiple edges
  const selectMultipleEdges = useCallback(
    (ids: string[]) => {
      const edgeSet = new Set(ids);
      setSelectedEdgeIds(edgeSet);
      setSelectedNodeIds(new Set());

      if (ids.length === 1) {
        setSelectedEdgeId(ids[0]);
        setSelectedNodeId(null);
      } else {
        setSelectedEdgeId(null);
        setSelectedNodeId(null);
      }
    },
    [setSelectedNodeId, setSelectedEdgeId, setSelectedNodeIds, setSelectedEdgeIds],
  );

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
  }, [setSelectedNodeId, setSelectedEdgeId, setSelectedNodeIds, setSelectedEdgeIds]);

  // Handle selection changes from ReactFlow
  const handleSelectionChange = useCallback(
    (selection: { nodes: string[]; edges: string[] }) => {
      const nodeIds = selection.nodes;
      const edgeIds = selection.edges;

      if (nodeIds.length > 0) {
        selectMultipleNodes(nodeIds);
      } else if (edgeIds.length > 0) {
        selectMultipleEdges(edgeIds);
      } else {
        clearSelection();
      }
    },
    [selectMultipleNodes, selectMultipleEdges, clearSelection],
  );

  const value = useMemo<SelectionContextValue>(
    () => ({
      // State
      selectedNodeId,
      selectedEdgeId,
      selectedNodeIds,
      selectedEdgeIds,
      previousSelectedElement,

      // Refs
      selectedNodeIdRef,
      selectedEdgeIdRef,
      selectedNodeIdsRef,
      selectedEdgeIdsRef,
      previousSelectedElementRef,

      // Methods
      selectNode,
      selectEdge,
      selectMultipleNodes,
      selectMultipleEdges,
      clearSelection,
      handleSelectionChange,

      // Setters
      setSelectedNodeId,
      setSelectedEdgeId,
      setSelectedNodeIds,
      setSelectedEdgeIds,
      setPreviousSelectedElement,
    }),
    [
      selectedNodeId,
      selectedEdgeId,
      selectedNodeIds,
      selectedEdgeIds,
      previousSelectedElement,
      selectNode,
      selectEdge,
      selectMultipleNodes,
      selectMultipleEdges,
      clearSelection,
      handleSelectionChange,
      setSelectedNodeId,
      setSelectedEdgeId,
      setSelectedNodeIds,
      setSelectedEdgeIds,
      setPreviousSelectedElement,
    ],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
};
