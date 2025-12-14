import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { MarkerType } from "@xyflow/react";
import { parseWorkflowImport } from "../importWorkflow";
import { resolveNodeParameters } from "../utils/parameterResolver";
import {
  extractPosition,
  humanizeSlug,
  buildEdgeStyle,
  defaultEdgeOptions,
} from "../utils";
import { stringifyAgentParameters } from "../../../utils/workflows";
import { HISTORY_LIMIT, isValidNodeKind } from "../WorkflowBuilderUtils";
import type { FlowNode, FlowEdge } from "../types";

interface HistoryState {
  past: string[];
  future: string[];
  last: string | null;
  isRestoring: boolean;
  pendingSnapshot: string | null;
}

interface UseWorkflowHistoryProps {
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<FlowEdge[]>>;
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>;
  selectedNodeIdsRef: React.MutableRefObject<Set<string>>;
  selectedEdgeIdsRef: React.MutableRefObject<Set<string>>;
  selectedNodeIdRef: React.MutableRefObject<string | null>;
  selectedEdgeIdRef: React.MutableRefObject<string | null>;
  decorateNode: (node: FlowNode) => FlowNode;
}

interface UseWorkflowHistoryReturn {
  historyRef: React.MutableRefObject<HistoryState>;
  resetHistory: (snapshot: string | null) => void;
  restoreGraphFromSnapshot: (snapshot: string) => boolean;
  undoHistory: () => boolean;
  redoHistory: () => boolean;
}

export function useWorkflowHistory({
  setNodes,
  setEdges,
  setSelectedNodeId,
  setSelectedEdgeId,
  selectedNodeIdsRef,
  selectedEdgeIdsRef,
  selectedNodeIdRef,
  selectedEdgeIdRef,
  decorateNode,
}: UseWorkflowHistoryProps): UseWorkflowHistoryReturn {
  const historyRef = useRef<HistoryState>({
    past: [],
    future: [],
    last: null,
    isRestoring: false,
    pendingSnapshot: null,
  });

  const resetHistory = useCallback((snapshot: string | null) => {
    historyRef.current.past = [];
    historyRef.current.future = [];
    historyRef.current.last = snapshot;
    historyRef.current.isRestoring = false;
    historyRef.current.pendingSnapshot = null;
  }, []);

  const restoreGraphFromSnapshot = useCallback(
    (snapshot: string): boolean => {
      let parsed;
      try {
        parsed = parseWorkflowImport(snapshot);
      } catch (error) {
        return false;
      }

      const flowNodes: FlowNode[] = parsed.graph.nodes.reduce<FlowNode[]>(
        (accumulator, node, index) => {
          if (!isValidNodeKind(node.kind)) {
            return accumulator;
          }
          const kind = node.kind;
          const positionFromMetadata = extractPosition(node.metadata);
          const position = positionFromMetadata ?? { x: 150 * index, y: 120 * index };
          const displayName = node.display_name ?? humanizeSlug(node.slug);
          const agentKey = kind === "agent" ? node.agent_key ?? null : null;
          const parameters = resolveNodeParameters(kind, node.slug, agentKey, node.parameters);
          accumulator.push(
            decorateNode({
              id: node.slug,
              position,
              data: {
                slug: node.slug,
                kind,
                displayName,
                label: displayName,
                isEnabled: node.is_enabled ?? true,
                agentKey,
                parameters,
                parametersText: stringifyAgentParameters(parameters),
                parametersError: null,
                metadata: node.metadata ?? {},
              },
              draggable: true,
              selected: false,
            }),
          );
          return accumulator;
        },
        [],
      );

      const flowEdges = parsed.graph.edges.map<FlowEdge>((edge, index) => ({
        id: String(edge.metadata?.id ?? `${edge.source}-${edge.target}-${index}`),
        source: edge.source,
        target: edge.target,
        label: edge.metadata?.label ? String(edge.metadata.label) : edge.condition ?? "",
        data: {
          condition: edge.condition ?? null,
          metadata: edge.metadata ?? {},
        },
        markerEnd: defaultEdgeOptions.markerEnd
          ? { ...defaultEdgeOptions.markerEnd }
          : { type: MarkerType.ArrowClosed, color: "var(--text-color)" },
        style: buildEdgeStyle({ isSelected: false }),
      }));

      historyRef.current.isRestoring = true;
      historyRef.current.pendingSnapshot = null;
      setNodes(flowNodes);
      setEdges(flowEdges);
      selectedNodeIdsRef.current = new Set();
      selectedEdgeIdsRef.current = new Set();
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      selectedNodeIdRef.current = null;
      selectedEdgeIdRef.current = null;
      return true;
    },
    [
      decorateNode,
      setEdges,
      setNodes,
      setSelectedEdgeId,
      setSelectedNodeId,
      selectedNodeIdsRef,
      selectedEdgeIdsRef,
      selectedNodeIdRef,
      selectedEdgeIdRef,
    ],
  );

  const undoHistory = useCallback((): boolean => {
    const history = historyRef.current;
    if (history.past.length === 0 || !history.last) {
      return false;
    }
    const previousSnapshot = history.past[history.past.length - 1];
    if (!previousSnapshot) {
      return false;
    }
    const currentSnapshot = history.last;
    const restored = restoreGraphFromSnapshot(previousSnapshot);
    if (!restored) {
      return false;
    }
    history.past = history.past.slice(0, -1);
    if (currentSnapshot) {
      history.future = [currentSnapshot, ...history.future].slice(0, HISTORY_LIMIT);
    }
    history.last = previousSnapshot;
    history.pendingSnapshot = null;
    return true;
  }, [restoreGraphFromSnapshot]);

  const redoHistory = useCallback((): boolean => {
    const history = historyRef.current;
    if (history.future.length === 0) {
      return false;
    }
    const [nextSnapshot, ...remaining] = history.future;
    if (!nextSnapshot) {
      return false;
    }
    const currentSnapshot = history.last;
    const restored = restoreGraphFromSnapshot(nextSnapshot);
    if (!restored) {
      return false;
    }
    history.future = remaining;
    if (currentSnapshot) {
      history.past = [...history.past, currentSnapshot].slice(-HISTORY_LIMIT);
    }
    history.last = nextSnapshot;
    history.pendingSnapshot = null;
    return true;
  }, [restoreGraphFromSnapshot]);

  return {
    historyRef,
    resetHistory,
    restoreGraphFromSnapshot,
    undoHistory,
    redoHistory,
  };
}
