/**
 * useWorkflowLoader
 *
 * Phase 6: Complex function extraction
 *
 * Hook for loading workflow versions with full ReactFlow integration.
 * Handles version loading, graph transformation, viewport management, history, and selection.
 *
 * Responsibilities:
 * - Load version details with ReactFlow node/edge transformation
 * - Load version lists with draft management
 * - Manage viewport persistence and restoration
 * - Manage history state
 * - Manage selection state after load
 * - Handle loading/error states
 *
 * This hook encapsulates ~360 lines of complex logic from WorkflowBuilderPage
 * (loadVersionDetail + loadVersions functions)
 */

import { useCallback } from "react";
import type { MarkerType } from "reactflow";
import { makeApiEndpointCandidates } from "../../../utils/backend";
import {
  backendUrl,
  isAgentKind,
  resolveDraftCandidate,
  sortVersionsWithDraftFirst,
  viewportKeyFor,
  type DeviceType,
} from "../WorkflowBuilderUtils";
import { resolveNodeParameters } from "../utils/parameterResolver";
import { stringifyAgentParameters } from "../../../utils/workflows";
import {
  buildEdgeStyle,
  buildGraphPayloadFrom,
  defaultEdgeOptions,
  extractPosition,
  humanizeSlug,
} from "../utils";
import type {
  FlowNode,
  FlowEdge,
  WorkflowVersionResponse,
  WorkflowVersionSummary,
} from "../types";
import { useGraphContext } from "../contexts/GraphContext";
import { useSaveContext } from "../contexts/SaveContext";
import { useSelectionContext } from "../contexts/SelectionContext";
import { useViewportContext } from "../contexts/ViewportContext";
import { useWorkflowContext } from "../contexts/WorkflowContext";
import type { NodeMouseHandler, EdgeMouseHandler, PaneClickHandler, OnSelectionChangeFunc } from "reactflow";

type TranslationFunction = (key: string, params?: Record<string, unknown>) => string;

type UseWorkflowLoaderParams = {
  authHeader: Record<string, string>;
  t: TranslationFunction;
  deviceType: DeviceType;
  isHydratingRef: React.MutableRefObject<boolean>;
  reactFlowInstanceRef: React.MutableRefObject<any | null>;
  resetHistory: (snapshot: string) => void;
  restoreViewport: () => void;
  applySelection: (selection: {
    nodeIds: string[];
    edgeIds: string[];
    primaryNodeId?: string | null;
    primaryEdgeId?: string | null;
  }) => void;
  decorateNode: (node: FlowNode) => FlowNode;
  draftDisplayName: string;
  persistViewportMemory: () => void;
  buildGraphPayloadFrom: typeof buildGraphPayloadFrom;
};

type UseWorkflowLoaderReturn = {
  loadVersionDetail: (
    workflowId: number,
    versionId: number,
    options?: { preserveViewport?: boolean; background?: boolean },
  ) => Promise<boolean>;
  loadVersions: (
    workflowId: number,
    preferredVersionId: number | null,
    options?: { preserveViewport?: boolean; background?: boolean },
  ) => Promise<boolean>;
};

/**
 * Helper to resolve selection after loading a version
 */
function resolveSelectionAfterLoad({
  background,
  previousNodeId,
  previousEdgeId,
  nodes,
  edges,
}: {
  background: boolean;
  previousNodeId: string | null;
  previousEdgeId: string | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
}): { nodeId: string | null; edgeId: string | null } {
  if (background) {
    // Preserve selection if elements still exist
    const nodeStillExists = previousNodeId && nodes.some((n) => n.id === previousNodeId);
    const edgeStillExists = previousEdgeId && edges.some((e) => e.id === previousEdgeId);
    return {
      nodeId: nodeStillExists ? previousNodeId : null,
      edgeId: edgeStillExists ? previousEdgeId : null,
    };
  }
  // Not background: clear selection
  return { nodeId: null, edgeId: null };
}

/**
 * Hook for loading workflow versions with full ReactFlow integration
 *
 * @example
 * ```typescript
 * const { loadVersionDetail, loadVersions } = useWorkflowLoader({
 *   authHeader,
 *   t,
 *   deviceType,
 *   isHydratingRef,
 *   reactFlowInstanceRef,
 *   resetHistory,
 *   restoreViewport,
 *   applySelection,
 *   decorateNode,
 *   draftDisplayName,
 *   persistViewportMemory,
 *   buildGraphPayloadFrom,
 * });
 *
 * // Load a specific version
 * await loadVersionDetail(workflowId, versionId);
 *
 * // Load all versions and select one
 * await loadVersions(workflowId, preferredVersionId);
 * ```
 */
