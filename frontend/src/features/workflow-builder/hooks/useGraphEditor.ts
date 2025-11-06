import { useCallback } from "react";

import {
  MarkerType,
  type ReactFlowInstance,
  type Viewport,
} from "reactflow";

import {
  buildEdgeStyle,
  buildGraphPayloadFrom,
  buildNodeStyle,
  defaultEdgeOptions,
  extractPosition,
  humanizeSlug,
  isValidNodeKind,
  stringifyAgentParameters,
} from "../utils";
import {
  getVectorStoreNodeConfig,
  resolveStartParameters,
  resolveWidgetNodeParameters,
  setVectorStoreNodeConfig,
} from "../../../utils/workflows";
import {
  resolveAgentParameters,
  resolveStateParameters,
} from "../../../utils/agentPresets";
import {
  parseWorkflowImport,
  WorkflowImportError,
  type ParsedWorkflowImport,
} from "../importWorkflow";
import type {
  FlowEdge,
  FlowEdgeData,
  FlowNode,
  FlowNodeData,
  SaveState,
} from "../types";

type TranslationFunction = (key: string, params?: Record<string, unknown>) => string;

type UseGraphEditorParams = {
  nodeClassName: string;
  setNodes: React.Dispatch<React.SetStateAction<FlowNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<FlowEdge[]>>;
  setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedEdgeId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedNodeIdRef: React.MutableRefObject<string | null>;
  selectedEdgeIdRef: React.MutableRefObject<string | null>;
  selectedNodeIdsRef: React.MutableRefObject<Set<string>>;
  selectedEdgeIdsRef: React.MutableRefObject<Set<string>>;
  nodesRef: React.MutableRefObject<FlowNode[]>;
  edgesRef: React.MutableRefObject<FlowEdge[]>;
  reactFlowInstanceRef: React.MutableRefObject<ReactFlowInstance | null>;
  reactFlowWrapperRef: React.MutableRefObject<HTMLDivElement | null>;
  viewportRef: React.MutableRefObject<Viewport | null>;
  setSaveState: React.Dispatch<React.SetStateAction<SaveState>>;
  setSaveMessage: React.Dispatch<React.SetStateAction<string | null>>;
  updateHasPendingChanges: (value: boolean) => void;
  t: TranslationFunction;
  copySequenceRef: React.MutableRefObject<{ count: number; lastTimestamp: number }>;
};

type RemoveElementsArgs = {
  nodeIds?: Iterable<string>;
  edgeIds?: Iterable<string>;
};

type UseGraphEditorResult = {
  applySelection: (args: {
    nodeIds?: Iterable<string>;
    edgeIds?: Iterable<string>;
    primaryNodeId?: string | null;
    primaryEdgeId?: string | null;
  }) => void;
  clearSelection: () => void;
  onSelectionChange: (args: { nodes: FlowNode[]; edges: FlowEdge[] }) => void;
  removeElements: (args: RemoveElementsArgs) => void;
  copySelectionToClipboard: (args?: { includeEntireGraph?: boolean }) => Promise<boolean>;
  pasteClipboardGraph: () => Promise<boolean>;
  handleDuplicateSelection: () => boolean;
  handleDeleteSelection: () => boolean;
  resetCopySequence: () => void;
};

