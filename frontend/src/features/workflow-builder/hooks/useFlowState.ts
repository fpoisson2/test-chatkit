import { useCallback, useState } from "react";
import {
  useEdgesState,
  useNodesState,
  type EdgeChange,
  type NodeChange,
} from "reactflow";
import type { FlowEdge, FlowEdgeData, FlowNode, FlowNodeData } from "../types";
import { buildNodeStyle } from "../utils";
import styles from "../WorkflowBuilderPage.module.css";

interface UseFlowStateReturn {
  // State
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // Setters
  setNodes: React.Dispatch<React.SetStateAction<FlowNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<FlowEdge[]>>;
  setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedEdgeId: React.Dispatch<React.SetStateAction<string | null>>;

  // ReactFlow handlers
  onNodesChange: (changes: NodeChange[]) => void;
  applyEdgesChange: (changes: EdgeChange[]) => void;

  // Helpers
  decorateNode: (node: FlowNode) => FlowNode;
  decorateNodes: (list: FlowNode[]) => FlowNode[];
}

/**
 * Hook to manage ReactFlow state including nodes, edges, and selections.
 */
export const useFlowState = (): UseFlowStateReturn => {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
  const [edges, setEdges, applyEdgesChange] = useEdgesState<FlowEdgeData>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const decorateNode = useCallback(
    (node: FlowNode): FlowNode => {
      return {
        ...node,
        className: styles.flowNode,
        style: buildNodeStyle(node.data.kind, {
          isSelected: node.selected ?? false,
        }),
      } satisfies FlowNode;
    },
    [],
  );

  const decorateNodes = useCallback(
    (list: FlowNode[]): FlowNode[] => list.map(decorateNode),
    [decorateNode],
  );

  return {
    nodes,
    edges,
    selectedNodeId,
    selectedEdgeId,
    setNodes,
    setEdges,
    setSelectedNodeId,
    setSelectedEdgeId,
    onNodesChange,
    applyEdgesChange,
    decorateNode,
    decorateNodes,
  };
};
