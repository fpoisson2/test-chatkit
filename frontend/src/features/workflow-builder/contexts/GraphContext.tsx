import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useNodesState, useEdgesState, addEdge, type NodeChange, type EdgeChange, type Connection } from "reactflow";
import type { FlowNode, FlowEdge, FlowNodeData, FlowEdgeData } from "../types";

// Context types
type GraphContextValue = {
  // State
  nodes: FlowNode[];
  edges: FlowEdge[];
  graphSnapshot: string;
  hasPendingChanges: boolean;
  isNodeDragInProgress: boolean;

  // Refs
  nodesRef: React.MutableRefObject<FlowNode[]>;
  edgesRef: React.MutableRefObject<FlowEdge[]>;
  hasPendingChangesRef: React.MutableRefObject<boolean>;
  isNodeDragInProgressRef: React.MutableRefObject<boolean>;

  // Node/Edge State Management
  setNodes: (nodes: FlowNode[] | ((nodes: FlowNode[]) => FlowNode[])) => void;
  setEdges: (edges: FlowEdge[] | ((edges: FlowEdge[]) => FlowEdge[])) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  applyEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // Node Operations
  addNode: (node: FlowNode) => void;
  updateNode: (id: string, data: Partial<FlowNodeData>) => void;
  updateNodeData: (id: string, updates: Partial<FlowNodeData>) => void;
  removeNode: (id: string) => void;

  // Edge Operations
  updateEdge: (id: string, data: Partial<FlowEdgeData>) => void;
  removeEdge: (id: string) => void;

  // Graph Operations
  buildGraphPayload: () => { nodes: FlowNode[]; edges: FlowEdge[] };
  updateHasPendingChanges: (value: boolean | ((prev: boolean) => boolean)) => void;
  setGraphSnapshot: (snapshot: string) => void;
  setIsNodeDragInProgress: (inProgress: boolean) => void;
};

const GraphContext = createContext<GraphContextValue | null>(null);

export const useGraphContext = () => {
  const context = useContext(GraphContext);
  if (!context) {
    throw new Error("useGraphContext must be used within GraphProvider");
  }
  return context;
};

type GraphProviderProps = {
  children: ReactNode;
};

export const GraphProvider = ({ children }: GraphProviderProps) => {
  // ReactFlow state
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
  const [edges, setEdges, applyEdgesChange] = useEdgesState<FlowEdgeData>([]);

  // Additional graph state
  const [graphSnapshot, setGraphSnapshot] = useState<string>("");
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [isNodeDragInProgress, setIsNodeDragInProgress] = useState(false);

  // Refs for synchronization
  const nodesRef = useRef<FlowNode[]>([]);
  const edgesRef = useRef<FlowEdge[]>([]);
  const hasPendingChangesRef = useRef(false);
  const isNodeDragInProgressRef = useRef(false);

  // Sync refs with state
  nodesRef.current = nodes;
  edgesRef.current = edges;
  hasPendingChangesRef.current = hasPendingChanges;
  isNodeDragInProgressRef.current = isNodeDragInProgress;

  // Update pending changes state
  const updateHasPendingChanges = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setHasPendingChanges(value);
  }, []);

  // Handle edge changes with pending changes tracking
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      applyEdgesChange(changes);

      // Mark as pending changes when edges are removed
      const hasRemove = changes.some((change) => change.type === "remove");
      if (hasRemove) {
        updateHasPendingChanges(true);
      }
    },
    [applyEdgesChange, updateHasPendingChanges],
  );

  // Connect two nodes
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
      updateHasPendingChanges(true);
    },
    [setEdges, updateHasPendingChanges],
  );

  // Add a node to the graph
  const addNode = useCallback(
    (node: FlowNode) => {
      setNodes((nds) => [...nds, node]);
      updateHasPendingChanges(true);
    },
    [setNodes, updateHasPendingChanges],
  );

  // Update a node's full data
  const updateNode = useCallback(
    (id: string, data: Partial<FlowNodeData>) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              data: {
                ...node.data,
                ...data,
              },
            };
          }
          return node;
        }),
      );
      updateHasPendingChanges(true);
    },
    [setNodes, updateHasPendingChanges],
  );

  // Update a node's data fields
  const updateNodeData = useCallback(
    (id: string, updates: Partial<FlowNodeData>) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              data: {
                ...node.data,
                ...updates,
              },
            };
          }
          return node;
        }),
      );
      updateHasPendingChanges(true);
    },
    [setNodes, updateHasPendingChanges],
  );

  // Remove a node from the graph
  const removeNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((node) => node.id !== id));
      setEdges((eds) => eds.filter((edge) => edge.source !== id && edge.target !== id));
      updateHasPendingChanges(true);
    },
    [setNodes, setEdges, updateHasPendingChanges],
  );

  // Update an edge
  const updateEdge = useCallback(
    (id: string, data: Partial<FlowEdgeData>) => {
      setEdges((eds) =>
        eds.map((edge) => {
          if (edge.id === id) {
            return {
              ...edge,
              data: {
                ...edge.data,
                ...data,
              },
            };
          }
          return edge;
        }),
      );
      updateHasPendingChanges(true);
    },
    [setEdges, updateHasPendingChanges],
  );

  // Remove an edge from the graph
  const removeEdge = useCallback(
    (id: string) => {
      setEdges((eds) => eds.filter((edge) => edge.id !== id));
      updateHasPendingChanges(true);
    },
    [setEdges, updateHasPendingChanges],
  );

  // Build graph payload for API
  const buildGraphPayload = useCallback(() => {
    return {
      nodes: nodes,
      edges: edges,
    };
  }, [nodes, edges]);

  const value = useMemo<GraphContextValue>(
    () => ({
      // State
      nodes,
      edges,
      graphSnapshot,
      hasPendingChanges,
      isNodeDragInProgress,

      // Refs
      nodesRef,
      edgesRef,
      hasPendingChangesRef,
      isNodeDragInProgressRef,

      // Node/Edge State Management
      setNodes,
      setEdges,
      onNodesChange,
      onEdgesChange,
      applyEdgesChange,
      onConnect,

      // Node Operations
      addNode,
      updateNode,
      updateNodeData,
      removeNode,

      // Edge Operations
      updateEdge,
      removeEdge,

      // Graph Operations
      buildGraphPayload,
      updateHasPendingChanges,
      setGraphSnapshot,
      setIsNodeDragInProgress,
    }),
    [
      nodes,
      edges,
      graphSnapshot,
      hasPendingChanges,
      isNodeDragInProgress,
      setNodes,
      setEdges,
      onNodesChange,
      onEdgesChange,
      applyEdgesChange,
      onConnect,
      addNode,
      updateNode,
      updateNodeData,
      removeNode,
      updateEdge,
      removeEdge,
      buildGraphPayload,
      updateHasPendingChanges,
    ],
  );

  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>;
};
