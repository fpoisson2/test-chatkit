/**
 * useWorkflowGraph
 *
 * Hook for managing workflow graph operations (nodes and edges).
 * Provides high-level operations for manipulating the graph structure
 * with validation and decoration.
 *
 * Responsibilities:
 * - Graph state management (nodes, edges)
 * - Node operations (add, update, remove, decorate)
 * - Edge operations (add, update, remove)
 * - ReactFlow change handlers
 * - Graph payload construction
 * - Structure validation
 *
 * @phase Phase 3.1 - Custom Hooks Creation
 */

import { useCallback, useMemo } from "react";
import type { NodeChange, EdgeChange, Connection } from "reactflow";
import { useGraphContext } from "../contexts/GraphContext";
import { validateGraphStructure } from "../utils/graphValidation";
import type { FlowNode, FlowEdge, FlowNodeData, FlowEdgeData } from "../types";

type DecoratorFunction = (node: FlowNode) => FlowNode;

type UseWorkflowGraphOptions = {
  /** Optional decorator function to apply styling/additional data to nodes */
  decorateNode?: DecoratorFunction;
  /** Callback when graph changes */
  onGraphChange?: () => void;
};

type UseWorkflowGraphReturn = {
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

  // ReactFlow handlers
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // Node operations
  addNode: (node: FlowNode) => void;
  updateNodeData: (id: string, updates: Partial<FlowNodeData>) => void;
  removeNode: (id: string) => void;
  decorateNodes: (nodes: FlowNode[]) => FlowNode[];

  // Edge operations
  updateEdge: (id: string, data: Partial<FlowEdgeData>) => void;
  removeEdge: (id: string) => void;

  // Graph operations
  buildGraphPayload: () => { nodes: FlowNode[]; edges: FlowEdge[] };
  setNodes: (nodes: FlowNode[] | ((nodes: FlowNode[]) => FlowNode[])) => void;
  setEdges: (edges: FlowEdge[] | ((edges: FlowEdge[]) => FlowEdge[])) => void;
  updateHasPendingChanges: (value: boolean | ((prev: boolean) => boolean)) => void;
  setGraphSnapshot: (snapshot: string) => void;
  setIsNodeDragInProgress: (inProgress: boolean) => void;

  // Validation
  conditionGraphError: string | null;
};

/**
 * Hook for managing the workflow graph (nodes and edges)
 *
 * @example
 * ```typescript
 * const {
 *   nodes,
 *   edges,
 *   addNode,
 *   updateNodeData,
 *   onNodesChange,
 *   conditionGraphError
 * } = useWorkflowGraph({
 *   decorateNode: myDecoratorFunction,
 *   onGraphChange: () => console.log('Graph changed')
 * });
 * ```
 */
export function useWorkflowGraph(options: UseWorkflowGraphOptions = {}): UseWorkflowGraphReturn {
  const {
    nodes,
    edges,
    graphSnapshot,
    hasPendingChanges,
    isNodeDragInProgress,
    nodesRef,
    edgesRef,
    hasPendingChangesRef,
    isNodeDragInProgressRef,
    setNodes,
    setEdges,
    onNodesChange: contextOnNodesChange,
    onEdgesChange: contextOnEdgesChange,
    onConnect: contextOnConnect,
    addNode: contextAddNode,
    updateNodeData: contextUpdateNodeData,
    removeNode: contextRemoveNode,
    updateEdge: contextUpdateEdge,
    removeEdge: contextRemoveEdge,
    buildGraphPayload: contextBuildGraphPayload,
    updateHasPendingChanges,
    setGraphSnapshot,
    setIsNodeDragInProgress,
  } = useGraphContext();

  const { decorateNode, onGraphChange } = options;

  // Wrap onNodesChange to trigger callback
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      contextOnNodesChange(changes);
      onGraphChange?.();
    },
    [contextOnNodesChange, onGraphChange],
  );

  // Wrap onEdgesChange to trigger callback
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      contextOnEdgesChange(changes);
      onGraphChange?.();
    },
    [contextOnEdgesChange, onGraphChange],
  );

  // Wrap onConnect to trigger callback
  const onConnect = useCallback(
    (connection: Connection) => {
      contextOnConnect(connection);
      onGraphChange?.();
    },
    [contextOnConnect, onGraphChange],
  );

  // Add node with optional decoration
  const addNode = useCallback(
    (node: FlowNode) => {
      const decoratedNode = decorateNode ? decorateNode(node) : node;
      contextAddNode(decoratedNode);
      onGraphChange?.();
    },
    [contextAddNode, decorateNode, onGraphChange],
  );

  // Update node data
  const updateNodeData = useCallback(
    (id: string, updates: Partial<FlowNodeData>) => {
      contextUpdateNodeData(id, updates);
      onGraphChange?.();
    },
    [contextUpdateNodeData, onGraphChange],
  );

  // Remove node
  const removeNode = useCallback(
    (id: string) => {
      contextRemoveNode(id);
      onGraphChange?.();
    },
    [contextRemoveNode, onGraphChange],
  );

  // Update edge
  const updateEdge = useCallback(
    (id: string, data: Partial<FlowEdgeData>) => {
      contextUpdateEdge(id, data);
      onGraphChange?.();
    },
    [contextUpdateEdge, onGraphChange],
  );

  // Remove edge
  const removeEdge = useCallback(
    (id: string) => {
      contextRemoveEdge(id);
      onGraphChange?.();
    },
    [contextRemoveEdge, onGraphChange],
  );

  // Decorate multiple nodes
  const decorateNodes = useCallback(
    (nodesToDecorate: FlowNode[]): FlowNode[] => {
      if (!decorateNode) {
        return nodesToDecorate;
      }
      return nodesToDecorate.map(decorateNode);
    },
    [decorateNode],
  );

  // Build graph payload
  const buildGraphPayload = useCallback(() => {
    return contextBuildGraphPayload();
  }, [contextBuildGraphPayload]);

  // Validate graph structure
  const conditionGraphError = useMemo(() => {
    return validateGraphStructure(nodes, edges);
  }, [nodes, edges]);

  return {
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

    // ReactFlow handlers
    onNodesChange,
    onEdgesChange,
    onConnect,

    // Node operations
    addNode,
    updateNodeData,
    removeNode,
    decorateNodes,

    // Edge operations
    updateEdge,
    removeEdge,

    // Graph operations
    buildGraphPayload,
    setNodes,
    setEdges,
    updateHasPendingChanges,
    setGraphSnapshot,
    setIsNodeDragInProgress,

    // Validation
    conditionGraphError,
  };
}