export function useWorkflowLoader(params: UseWorkflowLoaderParams): UseWorkflowLoaderReturn {
  const {
    authHeader,
    t,
    deviceType,
    isHydratingRef,
    reactFlowInstanceRef,
    resetHistory,
    restoreViewport,
    applySelection,
    decorateNode,
    draftDisplayName,
    persistViewportMemory,
    buildGraphPayloadFrom: buildGraphPayloadFromFn,
  } = params;

  // Access contexts
  const { setNodes, setEdges, updateHasPendingChanges } = useGraphContext();
  const { setSaveState, setSaveMessage, lastSavedSnapshotRef } = useSaveContext();
  const { selectedNodeIdRef, selectedEdgeIdRef } = useSelectionContext();
  const {
    viewportKeyRef,
    viewportMemoryRef,
    viewportRef,
    hasUserViewportChangeRef,
    pendingViewportRestoreRef,
    setInitialViewport,
  } = useViewportContext();
  const {
    setSelectedVersionDetail,
    setLoading,
    setLoadError,
    setVersions,
    setSelectedVersionId,
    draftVersionIdRef,
    draftVersionSummaryRef,
    selectedWorkflowId,
    selectedVersionId,
  } = useWorkflowContext();

  /**
   * Load version detail with full ReactFlow transformation
   * Extracted from WorkflowBuilderPage.tsx lines 851-1034 (~184 lines)
   */
  const loadVersionDetail = useCallback(
    async (
      workflowId: number,
      versionId: number,
      options: { preserveViewport?: boolean; background?: boolean } = {},
    ): Promise<boolean> => {
      const { preserveViewport = false, background = false } = options;
      const previousSelectedNodeId = selectedNodeIdRef.current;
      const previousSelectedEdgeId = selectedEdgeIdRef.current;

      if (!background) {
        setLoading(true);
      }
      setLoadError(null);

      const candidates = makeApiEndpointCandidates(
        backendUrl,
        `/api/workflows/${workflowId}/versions/${versionId}`,
      );

      let lastError: Error | null = null;

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
          });

          if (!response.ok) {
            throw new Error(
              t("workflowBuilder.errors.loadVersionFailedWithStatus", {
                status: response.status,
              }),
            );
          }

          const data: WorkflowVersionResponse = await response.json();
          setSelectedVersionDetail(data);

          // Transform API nodes to ReactFlow nodes
          const flowNodes = data.graph.nodes.map<FlowNode>((node, index) => {
            const positionFromMetadata = extractPosition(node.metadata);
            const displayName = node.display_name ?? humanizeSlug(node.slug);
            const agentKey = isAgentKind(node.kind) ? node.agent_key ?? null : null;
            const parameters = resolveNodeParameters(
              node.kind,
              node.slug,
              agentKey,
              node.parameters
            );

            const baseNode: FlowNode = {
              id: node.slug,
              position: positionFromMetadata ?? { x: 150 * index, y: 120 * index },
              data: {
                slug: node.slug,
                kind: node.kind,
                displayName,
                label: displayName,
                isEnabled: node.is_enabled,
                agentKey,
                parameters,
                parametersText: stringifyAgentParameters(parameters),
                parametersError: null,
                metadata: node.metadata ?? {},
              },
              draggable: true,
              selected: false,
            } satisfies FlowNode;

            return decorateNode(baseNode);
          });

          // Transform API edges to ReactFlow edges
          const flowEdges = data.graph.edges.map<FlowEdge>((edge) => ({
            id: String(edge.id ?? `${edge.source}-${edge.target}-${Math.random()}`),
            source: edge.source,
            target: edge.target,
            label: edge.metadata?.label ? String(edge.metadata.label) : edge.condition ?? "",
            data: {
              condition: edge.condition,
              metadata: edge.metadata ?? {},
            },
            markerEnd: defaultEdgeOptions.markerEnd
              ? { ...defaultEdgeOptions.markerEnd }
              : { type: "arrowclosed" as any, color: "var(--text-color)" },
            style: buildEdgeStyle({ isSelected: false }),
          }));

          // Update history
          const nextSnapshot = JSON.stringify(buildGraphPayloadFromFn(flowNodes, flowEdges));
          isHydratingRef.current = true;
          lastSavedSnapshotRef.current = nextSnapshot;
          updateHasPendingChanges(false);

          if (background) {
            // Background load: use minimal history update
            // Note: historyRef is not available here, would need to pass it
            // For now, we just reset the history
            resetHistory(nextSnapshot);
          } else {
            resetHistory(nextSnapshot);
          }

          setNodes(flowNodes);
          setEdges(flowEdges);

          // Reset isHydrating after a short delay
          setTimeout(() => {
            isHydratingRef.current = false;
          }, 100);

          // Viewport management
          const viewportKey = viewportKeyFor(workflowId, versionId, deviceType);
          viewportKeyRef.current = viewportKey;
          const restoredViewport = viewportKey
            ? viewportMemoryRef.current.get(viewportKey) ?? null
            : null;

          // Update initialViewport for ReactFlow's defaultViewport prop
          if (restoredViewport) {
            setInitialViewport(restoredViewport);
          }

          if (preserveViewport) {
            if (viewportKey) {
              const currentViewport =
                reactFlowInstanceRef.current?.getViewport() ?? viewportRef.current;
              if (currentViewport) {
                viewportMemoryRef.current.set(viewportKey, { ...currentViewport });
                viewportRef.current = { ...currentViewport };
                setInitialViewport({ ...currentViewport });
              }
            }
            hasUserViewportChangeRef.current = true;
            pendingViewportRestoreRef.current = true;
          } else {
            viewportRef.current = restoredViewport;
            hasUserViewportChangeRef.current = restoredViewport != null;
            pendingViewportRestoreRef.current = restoredViewport != null;
            if (restoredViewport != null) {
              restoreViewport();
            }
          }

          // Selection management
          const { nodeId: nextSelectedNodeId, edgeId: nextSelectedEdgeId } =
            resolveSelectionAfterLoad({
              background,
              previousNodeId: previousSelectedNodeId,
              previousEdgeId: previousSelectedEdgeId,
              nodes: flowNodes,
              edges: flowEdges,
            });

          applySelection({
            nodeIds: nextSelectedNodeId ? [nextSelectedNodeId] : [],
            edgeIds: nextSelectedEdgeId ? [nextSelectedEdgeId] : [],
            primaryNodeId: previousSelectedNodeId,
            primaryEdgeId: previousSelectedEdgeId,
          });

          setSaveState("idle");
          setSaveMessage(null);

          if (!background) {
            // Wait for viewport to be applied before hiding loading
            setTimeout(() => {
              setLoading(false);
            }, 250);
          }

          return true;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            continue;
          }
          lastError =
            error instanceof Error
              ? error
              : new Error(t("workflowBuilder.errors.unknown"));
        }
      }

      // All attempts failed
      if (lastError) {
        setLoadError(lastError.message);
      }
      setSelectedVersionDetail(null);
      if (!background) {
        setLoading(false);
      }
      return false;
    },
    [
      authHeader,
      applySelection,
      decorateNode,
      deviceType,
      isHydratingRef,
      lastSavedSnapshotRef,
      resetHistory,
      restoreViewport,
      selectedEdgeIdRef,
      selectedNodeIdRef,
      setEdges,
      setInitialViewport,
      setLoadError,
      setLoading,
      setNodes,
      setSaveMessage,
      setSaveState,
      setSelectedVersionDetail,
      t,
      updateHasPendingChanges,
      viewportKeyRef,
      viewportMemoryRef,
      viewportRef,
      hasUserViewportChangeRef,
      pendingViewportRestoreRef,
      reactFlowInstanceRef,
      buildGraphPayloadFromFn,
    ],
  );

  /**
   * Load versions list with draft management and auto-selection
   * Extracted from WorkflowBuilderPage.tsx lines 1036-1211 (~175 lines)
   */
  const loadVersions = useCallback(
    async (
      workflowId: number,
      preferredVersionId: number | null = null,
      options: { preserveViewport?: boolean; background?: boolean } = {},
    ): Promise<boolean> => {
      const { preserveViewport = false, background = false } = options;

      setLoadError(null);

      const candidates = makeApiEndpointCandidates(
        backendUrl,
        `/api/workflows/${workflowId}/versions`,
      );

      let lastError: Error | null = null;

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
          });

          if (!response.ok) {
            throw new Error(
              t("workflowBuilder.errors.loadVersionsFailedWithStatus", {
                status: response.status,
              }),
            );
          }

          const data: WorkflowVersionSummary[] = await response.json();
          let versionsForState: WorkflowVersionSummary[] = [...data];

          // Draft version management
          let draftSummary = resolveDraftCandidate(versionsForState);

          if (draftSummary) {
            const normalizedDraft: WorkflowVersionSummary = {
              ...draftSummary,
              name: draftDisplayName,
            };
            versionsForState = versionsForState.map((version) =>
              version.id === normalizedDraft.id ? normalizedDraft : version,
            );
            draftVersionIdRef.current = normalizedDraft.id;
            draftVersionSummaryRef.current = normalizedDraft;
            draftSummary = normalizedDraft;
          } else if (
            draftVersionIdRef.current &&
            selectedWorkflowId === workflowId &&
            !versionsForState.some((version) => version.id === draftVersionIdRef.current)
          ) {
            // Create synthetic draft if needed
            const highestVersion = versionsForState.reduce(
              (max, version) => Math.max(max, version.version),
              0,
            );
            const syntheticDraft =
              draftVersionSummaryRef.current &&
              draftVersionSummaryRef.current.id === draftVersionIdRef.current
                ? draftVersionSummaryRef.current
                : {
                    id: draftVersionIdRef.current,
                    workflow_id: workflowId,
                    name: draftDisplayName,
                    version: highestVersion + 1,
                    is_active: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };
            draftVersionSummaryRef.current = syntheticDraft;
            versionsForState = [...versionsForState, syntheticDraft];
            draftSummary = syntheticDraft;
          } else {
            draftVersionIdRef.current = null;
            draftVersionSummaryRef.current = null;
          }

          // Sort versions with draft first
          const orderedVersions = sortVersionsWithDraftFirst(
            versionsForState,
            draftVersionIdRef.current,
          );
          setVersions(orderedVersions);

          // Handle empty versions
          if (orderedVersions.length === 0) {
            setSelectedVersionId(null);
            setNodes([]);
            setEdges([]);
            isHydratingRef.current = true;
            setTimeout(() => {
              isHydratingRef.current = false;
            }, 100);

            const emptySnapshot = JSON.stringify(buildGraphPayloadFromFn([], []));
            lastSavedSnapshotRef.current = emptySnapshot;
            resetHistory(emptySnapshot);
            updateHasPendingChanges(false);

            if (!background) {
              setLoading(false);
            }

            const emptyViewportKey = viewportKeyFor(workflowId, null, deviceType);
            viewportKeyRef.current = emptyViewportKey;
            if (emptyViewportKey) {
              viewportMemoryRef.current.delete(emptyViewportKey);
              persistViewportMemory();
            }
            viewportRef.current = null;
            hasUserViewportChangeRef.current = false;
            pendingViewportRestoreRef.current = true;
            restoreViewport();

            return true;
          }

          // Determine which version to select
          const availableIds = new Set(orderedVersions.map((version) => version.id));
          let nextVersionId: number | null = null;

          if (preferredVersionId && availableIds.has(preferredVersionId)) {
            nextVersionId = preferredVersionId;
          } else if (selectedVersionId && availableIds.has(selectedVersionId)) {
            nextVersionId = selectedVersionId;
          } else {
            const draft = draftVersionIdRef.current
              ? orderedVersions.find((version) => version.id === draftVersionIdRef.current)
              : null;
            if (draft) {
              nextVersionId = draft.id;
            } else {
              const active = orderedVersions.find((version) => version.is_active);
              nextVersionId = active?.id ?? orderedVersions[0]?.id ?? null;
            }
          }

          const matchesSelectedVersion =
            selectedVersionId != null && nextVersionId === selectedVersionId;
          const matchesPreferredVersion =
            preferredVersionId != null && nextVersionId === preferredVersionId;
          const shouldPreserveViewport =
            preserveViewport && (matchesSelectedVersion || matchesPreferredVersion);

          setSelectedVersionId(nextVersionId);

          if (nextVersionId != null) {
            await loadVersionDetail(workflowId, nextVersionId, {
              preserveViewport: shouldPreserveViewport,
              background,
            });
          } else {
            if (!background) {
              setLoading(false);
            }
          }

          return true;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            continue;
          }
          lastError =
            error instanceof Error
              ? error
              : new Error(t("workflowBuilder.errors.unknown"));
        }
      }

      // All attempts failed
      if (lastError) {
        setLoadError(lastError.message);
      }
      if (!background) {
        setLoading(false);
      }
      return false;
    },
    [
      authHeader,
      draftDisplayName,
      deviceType,
      draftVersionIdRef,
      draftVersionSummaryRef,
      selectedWorkflowId,
      selectedVersionId,
      setLoadError,
      setVersions,
      setSelectedVersionId,
      setNodes,
      setEdges,
      isHydratingRef,
      buildGraphPayloadFromFn,
      lastSavedSnapshotRef,
      resetHistory,
      updateHasPendingChanges,
      setLoading,
      viewportKeyRef,
      viewportMemoryRef,
      persistViewportMemory,
      viewportRef,
      hasUserViewportChangeRef,
      pendingViewportRestoreRef,
      restoreViewport,
      t,
      loadVersionDetail,
    ],
  );

  return {
    loadVersionDetail,
    loadVersions,
  };
}
