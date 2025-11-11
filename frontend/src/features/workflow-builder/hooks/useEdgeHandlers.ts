import { useCallback } from "react";
import type { FlowEdge } from "../types";

export interface UseEdgeHandlersParams {
  setEdges: React.Dispatch<React.SetStateAction<FlowEdge[]>>;
  updateHasPendingChanges: (value: boolean) => void;
}

export interface UseEdgeHandlersReturn {
  handleConditionChange: (edgeId: string, value: string) => void;
  handleEdgeLabelChange: (edgeId: string, value: string) => void;
}

/**
 * Hook for managing edge updates (conditions and labels)
 */
export const useEdgeHandlers = ({
  setEdges,
  updateHasPendingChanges,
}: UseEdgeHandlersParams): UseEdgeHandlersReturn => {
  const handleConditionChange = useCallback(
    (edgeId: string, value: string) => {
      setEdges((current) =>
        current.map((edge) =>
          edge.id === edgeId
            ? {
                ...edge,
                label: value,
                data: { ...edge.data, condition: value || null },
              }
            : edge,
        ),
      );
      updateHasPendingChanges(true);
    },
    [setEdges, updateHasPendingChanges],
  );

  const handleEdgeLabelChange = useCallback(
    (edgeId: string, value: string) => {
      setEdges((current) =>
        current.map((edge) =>
          edge.id === edgeId
            ? {
                ...edge,
                label: value,
                data: {
                  ...edge.data,
                  metadata: { ...edge.data?.metadata, label: value },
                },
              }
            : edge,
        ),
      );
      updateHasPendingChanges(true);
    },
    [setEdges, updateHasPendingChanges],
  );

  return {
    handleConditionChange,
    handleEdgeLabelChange,
  };
};