const useGraphEditor = ({
  nodeClassName,
  setNodes,
  setEdges,
  setSelectedNodeId,
  setSelectedEdgeId,
  selectedNodeIdRef,
  selectedEdgeIdRef,
  selectedNodeIdsRef,
  selectedEdgeIdsRef,
  nodesRef,
  edgesRef,
  reactFlowInstanceRef,
  reactFlowWrapperRef,
  viewportRef,
  setSaveState,
  setSaveMessage,
  updateHasPendingChanges,
  t,
  copySequenceRef,
}: UseGraphEditorParams): UseGraphEditorResult => {
  const applySelection = useCallback<UseGraphEditorResult["applySelection"]>(
    ({
      nodeIds = [],
      edgeIds = [],
      primaryNodeId,
      primaryEdgeId,
    }) => {
      const nodeArray = Array.from(nodeIds);
      const edgeArray = Array.from(edgeIds);
      const nodeIdSet = new Set(nodeArray);
      const edgeIdSet = new Set(edgeArray);

      selectedNodeIdsRef.current = nodeIdSet;
      selectedEdgeIdsRef.current = edgeIdSet;

      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const isSelected = nodeIdSet.has(node.id);
          const nextStyle = buildNodeStyle(node.data.kind, {
            isSelected,
          });
          const currentStyle = node.style ?? {};
          const hasSameSelection = (node.selected ?? false) === isSelected;
          const hasSameStyle =
            Object.keys(nextStyle).length === Object.keys(currentStyle).length &&
            Object.entries(nextStyle).every(
              ([key, value]) =>
                Object.prototype.hasOwnProperty.call(currentStyle, key) &&
                (currentStyle as Record<string, unknown>)[key] === value,
            );
          const hasSameClassName = node.className === nodeClassName;

          if (hasSameSelection && hasSameStyle && hasSameClassName) {
            return node;
          }

          return {
            ...node,
            selected: isSelected,
            style: nextStyle,
            className: nodeClassName,
          } satisfies FlowNode;
        }),
      );

      setEdges((currentEdges) =>
        currentEdges.map((edge) => {
          const isSelected = edgeIdSet.has(edge.id);
          if ((edge.selected ?? false) === isSelected) {
            const currentStyle = edge.style ?? {};
            const nextStyle = buildEdgeStyle({ isSelected });
            if (
              currentStyle.stroke === nextStyle.stroke &&
              currentStyle.strokeWidth === nextStyle.strokeWidth
            ) {
              return edge;
            }
          }
          return {
            ...edge,
            selected: isSelected,
            style: { ...edge.style, ...buildEdgeStyle({ isSelected }) },
          } satisfies FlowEdge;
        }),
      );

      const resolvedNodeId =
        nodeArray.length > 0
          ? primaryNodeId && nodeArray.includes(primaryNodeId)
            ? primaryNodeId
            : nodeArray[0]
          : null;

      const resolvedEdgeId =
        nodeArray.length === 0 && edgeArray.length > 0
          ? primaryEdgeId && edgeArray.includes(primaryEdgeId)
            ? primaryEdgeId
            : edgeArray[0]
          : null;

      setSelectedNodeId(resolvedNodeId);
      setSelectedEdgeId(resolvedNodeId ? null : resolvedEdgeId);
    },
    [nodeClassName, selectedEdgeIdsRef, selectedNodeIdsRef, setEdges, setNodes, setSelectedEdgeId, setSelectedNodeId],
  );

  const insertGraphElements = useCallback(
    (
      graph: ParsedWorkflowImport["graph"],
      options: {
        computeTargetCenter?: (
          selectionCenter: { x: number; y: number },
        ) => { x: number; y: number } | null;
      } = {},
    ) => {
      try {
        const { nodes: importedNodes, edges: importedEdges } = graph;

        const existingNodes = nodesRef.current;
        const existingEdges = edgesRef.current;

        const existingNodeIds = new Set(existingNodes.map((node) => node.id));
        const existingNodeSlugs = new Set(existingNodes.map((node) => node.data.slug));
        const tempNodeIds = new Set<string>();
        const slugUsage = new Map<string, number>();
        const slugMapping = new Map<string, string>();
        const startNodeExists = existingNodes.some((node) => node.data.kind === "start");

        const nodesToInsert: FlowNode[] = [];

        for (const node of importedNodes) {
          if (!isValidNodeKind(node.kind)) {
            continue;
          }
          const kind = node.kind;
          if (kind === "start" && startNodeExists) {
            continue;
          }

          const baseSlug = node.slug;
          let nextSlug = baseSlug;
          let suffix = slugUsage.get(baseSlug) ?? 0;
          while (
            existingNodeIds.has(nextSlug) ||
            existingNodeSlugs.has(nextSlug) ||
            tempNodeIds.has(nextSlug)
          ) {
            suffix += 1;
            nextSlug = `${baseSlug}-${suffix}`;
          }
          slugUsage.set(baseSlug, suffix);
          tempNodeIds.add(nextSlug);
          existingNodeIds.add(nextSlug);
          existingNodeSlugs.add(nextSlug);
          slugMapping.set(node.slug, nextSlug);

          const position = extractPosition(node.metadata) ?? { x: 0, y: 0 };
          const displayName = node.display_name ?? humanizeSlug(node.slug);
          const agentKey = kind === "agent" ? node.agent_key ?? null : null;
          const parameters =
            kind === "agent"
              ? resolveAgentParameters(agentKey, node.parameters)
              : kind === "state"
                ? resolveStateParameters(node.slug, node.parameters)
                : kind === "json_vector_store"
                  ? setVectorStoreNodeConfig({}, getVectorStoreNodeConfig(node.parameters))
                  : kind === "widget"
                    ? resolveWidgetNodeParameters(node.parameters)
                    : kind === "start"
                      ? resolveStartParameters(node.parameters)
                      : resolveAgentParameters(null, node.parameters);

          const metadata = { ...(node.metadata ?? {}) };

          nodesToInsert.push({
            id: nextSlug,
            position: { x: position.x, y: position.y },
            data: {
              slug: nextSlug,
              kind,
              displayName,
              label: displayName,
              isEnabled: node.is_enabled ?? true,
              agentKey,
              parameters,
              parametersText: stringifyAgentParameters(parameters),
              parametersError: null,
              metadata,
            },
            draggable: true,
            selected: false,
          });
        }

        if (nodesToInsert.length === 0) {
          return { success: false as const, reason: "nothing_to_insert" as const };
        }

        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const node of nodesToInsert) {
          minX = Math.min(minX, node.position.x);
          maxX = Math.max(maxX, node.position.x);
          minY = Math.min(minY, node.position.y);
          maxY = Math.max(maxY, node.position.y);
        }

        if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
          minX = 0;
          maxX = 0;
        }
        if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
          minY = 0;
          maxY = 0;
        }

        const selectionCenter = {
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
        };

        let targetCenter: { x: number; y: number } | null = null;

        if (options.computeTargetCenter) {
          targetCenter = options.computeTargetCenter(selectionCenter);
        }

        if (!targetCenter) {
          if (reactFlowInstanceRef.current && typeof window !== "undefined") {
            const wrapper = reactFlowWrapperRef.current;
            const rect = wrapper?.getBoundingClientRect();
            const clientPoint = rect
              ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
              : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            try {
              targetCenter = reactFlowInstanceRef.current.project(clientPoint);
            } catch (error) {
              console.error(error);
            }
          }
        }

        if (!targetCenter) {
          const viewport = reactFlowInstanceRef.current?.getViewport() ?? viewportRef.current;
          const wrapper = reactFlowWrapperRef.current;
          const width = wrapper?.clientWidth ?? 0;
          const height = wrapper?.clientHeight ?? 0;
          if (viewport) {
            targetCenter = {
              x: (width / 2 - viewport.x) / viewport.zoom,
              y: (height / 2 - viewport.y) / viewport.zoom,
            };
          }
        }

        const adjustedNodes = nodesToInsert.map((node) => {
          const originalSlug = slugMapping.get(node.data.slug) ?? node.data.slug;
          const mappedSlug = slugMapping.get(originalSlug) ?? node.data.slug;
          const position = targetCenter
            ? {
                x: node.position.x - selectionCenter.x + targetCenter.x,
                y: node.position.y - selectionCenter.y + targetCenter.y,
              }
            : node.position;

          return {
            ...node,
            id: mappedSlug,
            position,
            data: {
              ...node.data,
              slug: mappedSlug,
            },
          } satisfies FlowNode;
        });

        const existingEdgeIds = new Set(existingEdges.map((edge) => edge.id));
        const tempEdgeIds = new Set<string>();
        const edgesToInsert: FlowEdge[] = [];

        for (const edge of importedEdges) {
          const source = slugMapping.get(edge.source) ?? edge.source;
          const target = slugMapping.get(edge.target) ?? edge.target;
          let baseId = String(edge.metadata?.id ?? `${source}-${target}`);
          if (!baseId.trim()) {
            baseId = `${source}-${target}`;
          }

          let candidateId = baseId;
          let suffix = 1;
          while (existingEdgeIds.has(candidateId) || tempEdgeIds.has(candidateId)) {
            candidateId = `${baseId}-${suffix}`;
            suffix += 1;
          }
          tempEdgeIds.add(candidateId);
          existingEdgeIds.add(candidateId);
          const metadataLabel = edge.metadata?.label;
          const labelText =
            metadataLabel != null && String(metadataLabel).trim()
              ? String(metadataLabel).trim()
              : edge.condition ?? "";
          edgesToInsert.push({
            id: candidateId,
            source,
            target,
            label: labelText,
            data: {
              condition: edge.condition ?? null,
              metadata: edge.metadata ?? {},
            },
            markerEnd: defaultEdgeOptions.markerEnd
              ? { ...defaultEdgeOptions.markerEnd }
              : { type: MarkerType.ArrowClosed, color: "var(--text-color)" },
            style: buildEdgeStyle({ isSelected: false }),
          } satisfies FlowEdge<FlowEdgeData>);
        }

        const newNodeIds = adjustedNodes.map((node) => node.id);
        const newEdgeIds = edgesToInsert.map((edge) => edge.id);

        setNodes((current) => [...current, ...adjustedNodes]);
        setEdges((current) => [...current, ...edgesToInsert]);
        updateHasPendingChanges(true);
        applySelection({
          nodeIds: newNodeIds,
          edgeIds: newEdgeIds,
          primaryNodeId: newNodeIds[0] ?? null,
        });

        return { success: true as const, nodeIds: newNodeIds, edgeIds: newEdgeIds };
      } catch (error) {
        console.error(error);
        return { success: false as const, reason: "error" as const };
      }
    },
    [applySelection, nodesRef, edgesRef, reactFlowInstanceRef, reactFlowWrapperRef, viewportRef, setNodes, setEdges, updateHasPendingChanges],
  );

  const removeElements = useCallback(
    ({ nodeIds = [], edgeIds = [] }: RemoveElementsArgs) => {
      const nodeIdSet = new Set(nodeIds);
      const edgeIdSet = new Set(edgeIds);

      if (nodeIdSet.size === 0 && edgeIdSet.size === 0) {
        return;
      }

      const removedNodeIds: string[] = [];
      const protectedNodeIds: string[] = [];

      if (nodeIdSet.size > 0) {
        setNodes((currentNodes) => {
          let hasChanges = false;
          const nextNodes: FlowNode[] = [];
          for (const node of currentNodes) {
            if (nodeIdSet.has(node.id)) {
              if (node.data.kind === "start") {
                protectedNodeIds.push(node.id);
                nextNodes.push(node);
              } else {
                removedNodeIds.push(node.id);
                hasChanges = true;
              }
            } else {
              nextNodes.push(node);
            }
          }
          return hasChanges ? nextNodes : currentNodes;
        });
      }

      const removedNodeIdSet = new Set(removedNodeIds);
      const removedEdgeIds: string[] = [];

      setEdges((currentEdges) => {
        if (removedNodeIdSet.size === 0 && edgeIdSet.size === 0) {
          return currentEdges;
        }
        let hasChanges = false;
        const nextEdges: FlowEdge[] = [];
        for (const edge of currentEdges) {
          if (
            removedNodeIdSet.has(edge.source) ||
            removedNodeIdSet.has(edge.target) ||
            edgeIdSet.has(edge.id)
          ) {
            removedEdgeIds.push(edge.id);
            hasChanges = true;
          } else {
            nextEdges.push(edge);
          }
        }
        return hasChanges ? nextEdges : currentEdges;
      });

      if (
        removedNodeIds.length === 0 &&
        removedEdgeIds.length === 0 &&
        protectedNodeIds.length === 0
      ) {
        return;
      }

      const removedEdgeIdSet = new Set(removedEdgeIds);
      const remainingNodeIds = Array.from(selectedNodeIdsRef.current).filter(
        (id) => !removedNodeIdSet.has(id) && !protectedNodeIds.includes(id),
      );
      const remainingEdgeIds = Array.from(selectedEdgeIdsRef.current).filter(
        (id) => !removedEdgeIdSet.has(id),
      );

      applySelection({
        nodeIds: remainingNodeIds,
        edgeIds: remainingEdgeIds,
        primaryNodeId: selectedNodeIdRef.current,
        primaryEdgeId: selectedEdgeIdRef.current,
      });

      if (protectedNodeIds.length > 0) {
        setSaveState("error");
        setSaveMessage("Le bloc de démarrage ne peut pas être supprimé.");
        const clearState = () => setSaveState("idle");
        if (typeof window !== "undefined") {
          window.setTimeout(clearState, 1500);
        } else {
          setTimeout(clearState, 1500);
        }
      }
    },
    [
      applySelection,
      selectedEdgeIdRef,
      selectedEdgeIdsRef,
      selectedNodeIdRef,
      selectedNodeIdsRef,
      setEdges,
      setNodes,
      setSaveMessage,
      setSaveState,
    ],
  );

  const resetCopySequence = useCallback(() => {
    copySequenceRef.current.count = 0;
    copySequenceRef.current.lastTimestamp = 0;
  }, [copySequenceRef]);

  const copySelectionToClipboard = useCallback<UseGraphEditorResult["copySelectionToClipboard"]>(
    async ({ includeEntireGraph = false } = {}) => {
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;

      const nodeIdSet = includeEntireGraph
        ? new Set(currentNodes.map((node) => node.id))
        : new Set(selectedNodeIdsRef.current);

      if (!includeEntireGraph) {
        for (const edgeId of selectedEdgeIdsRef.current) {
          const edge = currentEdges.find((item) => item.id === edgeId);
          if (edge) {
            nodeIdSet.add(edge.source);
            nodeIdSet.add(edge.target);
          }
        }
      }

      if (nodeIdSet.size === 0) {
        setSaveState("error");
        setSaveMessage(t("workflowBuilder.clipboard.copyEmpty"));
        setTimeout(() => setSaveState("idle"), 1500);
        resetCopySequence();
        return false;
      }

      const nodesToCopy = currentNodes.filter((node) => nodeIdSet.has(node.id));
      const edgesToCopy = includeEntireGraph
        ? currentEdges
        : currentEdges.filter(
            (edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target),
          );

      const payload = buildGraphPayloadFrom(nodesToCopy, edgesToCopy);
      const serialized = JSON.stringify(payload, null, 2);

      const writeText = async () => {
        if (
          typeof navigator !== "undefined" &&
          navigator.clipboard &&
          typeof navigator.clipboard.writeText === "function"
        ) {
          await navigator.clipboard.writeText(serialized);
          return;
        }
        if (typeof document === "undefined") {
          throw new Error("Clipboard unavailable");
        }
        const textarea = document.createElement("textarea");
        textarea.value = serialized;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.top = "0";
        textarea.style.left = "0";
        textarea.style.width = "1px";
        textarea.style.height = "1px";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const successful = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!successful) {
          throw new Error("Clipboard copy failed");
        }
      };

      try {
        await writeText();
        setSaveState("saved");
        setSaveMessage(
          includeEntireGraph
            ? t("workflowBuilder.clipboard.copyAllSuccess")
            : t("workflowBuilder.clipboard.copySelectionSuccess"),
        );
        setTimeout(() => setSaveState("idle"), 1500);
        return true;
      } catch (error) {
        console.error(error);
        setSaveState("error");
        setSaveMessage(t("workflowBuilder.clipboard.copyError"));
        setTimeout(() => setSaveState("idle"), 1500);
        return false;
      } finally {
        resetCopySequence();
      }
    },
    [
      edgesRef,
      nodesRef,
      resetCopySequence,
      selectedEdgeIdsRef,
      selectedNodeIdsRef,
      setSaveMessage,
      setSaveState,
      t,
    ],
  );

  const pasteClipboardGraph = useCallback(async () => {
    const readText = async (): Promise<string | null> => {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.readText === "function"
      ) {
        try {
          return await navigator.clipboard.readText();
        } catch (error) {
          console.error(error);
        }
      }
      if (typeof document === "undefined") {
        return null;
      }
      const textarea = document.createElement("textarea");
      textarea.value = "";
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.width = "1px";
      textarea.style.height = "1px";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.focus();
      let pasted: string | null = null;
      try {
        const successful = document.execCommand("paste");
        if (successful) {
          pasted = textarea.value;
        }
      } catch (error) {
        console.error(error);
      } finally {
        document.body.removeChild(textarea);
      }
      return pasted;
    };

    try {
      const text = await readText();
      if (text === null) {
        setSaveState("error");
        setSaveMessage(t("workflowBuilder.clipboard.pasteError"));
        setTimeout(() => setSaveState("idle"), 1500);
        return false;
      }
      if (!text.trim()) {
        setSaveState("error");
        setSaveMessage(t("workflowBuilder.clipboard.pasteEmpty"));
        setTimeout(() => setSaveState("idle"), 1500);
        return false;
      }

      let parsed;
      try {
        parsed = parseWorkflowImport(text);
      } catch (error) {
        if (error instanceof WorkflowImportError) {
          setSaveState("error");
          setSaveMessage(t("workflowBuilder.clipboard.pasteInvalid"));
        } else {
          console.error(error);
          setSaveState("error");
          setSaveMessage(t("workflowBuilder.clipboard.pasteError"));
        }
        setTimeout(() => setSaveState("idle"), 1500);
        return false;
      }

      const result = insertGraphElements(parsed.graph);
      if (!result.success) {
        setSaveState("error");
        setSaveMessage(
          result.reason === "nothing_to_insert"
            ? t("workflowBuilder.clipboard.pasteNothing")
            : t("workflowBuilder.clipboard.pasteError"),
        );
        setTimeout(() => setSaveState("idle"), 1500);
        return false;
      }

      setSaveState("saved");
      setSaveMessage(t("workflowBuilder.clipboard.pasteSuccess"));
      setTimeout(() => setSaveState("idle"), 1500);
      return true;
    } catch (error) {
      console.error(error);
      setSaveState("error");
      setSaveMessage(t("workflowBuilder.clipboard.pasteError"));
      setTimeout(() => setSaveState("idle"), 1500);
      return false;
    }
  }, [insertGraphElements, setSaveMessage, setSaveState, t]);

  const handleDuplicateSelection = useCallback((): boolean => {
    const selectedNodeIds = new Set(selectedNodeIdsRef.current);
    const selectedEdgeIds = new Set(selectedEdgeIdsRef.current);

    for (const edge of edgesRef.current) {
      if (selectedEdgeIds.has(edge.id)) {
        selectedNodeIds.add(edge.source);
        selectedNodeIds.add(edge.target);
      }
    }

    if (selectedNodeIds.size === 0) {
      setSaveState("error");
      setSaveMessage(t("workflowBuilder.duplicate.empty"));
      setTimeout(() => setSaveState("idle"), 1500);
      return false;
    }

    const nodesToDuplicate = nodesRef.current.filter((node) => selectedNodeIds.has(node.id));
    if (nodesToDuplicate.length === 0) {
      setSaveState("error");
      setSaveMessage(t("workflowBuilder.duplicate.empty"));
      setTimeout(() => setSaveState("idle"), 1500);
      return false;
    }

    const edgesToDuplicate = edgesRef.current.filter(
      (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
    );

    const payload = buildGraphPayloadFrom(nodesToDuplicate, edgesToDuplicate);

    let parsed: ParsedWorkflowImport;
    try {
      parsed = parseWorkflowImport(JSON.stringify({ graph: payload }));
    } catch (error) {
      console.error(error);
      setSaveState("error");
      setSaveMessage(t("workflowBuilder.duplicate.error"));
      setTimeout(() => setSaveState("idle"), 1500);
      return false;
    }

    const result = insertGraphElements(parsed.graph, {
      computeTargetCenter: (selectionCenter) => ({
        x: selectionCenter.x + 80,
        y: selectionCenter.y + 80,
      }),
    });

    if (!result.success) {
      setSaveState("error");
      setSaveMessage(
        result.reason === "nothing_to_insert"
          ? t("workflowBuilder.duplicate.empty")
          : t("workflowBuilder.duplicate.error"),
      );
      setTimeout(() => setSaveState("idle"), 1500);
      return false;
    }

    setSaveState("saved");
    setSaveMessage(t("workflowBuilder.duplicate.success"));
    setTimeout(() => setSaveState("idle"), 1500);
    return true;
  }, [
    edgesRef,
    insertGraphElements,
    nodesRef,
    selectedEdgeIdsRef,
    selectedNodeIdsRef,
    setSaveMessage,
    setSaveState,
    t,
  ]);

  const handleDeleteSelection = useCallback((): boolean => {
    const selectedNodeIds = selectedNodeIdsRef.current;
    const selectedEdgeIds = selectedEdgeIdsRef.current;
    const hasSelection = selectedNodeIds.size > 0 || selectedEdgeIds.size > 0;

    if (!hasSelection) {
      return false;
    }

    if (selectedNodeIds.size > 0) {
      const confirmKey =
        selectedNodeIds.size > 1
          ? "workflowBuilder.deleteSelection.confirmMultiple"
          : "workflowBuilder.deleteSelection.confirmSingle";
      const confirmed = window.confirm(
        t(confirmKey, { count: selectedNodeIds.size }),
      );
      if (!confirmed) {
        return false;
      }
    }

    removeElements({
      nodeIds: selectedNodeIds,
      edgeIds: selectedEdgeIds,
    });
    updateHasPendingChanges(true);
    return true;
  }, [removeElements, selectedEdgeIdsRef, selectedNodeIdsRef, t, updateHasPendingChanges]);

  const clearSelection = useCallback(() => {
    applySelection({ nodeIds: [], edgeIds: [] });
  }, [applySelection]);

  const onSelectionChange = useCallback<UseGraphEditorResult["onSelectionChange"]>(
    ({ nodes: selectedNodes, edges: selectedEdges }) => {
      applySelection({
        nodeIds: selectedNodes.map((node) => node.id),
        edgeIds: selectedEdges.map((edge) => edge.id),
        primaryNodeId: selectedNodeIdRef.current,
        primaryEdgeId: selectedEdgeIdRef.current,
      });
    },
    [applySelection, selectedEdgeIdRef, selectedNodeIdRef],
  );

  return {
    applySelection,
    clearSelection,
    onSelectionChange,
    removeElements,
    copySelectionToClipboard,
    pasteClipboardGraph,
    handleDuplicateSelection,
    handleDeleteSelection,
    resetCopySequence,
  };
};

export default useGraphEditor;
