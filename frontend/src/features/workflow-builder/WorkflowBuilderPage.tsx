import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  addEdge,
  type Connection,
  type EdgeChange,
  type ReactFlowInstance,
  ReactFlowProvider,
  type Viewport,
  useEdgesState,
  useNodesState,
} from "reactflow";

import "reactflow/dist/style.css";

import { useAuth } from "../../auth";
import { useI18n } from "../../i18n";
import { useAppLayout, useSidebarPortal } from "../../components/AppLayout";
import {
  makeApiEndpointCandidates,
  modelRegistryApi,
  widgetLibraryApi,
  vectorStoreApi,
  type AvailableModel,
  type WidgetTemplateSummary,
  type VectorStoreSummary,
} from "../../utils/backend";
import { resolveAgentParameters, resolveStateParameters } from "../../utils/agentPresets";
import {
  getAgentFileSearchConfig,
  getAgentResponseFormat,
  setAgentContinueOnError,
  setAgentDisplayResponseInChat,
  setAgentFileSearchConfig,
  setAgentImageGenerationConfig,
  setAgentIncludeChatHistory,
  setAgentMaxOutputTokens,
  setAgentMessage,
  setAgentModel,
  setAgentReasoningEffort,
  setAgentReasoningSummary,
  setAgentTextVerbosity,
  setAgentResponseFormatKind,
  setAgentResponseFormatName,
  setAgentResponseFormatSchema,
  setAgentResponseWidgetSlug,
  setAgentResponseWidgetSource,
  setAgentResponseWidgetDefinition,
  setAgentShowSearchSources,
  setAgentStorePreference,
  setAgentTemperature,
  setAgentTopP,
  setAgentWeatherToolEnabled,
  setAgentWidgetValidationToolEnabled,
  setAgentWebSearchConfig,
  setStateAssignments,
  setStartAutoRun,
  setStartAutoRunMessage,
  setStartAutoRunAssistantMessage,
  setConditionMode,
  setConditionPath,
  setConditionValue,
  stringifyAgentParameters,
  createVectorStoreNodeParameters,
  getVectorStoreNodeConfig,
  setVectorStoreNodeConfig,
  setEndMessage,
  setAssistantMessage,
  setAssistantMessageStreamDelay,
  setAssistantMessageStreamEnabled,
  setWaitForUserInputMessage,
  setUserMessage,
  DEFAULT_END_MESSAGE,
  createWidgetNodeParameters,
  resolveWidgetNodeParameters,
  setWidgetNodeAwaitAction,
  setWidgetNodeSlug,
  setWidgetNodeSource,
  setWidgetNodeDefinitionExpression,
  setWidgetNodeVariables,
} from "../../utils/workflows";
import EdgeInspector from "./components/EdgeInspector";
import NodeInspector from "./components/NodeInspector";
import { parseWorkflowImport, WorkflowImportError } from "./importWorkflow";
import type {
  AgentParameters,
  FileSearchConfig,
  ImageGenerationToolConfig,
  FlowEdge,
  FlowEdgeData,
  FlowNode,
  FlowNodeData,
  NodeKind,
  SaveState,
  StateAssignment,
  StateAssignmentScope,
  VectorStoreNodeConfig,
  WebSearchConfig,
  WorkflowSummary,
  WorkflowVersionResponse,
  WorkflowVersionSummary,
  WidgetVariableAssignment,
} from "./types";
import {
  AUTO_SAVE_DELAY_MS,
  buildEdgeStyle,
  buildGraphPayloadFrom,
  buildNodeStyle,
  connectionLineStyle,
  extractPosition,
  humanizeSlug,
  labelForKind,
  NODE_COLORS,
  slugifyWorkflowName,
  supportsReasoningModel,
  defaultEdgeOptions,
  resolveSelectionAfterLoad,
} from "./utils";
import {
  controlLabelStyle,
  getActionMenuItemStyle,
  getActionMenuStyle,
  getCreateWorkflowButtonStyle,
  getDeployButtonStyle,
  getHeaderActionAreaStyle,
  getHeaderContainerStyle,
  getHeaderGroupStyle,
  getHeaderLayoutStyle,
  getHeaderNavigationButtonStyle,
  getVersionSelectStyle,
  loadingStyle,
} from "./styles";
import styles from "./WorkflowBuilderPage.module.css";

const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();
const DESKTOP_MIN_VIEWPORT_ZOOM = 0.1;
const MOBILE_MIN_VIEWPORT_ZOOM = 0.05;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

type WorkflowViewportRecord = {
  workflow_id: number;
  version_id: number | null;
  x: number;
  y: number;
  zoom: number;
};

type WorkflowViewportListResponse = {
  viewports: WorkflowViewportRecord[];
};

const viewportKeyFor = (workflowId: number | null, versionId: number | null) =>
  workflowId != null ? `${workflowId}:${versionId ?? "latest"}` : null;

const parseViewportKey = (
  key: string,
): { workflowId: number; versionId: number | null } | null => {
  const [workflowPart, versionPart] = key.split(":");
  const workflowId = Number.parseInt(workflowPart ?? "", 10);
  if (!Number.isFinite(workflowId)) {
    return null;
  }
  if (!versionPart || versionPart === "latest") {
    return { workflowId, versionId: null };
  }
  const versionId = Number.parseInt(versionPart, 10);
  if (!Number.isFinite(versionId)) {
    return null;
  }
  return { workflowId, versionId };
};

const versionSummaryFromResponse = (
  definition: WorkflowVersionResponse,
): WorkflowVersionSummary => ({
  id: definition.id,
  workflow_id: definition.workflow_id,
  name: definition.name,
  version: definition.version,
  is_active: definition.is_active,
  created_at: definition.created_at,
  updated_at: definition.updated_at,
});

const resolveDraftCandidate = (
  versions: WorkflowVersionSummary[],
): WorkflowVersionSummary | null => {
  if (versions.length === 0) {
    return null;
  }
  const activeVersionNumber =
    versions.find((version) => version.is_active)?.version ?? 0;
  const draftCandidates = versions.filter(
    (version) => !version.is_active && version.version > activeVersionNumber,
  );
  if (draftCandidates.length === 0) {
    return null;
  }
  return draftCandidates.reduce((latest, current) =>
    current.version > latest.version ? current : latest,
  );
};

const sortVersionsWithDraftFirst = (
  versions: WorkflowVersionSummary[],
  draftId: number | null,
): WorkflowVersionSummary[] => {
  const items = [...versions];
  const originalOrder = new Map(items.map((version, index) => [version.id, index]));
  items.sort((a, b) => {
    if (draftId != null) {
      if (a.id === draftId && b.id !== draftId) {
        return -1;
      }
      if (b.id === draftId && a.id !== draftId) {
        return 1;
      }
    }
    if (a.version !== b.version) {
      return b.version - a.version;
    }
    if (a.is_active && !b.is_active) {
      return -1;
    }
    if (b.is_active && !a.is_active) {
      return 1;
    }
    const aUpdatedAt = new Date(a.updated_at).getTime();
    const bUpdatedAt = new Date(b.updated_at).getTime();
    if (aUpdatedAt !== bUpdatedAt) {
      return bUpdatedAt - aUpdatedAt;
    }
    const aIndex = originalOrder.get(a.id) ?? 0;
    const bIndex = originalOrder.get(b.id) ?? 0;
    return aIndex - bIndex;
  });
  return items;
};

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQueryList = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    setMatches(mediaQueryList.matches);
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handleChange);
      return () => mediaQueryList.removeEventListener("change", handleChange);
    }
    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList.removeListener(handleChange);
  }, [query]);

  return matches;
};

const WorkflowBuilderPage = () => {
  const { token, logout, user } = useAuth();
  const { t } = useI18n();
  const autoSaveSuccessMessage = t("workflowBuilder.save.autoSaveSuccess");
  const draftDisplayName = t("workflowBuilder.save.draftDisplayName");
  const saveFailureMessage = t("workflowBuilder.save.failure");
  const formatSaveFailureWithStatus = useCallback(
    (status: number) => t("workflowBuilder.save.failureWithStatus", { status }),
    [t],
  );
  const authHeader = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );
  const { openSidebar } = useAppLayout();
  const { setSidebarContent, clearSidebarContent } = useSidebarPortal();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
  const [edges, setEdges, applyEdgesChange] = useEdgesState<FlowEdgeData>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [versions, setVersions] = useState<WorkflowVersionSummary[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [vectorStores, setVectorStores] = useState<VectorStoreSummary[]>([]);
  const [vectorStoresLoading, setVectorStoresLoading] = useState(false);
  const [vectorStoresError, setVectorStoresError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [availableModelsLoading, setAvailableModelsLoading] = useState(false);
  const [availableModelsError, setAvailableModelsError] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<WidgetTemplateSummary[]>([]);
  const [widgetsLoading, setWidgetsLoading] = useState(false);
  const [widgetsError, setWidgetsError] = useState<string | null>(null);
  const [openWorkflowMenuId, setOpenWorkflowMenuId] = useState<number | null>(null);
  const [isDeployModalOpen, setDeployModalOpen] = useState(false);
  const [deployToProduction, setDeployToProduction] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const draftVersionIdRef = useRef<number | null>(null);
  const draftVersionSummaryRef = useRef<WorkflowVersionSummary | null>(null);
  const selectedVersionIdRef = useRef<number | null>(null);
  const isCreatingDraftRef = useRef(false);
  const isHydratingRef = useRef(false);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const viewportMemoryRef = useRef(new Map<string, Viewport>());
  const viewportKeyRef = useRef<string | null>(null);
  const hasUserViewportChangeRef = useRef(false);
  const pendingViewportRestoreRef = useRef(false);
  const reactFlowWrapperRef = useRef<HTMLDivElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const blockLibraryScrollRef = useRef<HTMLDivElement | null>(null);
  const blockLibraryItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const blockLibraryAnimationFrameRef = useRef<number | null>(null);

  const isMobileLayout = useMediaQuery("(max-width: 768px)");
  const baseMinViewportZoom = useMemo(
    () => (isMobileLayout ? MOBILE_MIN_VIEWPORT_ZOOM : DESKTOP_MIN_VIEWPORT_ZOOM),
    [isMobileLayout],
  );
  const [minViewportZoom, setMinViewportZoom] = useState(baseMinViewportZoom);

  const persistViewportMemory = useCallback(() => {
    if (!token) {
      return;
    }
    const payload = Array.from(viewportMemoryRef.current.entries()).reduce<
      WorkflowViewportRecord[]
    >((accumulator, [key, viewport]) => {
      const parsedKey = parseViewportKey(key);
      if (!parsedKey) {
        return accumulator;
      }
      if (
        !isFiniteNumber(viewport.x) ||
        !isFiniteNumber(viewport.y) ||
        !isFiniteNumber(viewport.zoom)
      ) {
        return accumulator;
      }
      accumulator.push({
        workflow_id: parsedKey.workflowId,
        version_id: parsedKey.versionId,
        x: viewport.x,
        y: viewport.y,
        zoom: viewport.zoom,
      });
      return accumulator;
    }, []);

    const candidates = makeApiEndpointCandidates(
      backendUrl,
      "/api/workflows/viewports",
    );

    void (async () => {
      let lastError: unknown = null;
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify({ viewports: payload }),
          });
          if (!response.ok) {
            throw new Error(
              `Échec de la sauvegarde du viewport (${response.status})`,
            );
          }
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          lastError = error;
        }
      }
      if (lastError) {
        console.error(lastError);
      }
    })();
  }, [authHeader, backendUrl, token]);

  const refreshViewportConstraints = useCallback(
    (_flowInstance?: ReactFlowInstance | null) => {
      const applyMinZoom = (value: number) => {
        setMinViewportZoom((current) =>
          Math.abs(current - value) > 0.0001 ? value : current,
        );
        return value;
      };

      return applyMinZoom(baseMinViewportZoom);
    },
    [baseMinViewportZoom],
  );

  const restoreViewport = useCallback(() => {
    const instance = reactFlowInstanceRef.current;
    if (!instance) {
      pendingViewportRestoreRef.current = true;
      return;
    }

    const applyViewport = () => {
      const flow = reactFlowInstanceRef.current;
      if (!flow) {
        return;
      }
      pendingViewportRestoreRef.current = false;
      const effectiveMinZoom = refreshViewportConstraints(flow);
      const savedViewport = viewportRef.current;

      if (savedViewport) {
        const targetViewport = {
          ...savedViewport,
          zoom: Math.max(savedViewport.zoom, effectiveMinZoom),
        };

        // Apply viewport multiple times to ensure it sticks
        flow.setViewport(targetViewport, { duration: 0 });

        // Reapply after a short delay to override any automatic adjustments
        setTimeout(() => {
          flow.setViewport(targetViewport, { duration: 0 });
        }, 10);

        setTimeout(() => {
          flow.setViewport(targetViewport, { duration: 0 });
        }, 50);

        setTimeout(() => {
          flow.setViewport(targetViewport, { duration: 0 });
          const actualViewport = flow.getViewport();
          console.log('VIEWPORT CHECK:', {
            target: targetViewport,
            actual: actualViewport,
            match: Math.abs(actualViewport.x - targetViewport.x) < 1 &&
                   Math.abs(actualViewport.y - targetViewport.y) < 1
          });
        }, 100);
      }

      const appliedViewport = flow.getViewport();

      viewportRef.current = appliedViewport;
      const key = viewportKeyRef.current;
      if (key && savedViewport) {
        viewportMemoryRef.current.set(key, { ...appliedViewport });
      }
    };

    if (typeof window === "undefined") {
      applyViewport();
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(applyViewport);
    });
  }, [persistViewportMemory, refreshViewportConstraints]);

  useEffect(() => {
    viewportMemoryRef.current.clear();
    if (!token) {
      return;
    }

    const controller = new AbortController();
    let isActive = true;

    const loadViewports = async () => {
      const candidates = makeApiEndpointCandidates(
        backendUrl,
        "/api/workflows/viewports",
      );
      let lastError: unknown = null;
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(
              `Échec du chargement des viewports (${response.status})`,
            );
          }
          const data: WorkflowViewportListResponse = await response.json();
          if (!isActive) {
            return;
          }
          viewportMemoryRef.current.clear();
          for (const entry of data.viewports ?? []) {
            if (
              typeof entry.workflow_id !== "number" ||
              !Number.isFinite(entry.workflow_id)
            ) {
              continue;
            }
            if (
              !isFiniteNumber(entry.x) ||
              !isFiniteNumber(entry.y) ||
              !isFiniteNumber(entry.zoom)
            ) {
              continue;
            }
            // Skip default viewport values (0, 0, 1) as they indicate no user preference
            if (entry.x === 0 && entry.y === 0 && entry.zoom === 1) {
              continue;
            }
            const versionId =
              typeof entry.version_id === "number" && Number.isFinite(entry.version_id)
                ? entry.version_id
                : null;
            const key = viewportKeyFor(entry.workflow_id, versionId);
            if (key) {
              viewportMemoryRef.current.set(key, {
                x: entry.x,
                y: entry.y,
                zoom: entry.zoom,
              });
            }
          }
          const activeKey = viewportKeyRef.current;
          if (activeKey) {
            const restoredViewport = viewportMemoryRef.current.get(activeKey) ?? null;
            if (restoredViewport && !hasUserViewportChangeRef.current) {
              viewportRef.current = { ...restoredViewport };
              hasUserViewportChangeRef.current = true;
              pendingViewportRestoreRef.current = true;
              restoreViewport();
            }
          }
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          lastError = error;
        }
      }
      if (lastError) {
        console.error(lastError);
      }
    };

    void loadViewports();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [authHeader, backendUrl, restoreViewport, token]);

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdgeData>[]) => {
      if (changes.some((change) => change.type !== "select")) {
        setHasPendingChanges(true);
      }
      applyEdgesChange(changes);
    },
    [applyEdgesChange, setHasPendingChanges],
  );

  const [isBlockLibraryOpen, setBlockLibraryOpen] = useState<boolean>(() => !isMobileLayout);
  const blockLibraryToggleRef = useRef<HTMLButtonElement | null>(null);
  const propertiesPanelToggleRef = useRef<HTMLButtonElement | null>(null);
  const propertiesPanelCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isPropertiesPanelOpen, setPropertiesPanelOpen] = useState(false);
  const previousSelectedElementRef = useRef<string | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const selectedEdgeIdRef = useRef<string | null>(null);
  const selectedNodeIdsRef = useRef<Set<string>>(new Set());
  const selectedEdgeIdsRef = useRef<Set<string>>(new Set());
  const isNodeDragInProgressRef = useRef(false);
  const copySequenceRef = useRef<{ count: number; lastTimestamp: number }>({
    count: 0,
    lastTimestamp: 0,
  });
  const isAuthenticated = Boolean(user);
  const isAdmin = Boolean(user?.is_admin);
  const blockLibraryId = "workflow-builder-block-library";
  const propertiesPanelId = "workflow-builder-properties-panel";
  const propertiesPanelTitleId = `${propertiesPanelId}-title`;
  const toggleBlockLibrary = useCallback(() => {
    setBlockLibraryOpen((prev) => !prev);
  }, []);
  const closeBlockLibrary = useCallback(
    (options: { focusToggle?: boolean } = {}) => {
      setBlockLibraryOpen(false);
      if (options.focusToggle && blockLibraryToggleRef.current) {
        blockLibraryToggleRef.current.focus();
      }
    },
    [blockLibraryToggleRef],
  );

  useEffect(() => {
    setMinViewportZoom(baseMinViewportZoom);
  }, [baseMinViewportZoom]);

  useEffect(() => {
    setBlockLibraryOpen(!isMobileLayout);
  }, [isMobileLayout]);

  useEffect(() => {
    draftVersionIdRef.current = null;
    draftVersionSummaryRef.current = null;
  }, [selectedWorkflowId]);

  useEffect(() => {
    if (!isMobileLayout || !isBlockLibraryOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBlockLibrary({ focusToggle: true });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeBlockLibrary, isBlockLibraryOpen, isMobileLayout]);

  useEffect(() => {
    if (!isBlockLibraryOpen) {
      setOpenWorkflowMenuId(null);
    }
  }, [isBlockLibraryOpen]);

  useEffect(() => {
    if (workflows.length === 0) {
      setOpenWorkflowMenuId(null);
    }
  }, [workflows.length]);

  useEffect(() => {
    if (openWorkflowMenuId === null) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (
        target.closest('[data-workflow-menu]') ||
        target.closest('[data-workflow-menu-trigger]')
      ) {
        return;
      }
      setOpenWorkflowMenuId(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenWorkflowMenuId(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openWorkflowMenuId]);

  const applySelection = useCallback(
    ({
      nodeIds = [],
      edgeIds = [],
      primaryNodeId,
      primaryEdgeId,
    }: {
      nodeIds?: Iterable<string>;
      edgeIds?: Iterable<string>;
      primaryNodeId?: string | null;
      primaryEdgeId?: string | null;
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
          const nextStyle = buildNodeStyle(node.data.kind, { isSelected });
          const currentStyle = node.style ?? {};
          const hasSameSelection = (node.selected ?? false) === isSelected;
          const hasSameStyle =
            Object.keys(nextStyle).length === Object.keys(currentStyle).length &&
            Object.entries(nextStyle).every(
              ([key, value]) =>
                Object.prototype.hasOwnProperty.call(currentStyle, key) &&
                (currentStyle as Record<string, unknown>)[key] === value,
            );

          if (hasSameSelection && hasSameStyle) {
            return node;
          }

          return {
            ...node,
            selected: isSelected,
            style: nextStyle,
          } satisfies FlowNode;
        })
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
        })
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
    [setEdges, setNodes, setSelectedEdgeId, setSelectedNodeId],
  );

  const renderWorkflowDescription = (className?: string) =>
    selectedWorkflow?.description ? (
      <div className={className} style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
        {selectedWorkflow.description}
      </div>
    ) : null;

  const renderWorkflowPublicationReminder = (className?: string) =>
    selectedWorkflow && !selectedWorkflow.active_version_id ? (
      <div className={className} style={{ color: "#b45309", fontSize: "0.85rem", fontWeight: 600 }}>
        Publiez une version pour l'utiliser.
      </div>
    ) : null;

  const renderHeaderControls = () => (
    <>
      <div style={getHeaderLayoutStyle(isMobileLayout)}>
        <div style={getHeaderGroupStyle(isMobileLayout)}>
          {!isMobileLayout ? (
            <label htmlFor="version-select" style={controlLabelStyle}>
              Révision
            </label>
          ) : null}
          <select
            id="version-select"
            aria-label={isMobileLayout ? "Sélectionner une révision" : undefined}
            value={selectedVersionId ? String(selectedVersionId) : ""}
            onChange={handleVersionChange}
            disabled={loading || versions.length === 0}
            style={getVersionSelectStyle(isMobileLayout, {
              disabled: loading || versions.length === 0,
            })}
          >
            {versions.length === 0 ? (
              <option value="">Aucune version disponible</option>
            ) : (
              versions.map((version) => {
                const isDraft = draftVersionIdRef.current === version.id;
                const displayName = version.name?.trim() || null;
                const labelParts: string[] = [];
                if (isDraft) {
                  labelParts.push(displayName ?? draftDisplayName);
                } else {
                  labelParts.push(`v${version.version}`);
                  if (
                    displayName &&
                    (!version.is_active || displayName.toLowerCase() !== "production")
                  ) {
                    labelParts.push(displayName);
                  }
                }
                if (version.is_active) {
                  labelParts.push("Production");
                }
                return (
                  <option key={version.id} value={version.id}>
                    {labelParts.join(" · ")}
                  </option>
                );
              })
            )}
          </select>
        </div>
      </div>
      <div style={getHeaderActionAreaStyle(isMobileLayout)}>
        <button
          type="button"
          onClick={handleTriggerImport}
          disabled={loading || isImporting}
          aria-busy={isImporting}
          style={getDeployButtonStyle(isMobileLayout, {
            disabled: loading || isImporting,
          })}
        >
          {isImporting
            ? t("workflowBuilder.import.inProgress")
            : t("workflowBuilder.actions.importJson")}
        </button>
        <button
          type="button"
          onClick={() => void handleExportWorkflow()}
          disabled={
            loading ||
            !selectedWorkflowId ||
            !selectedVersionId ||
            isExporting
          }
          aria-busy={isExporting}
          style={getDeployButtonStyle(isMobileLayout, {
            disabled:
              loading ||
              !selectedWorkflowId ||
              !selectedVersionId ||
              isExporting,
          })}
        >
          {isExporting
            ? t("workflowBuilder.export.preparing")
            : t("workflowBuilder.actions.exportJson")}
        </button>
        <input
          ref={importFileInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => {
            void handleImportFileChange(event);
          }}
        />
        <button
          type="button"
          onClick={handleOpenDeployModal}
          disabled={loading || !selectedWorkflowId || versions.length === 0 || isDeploying}
          style={getDeployButtonStyle(isMobileLayout, {
            disabled: loading || !selectedWorkflowId || versions.length === 0 || isDeploying,
          })}
        >
          Déployer
        </button>
      </div>
    </>
  );

  const reactFlowContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      reactFlowWrapperRef.current = node;
      if (node) {
        refreshViewportConstraints();
      }
    },
    [refreshViewportConstraints],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleResize = () => {
      refreshViewportConstraints();
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [refreshViewportConstraints]);

  useEffect(() => {
    refreshViewportConstraints();
  }, [nodes, isMobileLayout, refreshViewportConstraints]);



  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflows],
  );

  const isReasoningModel = useCallback(
    (model: string): boolean => {
      const trimmed = model.trim();
      if (!trimmed) {
        return true;
      }
      const match = availableModels.find((item) => item.name === trimmed);
      if (match) {
        return match.supports_reasoning;
      }
      return supportsReasoningModel(trimmed);
    },
    [availableModels],
  );

  useEffect(() => {
    let isMounted = true;
    if (!token) {
      setVectorStores([]);
      setVectorStoresLoading(false);
      setVectorStoresError(null);
      return () => {
        isMounted = false;
      };
    }

    setVectorStoresLoading(true);
    setVectorStoresError(null);
    vectorStoreApi
      .listStores(token)
      .then((stores) => {
        if (isMounted) {
          setVectorStores(stores);
        }
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Impossible de charger les vector stores.";
        setVectorStoresError(message);
        setVectorStores([]);
      })
      .finally(() => {
        if (isMounted) {
          setVectorStoresLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    let isMounted = true;
    if (!token) {
      setAvailableModels([]);
      setAvailableModelsLoading(false);
      setAvailableModelsError(null);
      return () => {
        isMounted = false;
      };
    }

    setAvailableModelsLoading(true);
    setAvailableModelsError(null);
    modelRegistryApi
      .list(token)
      .then((models) => {
        if (!isMounted) {
          return;
        }
        setAvailableModels(models);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Impossible de charger les modèles autorisés.";
        setAvailableModelsError(message);
        setAvailableModels([]);
      })
      .finally(() => {
        if (isMounted) {
          setAvailableModelsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    let isMounted = true;
    if (!token) {
      setWidgets([]);
      setWidgetsLoading(false);
      setWidgetsError(null);
      return () => {
        isMounted = false;
      };
    }

    setWidgetsLoading(true);
    setWidgetsError(null);
    widgetLibraryApi
      .listWorkflowWidgets(token)
      .then((items) => {
        if (!isMounted) {
          return;
        }
        setWidgets(items);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Impossible de charger la bibliothèque de widgets.";
        setWidgetsError(message);
        setWidgets([]);
      })
      .finally(() => {
        if (isMounted) {
          setWidgetsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

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
            throw new Error(`Échec du chargement de la version (${response.status})`);
          }
          const data: WorkflowVersionResponse = await response.json();
          const flowNodes = data.graph.nodes.map<FlowNode>((node, index) => {
            const positionFromMetadata = extractPosition(node.metadata);
            const displayName = node.display_name ?? humanizeSlug(node.slug);
            const agentKey = node.kind === "agent" ? node.agent_key ?? null : null;
            const parameters =
              node.kind === "agent"
                ? resolveAgentParameters(agentKey, node.parameters)
                : node.kind === "state"
                  ? resolveStateParameters(node.slug, node.parameters)
                  : node.kind === "json_vector_store"
                    ? setVectorStoreNodeConfig(
                        {},
                        getVectorStoreNodeConfig(node.parameters),
                      )
                    : node.kind === "widget"
                      ? resolveWidgetNodeParameters(node.parameters)
                      : resolveAgentParameters(null, node.parameters);
            return {
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
              style: buildNodeStyle(node.kind, { isSelected: false }),
            } satisfies FlowNode;
          });
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
              : { type: MarkerType.ArrowClosed, color: "var(--text-color)" },
            style: buildEdgeStyle({ isSelected: false }),
          }));
          const nextSnapshot = JSON.stringify(buildGraphPayloadFrom(flowNodes, flowEdges));
          isHydratingRef.current = true;
          lastSavedSnapshotRef.current = nextSnapshot;
          setHasPendingChanges(false);
          console.log('Loading nodes with positions:', flowNodes.map(n => ({ id: n.id, pos: n.position })));
          setNodes(flowNodes);
          setEdges(flowEdges);
          // Reset isHydrating after a short delay to allow viewport restoration
          setTimeout(() => {
            isHydratingRef.current = false;
          }, 100);
          const viewportKey = viewportKeyFor(workflowId, versionId);
          viewportKeyRef.current = viewportKey;
          const restoredViewport = viewportKey
            ? viewportMemoryRef.current.get(viewportKey) ?? null
            : null;
          if (preserveViewport) {
            if (viewportKey) {
              const currentViewport =
                reactFlowInstanceRef.current?.getViewport() ?? viewportRef.current;
              if (currentViewport) {
                viewportMemoryRef.current.set(viewportKey, { ...currentViewport });
                viewportRef.current = { ...currentViewport };
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
            setLoading(false);
          }
          return true;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            continue;
          }
          lastError = error instanceof Error ? error : new Error("Erreur inconnue");
        }
      }
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
      applySelection,
      persistViewportMemory,
      restoreViewport,
      setEdges,
      setHasPendingChanges,
      setNodes,
    ],
  );

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
            throw new Error(`Échec du chargement des versions (${response.status})`);
          }
          const data: WorkflowVersionSummary[] = await response.json();
          let versionsForState: WorkflowVersionSummary[] = [...data];

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

          const orderedVersions = sortVersionsWithDraftFirst(
            versionsForState,
            draftVersionIdRef.current,
          );
          setVersions(orderedVersions);

          if (orderedVersions.length === 0) {
            setSelectedVersionId(null);
            setNodes([]);
            setEdges([]);
            isHydratingRef.current = true;
            setTimeout(() => {
              isHydratingRef.current = false;
            }, 100);
            lastSavedSnapshotRef.current = JSON.stringify(buildGraphPayloadFrom([], []));
            setHasPendingChanges(false);
            if (!background) {
              setLoading(false);
            }
            const emptyViewportKey = viewportKeyFor(workflowId, null);
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
              background: shouldPreserveViewport && background,
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
          lastError = error instanceof Error ? error : new Error("Erreur inconnue");
        }
      }
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
      loadVersionDetail,
      persistViewportMemory,
      restoreViewport,
      selectedWorkflowId,
      selectedVersionId,
      setEdges,
      setHasPendingChanges,
      setNodes,
    ],
  );

  const loadWorkflows = useCallback(
    async (
      options: {
        selectWorkflowId?: number | null;
        selectVersionId?: number | null;
        excludeWorkflowId?: number | null;
      } = {},
    ): Promise<void> => {
      setLoading(true);
      setLoadError(null);
      const candidates = makeApiEndpointCandidates(backendUrl, "/api/workflows");
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
            throw new Error(`Échec du chargement de la bibliothèque (${response.status})`);
          }
          const data: WorkflowSummary[] = await response.json();
          setWorkflows(data);
          if (data.length === 0) {
            setSelectedWorkflowId(null);
            setSelectedVersionId(null);
            setVersions([]);
            setNodes([]);
            setEdges([]);
            isHydratingRef.current = true;
            setTimeout(() => {
              isHydratingRef.current = false;
            }, 100);
            lastSavedSnapshotRef.current = JSON.stringify(buildGraphPayloadFrom([], []));
            setHasPendingChanges(false);
            setLoading(false);
            viewportKeyRef.current = null;
            viewportRef.current = null;
            viewportMemoryRef.current.clear();
            persistViewportMemory();
            hasUserViewportChangeRef.current = false;
            pendingViewportRestoreRef.current = true;
            restoreViewport();
            return;
          }
          const availableIds = new Set(data.map((workflow) => workflow.id));
          const excluded = options.excludeWorkflowId ?? null;
          const chatkitWorkflow = data.find(
            (workflow) =>
              workflow.is_chatkit_default &&
              workflow.id !== excluded &&
              availableIds.has(workflow.id),
          );
          let nextWorkflowId = options.selectWorkflowId ?? null;
          if (
            nextWorkflowId &&
            (!availableIds.has(nextWorkflowId) || (excluded != null && nextWorkflowId === excluded))
          ) {
            nextWorkflowId = null;
          }
          if (
            nextWorkflowId == null &&
            selectedWorkflowId &&
            availableIds.has(selectedWorkflowId) &&
            (excluded == null || selectedWorkflowId !== excluded)
          ) {
            nextWorkflowId = selectedWorkflowId;
          }
          if (nextWorkflowId == null) {
            const fallback = chatkitWorkflow ?? data.find((workflow) => workflow.id !== excluded);
            nextWorkflowId = fallback?.id ?? data[0]?.id ?? null;
          }
          setSelectedWorkflowId(nextWorkflowId);
          if (nextWorkflowId != null) {
            await loadVersions(nextWorkflowId, options.selectVersionId ?? null);
          } else {
            setLoading(false);
          }
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            continue;
          }
          lastError = error instanceof Error ? error : new Error("Erreur inconnue");
        }
      }
      if (lastError) {
        setLoadError(lastError.message);
      }
      setLoading(false);
    },
    [
      authHeader,
      loadVersions,
      persistViewportMemory,
      restoreViewport,
      selectedWorkflowId,
      setEdges,
      setHasPendingChanges,
      setNodes,
    ],
  );

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge<FlowEdgeData>(
          {
            ...connection,
            id: `edge-${Date.now()}`,
            label: "",
            data: { condition: "", metadata: {} },
            markerEnd: defaultEdgeOptions.markerEnd
              ? { ...defaultEdgeOptions.markerEnd }
              : { type: MarkerType.ArrowClosed, color: "var(--text-color)" },
            style: buildEdgeStyle({ isSelected: false }),
          },
          current
        )
      );
      setHasPendingChanges(true);
    },
    [setEdges, setHasPendingChanges]
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  );

  const handleNodeClick = useCallback((_: unknown, node: FlowNode) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const handleEdgeClick = useCallback((_: unknown, edge: FlowEdge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const handleClearSelection = useCallback(() => {
    applySelection({ nodeIds: [], edgeIds: [] });
  }, [applySelection]);

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
      applySelection({
        nodeIds: selectedNodes.map((node) => node.id),
        edgeIds: selectedEdges.map((edge) => edge.id),
        primaryNodeId: selectedNodeIdRef.current,
        primaryEdgeId: selectedEdgeIdRef.current,
      });
    },
    [applySelection]
  );

  const handleNodeDragStart = useCallback(() => {
    isNodeDragInProgressRef.current = true;
  }, []);

  const handleNodeDragStop = useCallback(() => {
    isNodeDragInProgressRef.current = false;
  }, []);

  const handleClosePropertiesPanel = useCallback(() => {
    if (isMobileLayout) {
      setPropertiesPanelOpen(false);
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          propertiesPanelToggleRef.current?.focus();
        }, 0);
      } else {
        propertiesPanelToggleRef.current?.focus();
      }
      return;
    }
    handleClearSelection();
  }, [handleClearSelection, isMobileLayout]);

  const handleOpenPropertiesPanel = useCallback(() => {
    if (!selectedNode && !selectedEdge) {
      return;
    }
    setPropertiesPanelOpen(true);
  }, [selectedEdge, selectedNode]);

  const selectedElementKey = selectedNodeId ?? selectedEdgeId ?? null;

  useEffect(() => {
    selectedVersionIdRef.current = selectedVersionId;
  }, [selectedVersionId]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    selectedEdgeIdRef.current = selectedEdgeId;
  }, [selectedEdgeId]);

  useEffect(() => {
    if (selectedElementKey) {
      if (previousSelectedElementRef.current !== selectedElementKey) {
        if (!(isMobileLayout && isNodeDragInProgressRef.current)) {
          setPropertiesPanelOpen(true);
        }
      }
    } else {
      setPropertiesPanelOpen(false);
    }
    previousSelectedElementRef.current = selectedElementKey;
  }, [isMobileLayout, selectedElementKey]);

  useEffect(() => {
    if (!isMobileLayout) {
      if (selectedElementKey) {
        setPropertiesPanelOpen(true);
      }
    }
  }, [isMobileLayout, selectedElementKey]);

  useEffect(() => {
    if (!isMobileLayout || !isPropertiesPanelOpen) {
      return;
    }
    propertiesPanelCloseButtonRef.current?.focus();
  }, [isMobileLayout, isPropertiesPanelOpen]);

  useEffect(() => {
    if (!isMobileLayout || !isPropertiesPanelOpen) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClosePropertiesPanel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClosePropertiesPanel, isMobileLayout, isPropertiesPanelOpen]);

  const updateNodeData = useCallback(
    (nodeId: string, updater: (data: FlowNodeData) => FlowNodeData) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          const nextData = updater(node.data);
          return {
            ...node,
            data: nextData,
            style: buildNodeStyle(nextData.kind, { isSelected: node.selected ?? false }),
          } satisfies FlowNode;
        })
      );
    },
    [setNodes]
  );

  const handleDisplayNameChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        const display = value;
        return {
          ...data,
          displayName: display,
          label: display.trim() ? display : humanizeSlug(data.slug),
        };
      });
    },
    [updateNodeData]
  );

  const handleStartAutoRunChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartAutoRun(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleStartAutoRunMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartAutoRunMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleStartAutoRunAssistantMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartAutoRunAssistantMessage(
          data.parameters,
          value,
        );
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentModelChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        let nextParameters = setAgentModel(data.parameters, value);
        if (!isReasoningModel(value)) {
          nextParameters = setAgentReasoningEffort(nextParameters, "");
          nextParameters = setAgentReasoningSummary(nextParameters, "");
          nextParameters = setAgentTextVerbosity(nextParameters, "");
        }
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [isReasoningModel, updateNodeData],
  );

  const handleAgentReasoningChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentReasoningEffort(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentReasoningSummaryChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentReasoningSummary(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentTextVerbosityChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentTextVerbosity(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentTemperatureChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentTemperature(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentTopPChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentTopP(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentMaxOutputTokensChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentMaxOutputTokens(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentIncludeChatHistoryChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentIncludeChatHistory(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentDisplayResponseInChatChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentDisplayResponseInChat(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentShowSearchSourcesChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentShowSearchSources(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentContinueOnErrorChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentContinueOnError(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentStorePreferenceChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentStorePreference(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentResponseFormatKindChange = useCallback(
    (nodeId: string, kind: "text" | "json_schema" | "widget") => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentResponseFormatKind(data.parameters, kind);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentResponseFormatNameChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentResponseFormatName(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentResponseFormatSchemaChange = useCallback(
    (nodeId: string, schema: unknown) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentResponseFormatSchema(data.parameters, schema);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentResponseWidgetSlugChange = useCallback(
    (nodeId: string, slug: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentResponseWidgetSlug(data.parameters, slug);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentResponseWidgetSourceChange = useCallback(
    (nodeId: string, source: "library" | "variable") => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentResponseWidgetSource(data.parameters, source);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentResponseWidgetDefinitionChange = useCallback(
    (nodeId: string, expression: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentResponseWidgetDefinition(data.parameters, expression);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleConditionPathChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "condition") {
          return data;
        }
        const nextParameters = setConditionPath(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleConditionModeChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "condition") {
          return data;
        }
        let nextParameters = setConditionMode(data.parameters, value);
        if (value !== "equals" && value !== "not_equals") {
          nextParameters = setConditionValue(nextParameters, "");
        }
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleConditionValueChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "condition") {
          return data;
        }
        const nextParameters = setConditionValue(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleWidgetNodeSlugChange = useCallback(
    (nodeId: string, slug: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeSlug(data.parameters, slug);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleWidgetNodeSourceChange = useCallback(
    (nodeId: string, source: "library" | "variable") => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeSource(data.parameters, source);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleWidgetNodeDefinitionExpressionChange = useCallback(
    (nodeId: string, expression: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeDefinitionExpression(data.parameters, expression);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleWidgetNodeVariablesChange = useCallback(
    (nodeId: string, assignments: WidgetVariableAssignment[]) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeVariables(data.parameters, assignments);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleWidgetNodeAwaitActionChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeAwaitAction(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentWebSearchChange = useCallback(
    (nodeId: string, config: WebSearchConfig | null) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentWebSearchConfig(data.parameters, config);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentFileSearchChange = useCallback(
    (nodeId: string, config: FileSearchConfig | null) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentFileSearchConfig(data.parameters, config);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentImageGenerationChange = useCallback(
    (nodeId: string, config: ImageGenerationToolConfig | null) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentImageGenerationConfig(data.parameters, config);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleVectorStoreNodeConfigChange = useCallback(
    (nodeId: string, updates: Partial<VectorStoreNodeConfig>) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "json_vector_store") {
          return data;
        }
        const nextParameters = setVectorStoreNodeConfig(data.parameters, updates);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleTransformExpressionsChange = useCallback(
    (nodeId: string, expressions: Record<string, unknown>) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "transform") {
          return data;
        }
        const nextParameters: AgentParameters = { ...(data.parameters ?? {}) };
        if (Object.keys(expressions).length > 0) {
          (nextParameters as Record<string, unknown>).expressions = expressions;
        } else {
          delete (nextParameters as Record<string, unknown>).expressions;
        }
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentWeatherToolChange = useCallback(
    (nodeId: string, enabled: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentWeatherToolEnabled(data.parameters, enabled);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentWidgetValidationToolChange = useCallback(
    (nodeId: string, enabled: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentWidgetValidationToolEnabled(
          data.parameters,
          enabled,
        );
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleStateAssignmentsChange = useCallback(
    (nodeId: string, scope: StateAssignmentScope, assignments: StateAssignment[]) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "state") {
          return data;
        }
        const nextParameters = setStateAssignments(data.parameters, scope, assignments);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleEndMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "end") {
          return data;
        }
        const nextParameters = setEndMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAssistantMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "assistant_message") {
          return data;
        }
        const nextParameters = setAssistantMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAssistantMessageStreamEnabledChange = useCallback(
    (nodeId: string, enabled: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "assistant_message") {
          return data;
        }
        const nextParameters = setAssistantMessageStreamEnabled(
          data.parameters,
          enabled,
        );
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAssistantMessageStreamDelayChange = useCallback(
    (nodeId: string, delay: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "assistant_message") {
          return data;
        }
        const nextParameters = setAssistantMessageStreamDelay(
          data.parameters,
          delay,
        );
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleWaitForUserInputMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "wait_for_user_input") {
          return data;
        }
        const nextParameters = setWaitForUserInputMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleUserMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "user_message") {
          return data;
        }
        const nextParameters = setUserMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

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
            : edge
        )
      );
      setHasPendingChanges(true);
    },
    [setEdges, setHasPendingChanges]
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
            : edge
        )
      );
      setHasPendingChanges(true);
    },
    [setEdges, setHasPendingChanges]
  );

  const removeElements = useCallback(
    ({
      nodeIds = [],
      edgeIds = [],
    }: {
      nodeIds?: Iterable<string>;
      edgeIds?: Iterable<string>;
    }) => {
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

      if (removedNodeIds.length === 0 && removedEdgeIds.length === 0 && protectedNodeIds.length === 0) {
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
    [applySelection, setEdges, setNodes, setSaveMessage, setSaveState]
  );

  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      removeElements({ nodeIds: [nodeId] });
      setHasPendingChanges(true);
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
    },
    [removeElements, selectedNodeId, setHasPendingChanges]
  );

  const handleRemoveEdge = useCallback(
    (edgeId: string) => {
      removeElements({ edgeIds: [edgeId] });
      setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== edgeId));
      setHasPendingChanges(true);
      if (selectedEdgeId === edgeId) {
        setSelectedEdgeId(null);
      }
    },
    [removeElements, selectedEdgeId, setEdges, setHasPendingChanges]
  );

  const addNodeToGraph = useCallback(
    (node: FlowNode) => {
      setNodes((current) => [
        ...current.map((existing) => ({
          ...existing,
          selected: false,
          style: buildNodeStyle(existing.data.kind, { isSelected: false }),
        })),
        {
          ...node,
          selected: true,
          style: buildNodeStyle(node.data.kind, { isSelected: true }),
        },
      ]);
      applySelection({ nodeIds: [node.id], primaryNodeId: node.id });
    },
    [applySelection, setNodes]
  );

  const handleAddAgentNode = useCallback(() => {
    const slug = `agent-${Date.now()}`;
    const parameters = resolveAgentParameters(null, {});
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 200 },
      data: {
        slug,
        kind: "agent",
        displayName: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
        label: humanizeSlug(slug),
      },
      draggable: true,
      style: buildNodeStyle("agent", { isSelected: true }),
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddConditionNode = useCallback(() => {
    const slug = `condition-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 400, y: 260 },
      data: {
        slug,
        kind: "condition",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("condition", { isSelected: true }),
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddStateNode = useCallback(() => {
    const slug = `state-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 360, y: 220 },
      data: {
        slug,
        kind: "state",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("state", { isSelected: true }),
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddWatchNode = useCallback(() => {
    const slug = `watch-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 380, y: 240 },
      data: {
        slug,
        kind: "watch",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("watch", { isSelected: true }),
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddTransformNode = useCallback(() => {
    const slug = `transform-${Date.now()}`;
    const parameters: AgentParameters = { expressions: {} };
    const newNode: FlowNode = {
      id: slug,
      position: { x: 380, y: 260 },
      data: {
        slug,
        kind: "transform",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("transform", { isSelected: true }),
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddWaitForUserInputNode = useCallback(() => {
    const slug = `wait-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 400, y: 260 },
      data: {
        slug,
        kind: "wait_for_user_input",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("wait_for_user_input", { isSelected: true }),
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddAssistantMessageNode = useCallback(() => {
    const slug = `assistant-message-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 460, y: 220 },
      data: {
        slug,
        kind: "assistant_message",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("assistant_message", { isSelected: true }),
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddUserMessageNode = useCallback(() => {
    const slug = `user-message-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 440, y: 240 },
      data: {
        slug,
        kind: "user_message",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("user_message", { isSelected: true }),
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddVectorStoreNode = useCallback(() => {
    const slug = `json-vector-store-${Date.now()}`;
    const fallbackSlug = vectorStores[0]?.slug?.trim() ?? "";
    const parameters = createVectorStoreNodeParameters({ vector_store_slug: fallbackSlug });
    const newNode: FlowNode = {
      id: slug,
      position: { x: 420, y: 320 },
      data: {
        slug,
        kind: "json_vector_store",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("json_vector_store", { isSelected: true }),
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, vectorStores]);

  const handleAddWidgetNode = useCallback(() => {
    const slug = `widget-${Date.now()}`;
    const parameters = createWidgetNodeParameters();
    const newNode: FlowNode = {
      id: slug,
      position: { x: 520, y: 200 },
      data: {
        slug,
        kind: "widget",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("widget", { isSelected: true }),
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddEndNode = useCallback(() => {
    const slug = `end-${Date.now()}`;
    const parameters = setEndMessage({}, DEFAULT_END_MESSAGE);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 640, y: 120 },
      data: {
        slug,
        kind: "end",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("end", { isSelected: true }),
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const resetCopySequence = () => {
      copySequenceRef.current.count = 0;
      copySequenceRef.current.lastTimestamp = 0;
    };

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      if (target.isContentEditable) {
        return true;
      }
      const tagName = target.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA") {
        return true;
      }
      return target.closest("input, textarea, [contenteditable=\"true\"]") !== null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const isCopy = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c";
      if (isCopy) {
        const now = Date.now();
        const { lastTimestamp, count } = copySequenceRef.current;
        copySequenceRef.current.count = now - lastTimestamp <= 600 ? count + 1 : 1;
        copySequenceRef.current.lastTimestamp = now;
        return;
      }

      const now = Date.now();
      const triggeredBySequence =
        copySequenceRef.current.count >= 2 && now - copySequenceRef.current.lastTimestamp <= 800;

      if (isEditableTarget(event.target) && !triggeredBySequence) {
        if (!event.ctrlKey && !event.metaKey) {
          resetCopySequence();
        }
        return;
      }

      if (event.key === "Delete") {
        const hasSelection =
          selectedNodeIdsRef.current.size > 0 || selectedEdgeIdsRef.current.size > 0;
        if (!hasSelection) {
          resetCopySequence();
          return;
        }
        event.preventDefault();
        removeElements({
          nodeIds: selectedNodeIdsRef.current,
          edgeIds: selectedEdgeIdsRef.current,
        });
        resetCopySequence();
        return;
      }

      if (!event.ctrlKey && !event.metaKey) {
        resetCopySequence();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [removeElements]);

  const handleSelectWorkflow = useCallback(
    (workflowId: number) => {
      if (workflowId === selectedWorkflowId) {
        return;
      }
      setSelectedWorkflowId(workflowId);
      setSelectedVersionId(null);
      setOpenWorkflowMenuId(null);
      void loadVersions(workflowId, null);
    },
    [loadVersions, selectedWorkflowId],
  );

  const handleVersionChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = Number(event.target.value);
      const versionId = Number.isFinite(value) ? value : null;
      setSelectedVersionId(versionId);
      if (selectedWorkflowId && versionId) {
        const key = viewportKeyFor(selectedWorkflowId, versionId);
        const hasSavedViewport = key ? viewportMemoryRef.current.has(key) : false;
        if (hasSavedViewport) {
          void loadVersionDetail(selectedWorkflowId, versionId);
        } else {
          void loadVersionDetail(selectedWorkflowId, versionId, { preserveViewport: true });
        }
      }
    },
    [loadVersionDetail, selectedWorkflowId],
  );

  const handleCreateWorkflow = useCallback(async () => {
    const proposed = window.prompt("Nom du nouveau workflow ?");
    if (!proposed) {
      return;
    }
    const displayName = proposed.trim();
    if (!displayName) {
      return;
    }
    const slug = slugifyWorkflowName(displayName);
    const payload = {
      slug,
      display_name: displayName,
      description: null,
      graph: null,
    };
    const candidates = makeApiEndpointCandidates(backendUrl, "/api/workflows");
    let lastError: Error | null = null;
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(`Échec de la création (${response.status})`);
        }
        const data: WorkflowVersionResponse = await response.json();
        await loadWorkflows({ selectWorkflowId: data.workflow_id, selectVersionId: data.id });
        setSaveState("saved");
        setSaveMessage(`Workflow "${displayName}" créé avec succès.`);
        setTimeout(() => setSaveState("idle"), 1500);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Impossible de créer le workflow.");
      }
    }
    setSaveState("error");
    setSaveMessage(lastError?.message ?? "Impossible de créer le workflow.");
  }, [authHeader, loadWorkflows]);

  const handleDeleteWorkflow = useCallback(
    async (workflowId?: number) => {
      const targetId = workflowId ?? selectedWorkflowId;
      if (!targetId) {
        return;
      }
      const current = workflows.find((workflow) => workflow.id === targetId);
      if (!current) {
        return;
      }
      if (current.is_chatkit_default) {
        setSaveState("error");
        setSaveMessage(
          "Sélectionnez un autre workflow pour ChatKit avant de supprimer celui-ci.",
        );
        return;
      }
      const confirmed = window.confirm(
        `Supprimer le workflow "${current.display_name}" ? Cette action est irréversible.`,
      );
      if (!confirmed) {
        return;
      }
      setOpenWorkflowMenuId(null);
      const endpoint = `/api/workflows/${targetId}`;
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
      let lastError: Error | null = null;
      setSaveState("saving");
      setSaveMessage("Suppression en cours…");
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
          });
          if (response.status === 204) {
            applySelection({ nodeIds: [], edgeIds: [] });
            const nextSelection = targetId === selectedWorkflowId ? null : selectedWorkflowId;
            await loadWorkflows({
              excludeWorkflowId: current.id,
              selectWorkflowId: nextSelection ?? undefined,
            });
            setSaveState("saved");
            setSaveMessage(`Workflow "${current.display_name}" supprimé.`);
            setTimeout(() => setSaveState("idle"), 1500);
            return;
          }
        if (response.status === 400) {
          let message = "Impossible de supprimer le workflow.";
          try {
            const detail = (await response.json()) as { detail?: unknown };
            if (detail && typeof detail.detail === "string") {
              message = detail.detail;
            }
          } catch (parseError) {
            console.error(parseError);
          }
          throw new Error(message);
        }
        if (response.status === 404) {
          throw new Error("Le workflow n'existe plus.");
        }
        throw new Error(`Impossible de supprimer le workflow (${response.status}).`);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError = error instanceof Error ? error : new Error("Impossible de supprimer le workflow.");
      }
      }
      setSaveState("error");
      setSaveMessage(lastError?.message ?? "Impossible de supprimer le workflow.");
    },
    [
      authHeader,
      backendUrl,
      applySelection,
      loadWorkflows,
      selectedWorkflowId,
      workflows,
    ],
  );

  const buildGraphPayload = useCallback(
    () => buildGraphPayloadFrom(nodes, edges),
    [edges, nodes],
  );

  const graphSnapshot = useMemo(() => JSON.stringify(buildGraphPayload()), [buildGraphPayload]);

  const conditionGraphError = useMemo(() => {
    const enabledNodes = new Map(
      nodes.filter((node) => node.data.isEnabled).map((node) => [node.id, node]),
    );

    for (const node of nodes) {
      if (!node.data.isEnabled || node.data.kind !== "condition") {
        continue;
      }

      const label = node.data.displayName.trim() || node.data.slug;
      const outgoing = edges.filter(
        (edge) => edge.source === node.id && enabledNodes.has(edge.target),
      );

      if (outgoing.length < 2) {
        return `Le bloc conditionnel « ${label} » doit comporter au moins deux sorties actives.`;
      }

      const seenBranches = new Set<string>();
      let defaultCount = 0;

      for (const edge of outgoing) {
        const rawCondition = edge.data?.condition ?? "";
        const trimmed = rawCondition.trim();
        const normalized = trimmed ? trimmed.toLowerCase() : "default";

        if (normalized === "default") {
          defaultCount += 1;
          if (defaultCount > 1) {
            return `Le bloc conditionnel « ${label} » ne peut contenir qu'une seule branche par défaut.`;
          }
        }

        if (seenBranches.has(normalized)) {
          return `Le bloc conditionnel « ${label} » contient des branches conditionnelles en double.`;
        }

        seenBranches.add(normalized);
      }
    }

    return null;
  }, [edges, nodes]);

  useEffect(() => {
    if (!selectedWorkflowId) {
      lastSavedSnapshotRef.current = null;
      setHasPendingChanges(false);
      return;
    }

    if (isHydratingRef.current) {
      isHydratingRef.current = false;
      return;
    }

    if (!lastSavedSnapshotRef.current) {
      lastSavedSnapshotRef.current = graphSnapshot;
      setHasPendingChanges(false);
      return;
    }

    setHasPendingChanges(graphSnapshot !== lastSavedSnapshotRef.current);
  }, [graphSnapshot, selectedWorkflowId]);

  const handleSave = useCallback(async () => {
    setSaveMessage(null);
    if (!selectedWorkflowId) {
      setSaveState("error");
      setSaveMessage("Sélectionnez un workflow avant d'enregistrer une version.");
      return;
    }

    const nodesWithErrors = nodes.filter((node) => node.data.parametersError);
    if (nodesWithErrors.length > 0) {
      setSaveState("error");
      setSaveMessage("Corrigez les paramètres JSON invalides avant d'enregistrer.");
      return;
    }

    if (conditionGraphError) {
      setSaveState("error");
      setSaveMessage(conditionGraphError);
      return;
    }

    const graphPayload = buildGraphPayload();
    const graphSnapshot = JSON.stringify(graphPayload);
    if (!draftVersionIdRef.current) {
      const draftFromState = resolveDraftCandidate(versions);
      if (draftFromState) {
        draftVersionIdRef.current = draftFromState.id;
        draftVersionSummaryRef.current = draftFromState;
      }
    }

    const draftId = draftVersionIdRef.current;

    if (!draftId) {
      if (isCreatingDraftRef.current) {
        return;
      }

      const endpoint = `/api/workflows/${selectedWorkflowId}/versions`;
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
      let lastError: Error | null = null;
      isCreatingDraftRef.current = true;
      setSaveState("saving");
      try {
        for (const url of candidates) {
          if (draftVersionIdRef.current) {
            console.warn("DraftExistsError", {
              workflowId: selectedWorkflowId,
              draftId: draftVersionIdRef.current,
            });
            return;
          }
          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...authHeader,
              },
              body: JSON.stringify({ graph: graphPayload, mark_as_active: false }),
            });
            if (!response.ok) {
              throw new Error(formatSaveFailureWithStatus(response.status));
            }
            const created: WorkflowVersionResponse = await response.json();
            const summary: WorkflowVersionSummary = {
              ...versionSummaryFromResponse(created),
              name: draftDisplayName,
            };
            const newViewportKey = viewportKeyFor(selectedWorkflowId, summary.id);
            const currentViewport =
              reactFlowInstanceRef.current?.getViewport() ?? viewportRef.current;
            if (newViewportKey && currentViewport) {
              viewportMemoryRef.current.set(newViewportKey, { ...currentViewport });
              persistViewportMemory();
            }
            viewportKeyRef.current = newViewportKey;
            viewportRef.current = currentViewport ? { ...currentViewport } : null;
            draftVersionIdRef.current = summary.id;
            draftVersionSummaryRef.current = summary;
            setSelectedVersionId(summary.id);
            await loadVersions(selectedWorkflowId, summary.id, {
              preserveViewport: true,
              background: true,
            });
            lastSavedSnapshotRef.current = graphSnapshot;
            setHasPendingChanges(false);
            setSaveState("saved");
            setSaveMessage(autoSaveSuccessMessage);
            setTimeout(() => {
              setSaveState("idle");
              setSaveMessage((previous) =>
                previous === autoSaveSuccessMessage ? null : previous,
              );
            }, 1500);
            return;
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
              continue;
            }
            lastError =
              error instanceof Error
                ? error
                : new Error(saveFailureMessage);
          }
        }
      } finally {
        isCreatingDraftRef.current = false;
      }
      setSaveState("error");
      setHasPendingChanges(true);
      setSaveMessage(lastError?.message ?? saveFailureMessage);
      return;
    }

    const endpoint = `/api/workflows/${selectedWorkflowId}/versions/${draftId}`;
    const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
    let lastError: Error | null = null;
    setSaveState("saving");
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({ graph: graphPayload }),
        });
        if (!response.ok) {
          throw new Error(formatSaveFailureWithStatus(response.status));
        }
        const updated: WorkflowVersionResponse = await response.json();
        const summary: WorkflowVersionSummary = {
          ...versionSummaryFromResponse(updated),
          name: draftDisplayName,
        };
        draftVersionSummaryRef.current = summary;
        await loadVersions(selectedWorkflowId, summary.id, {
          preserveViewport: true,
          background: true,
        });
        lastSavedSnapshotRef.current = graphSnapshot;
        setHasPendingChanges(false);
        setSaveState("saved");
        setSaveMessage(autoSaveSuccessMessage);
        setTimeout(() => {
          setSaveState("idle");
          setSaveMessage((previous) =>
            previous === autoSaveSuccessMessage ? null : previous,
          );
        }, 1500);
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError =
          error instanceof Error
            ? error
            : new Error(saveFailureMessage);
      }
    }

    setSaveState("error");
    setHasPendingChanges(true);
    setSaveMessage(lastError?.message ?? saveFailureMessage);
  }, [
    authHeader,
    autoSaveSuccessMessage,
    backendUrl,
    buildGraphPayload,
    conditionGraphError,
    draftDisplayName,
    formatSaveFailureWithStatus,
    loadVersions,
    nodes,
    persistViewportMemory,
    saveFailureMessage,
    selectedWorkflowId,
    versions,
  ]);

  const resolveImportErrorMessage = useCallback(
    (error: unknown): string => {
      if (error instanceof WorkflowImportError) {
        switch (error.reason) {
          case "invalid_json":
            return t("workflowBuilder.import.errorInvalidJson");
          case "missing_nodes":
            return t("workflowBuilder.import.errorMissingNodes");
          case "invalid_node":
            return t("workflowBuilder.import.errorInvalidNode");
          case "invalid_edge":
            return t("workflowBuilder.import.errorInvalidEdge");
          case "invalid_graph":
          default:
            return t("workflowBuilder.import.errorInvalidGraph");
        }
      }
      if (error instanceof Error) {
        return error.message;
      }
      return t("workflowBuilder.import.error");
    },
    [t],
  );

  const processImportPayload = useCallback(
    async (rawText: string) => {
      setIsImporting(true);
      try {
        const parsed = parseWorkflowImport(rawText);
        let targetWorkflowId = selectedWorkflowId ?? null;
        if (targetWorkflowId == null && parsed.workflowId != null) {
          targetWorkflowId = parsed.workflowId;
        }

        const requestPayload: Record<string, unknown> = {
          graph: parsed.graph,
        };

        const ensureVersionName = () =>
          t("workflowBuilder.import.defaultVersionName", {
            timestamp: new Date().toLocaleString(),
          });

        if (targetWorkflowId != null) {
          requestPayload.workflow_id = targetWorkflowId;
          if (parsed.slug) {
            requestPayload.slug = parsed.slug;
          }
          if (parsed.displayName) {
            requestPayload.display_name = parsed.displayName;
          }
          if (parsed.description !== undefined) {
            requestPayload.description = parsed.description;
          }
          if (parsed.markAsActive !== undefined) {
            requestPayload.mark_as_active = parsed.markAsActive;
          }
          requestPayload.version_name = parsed.versionName ?? ensureVersionName();
        } else {
          let displayName = parsed.displayName ?? null;
          if (!displayName) {
            const proposed = window.prompt(
              t("workflowBuilder.import.promptDisplayName"),
            );
            if (!proposed) {
              setSaveState("error");
              setSaveMessage(t("workflowBuilder.import.errorMissingName"));
              return;
            }
            const trimmed = proposed.trim();
            if (!trimmed) {
              setSaveState("error");
              setSaveMessage(t("workflowBuilder.import.errorMissingName"));
              return;
            }
            displayName = trimmed;
          }
          const slug = parsed.slug ?? slugifyWorkflowName(displayName);
          requestPayload.display_name = displayName;
          requestPayload.slug = slug;
          requestPayload.description = parsed.description ?? null;
          requestPayload.mark_as_active = parsed.markAsActive ?? true;
          requestPayload.version_name = parsed.versionName ?? ensureVersionName();
        }

        setSaveState("saving");
        setSaveMessage(t("workflowBuilder.import.saving"));

        const candidates = makeApiEndpointCandidates(
          backendUrl,
          "/api/workflows/import",
        );
        let lastError: Error | null = null;

        for (const url of candidates) {
          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...authHeader,
              },
              body: JSON.stringify(requestPayload),
            });
            if (!response.ok) {
              let detail = t("workflowBuilder.import.errorWithStatus", {
                status: response.status,
              });
              try {
                const data = await response.json();
                if (data && typeof data.detail === "string" && data.detail.trim()) {
                  detail = data.detail.trim();
                }
              } catch (parseError) {
                lastError =
                  parseError instanceof Error
                    ? parseError
                    : new Error(t("workflowBuilder.import.error"));
              }
              throw new Error(detail);
            }
            const imported: WorkflowVersionResponse = await response.json();
            await loadWorkflows({
              selectWorkflowId: imported.workflow_id,
              selectVersionId: imported.id,
            });
            setSaveState("saved");
            setSaveMessage(t("workflowBuilder.import.success"));
            setTimeout(() => setSaveState("idle"), 1500);
            return;
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
              continue;
            }
            lastError =
              error instanceof Error
                ? error
                : new Error(t("workflowBuilder.import.error"));
          }
        }

        if (lastError) {
          throw lastError;
        }
        throw new Error(t("workflowBuilder.import.error"));
      } catch (error) {
        setSaveState("error");
        setSaveMessage(resolveImportErrorMessage(error));
      } finally {
        setIsImporting(false);
      }
    },
    [
      authHeader,
      backendUrl,
      loadWorkflows,
      resolveImportErrorMessage,
      selectedWorkflowId,
      t,
    ],
  );

  const handleImportFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      event.target.value = "";
      if (!file) {
        return;
      }
      try {
        setSaveMessage(null);
        const text = await file.text();
        await processImportPayload(text);
      } catch (_error) {
        setSaveState("error");
        setSaveMessage(t("workflowBuilder.import.errorFileRead"));
        setIsImporting(false);
      }
    },
    [processImportPayload, t],
  );

  const handleTriggerImport = useCallback(() => {
    if (loading || isImporting) {
      return;
    }
    setSaveMessage(null);
    importFileInputRef.current?.click();
  }, [importFileInputRef, isImporting, loading]);

  const handleExportWorkflow = useCallback(async () => {
    if (!selectedWorkflowId || !selectedVersionId || isExporting) {
      return;
    }

    setIsExporting(true);
    setSaveState("saving");
    setSaveMessage(t("workflowBuilder.export.preparing"));

    const endpoint = `/api/workflows/${selectedWorkflowId}/versions/${selectedVersionId}/export`;
    const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
    let lastError: Error | null = null;

    try {
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              Accept: "application/json",
              ...authHeader,
            },
          });
          if (!response.ok) {
            throw new Error(
              t("workflowBuilder.export.errorWithStatus", { status: response.status }),
            );
          }

          const graph = await response.json();
          if (typeof document === "undefined") {
            throw new Error(t("workflowBuilder.export.error"));
          }

          const serialized = JSON.stringify(graph, null, 2);
          const workflowLabel =
            selectedWorkflow?.display_name?.trim() ||
            selectedWorkflow?.slug ||
            `workflow-${selectedWorkflowId}`;
          const versionSummary =
            versions.find((version) => version.id === selectedVersionId) ?? null;
          const workflowSlug = slugifyWorkflowName(workflowLabel);
          const versionSlug = versionSummary
            ? slugifyWorkflowName(
                versionSummary.name?.trim() || `v${versionSummary.version}`,
              )
            : slugifyWorkflowName(`version-${selectedVersionId}`);
          const fileName = `${workflowSlug}-${versionSlug}.json`;

          const blob = new Blob([serialized], {
            type: "application/json;charset=utf-8",
          });
          const blobUrl = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = blobUrl;
          anchor.download = fileName;
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          URL.revokeObjectURL(blobUrl);

          setSaveState("saved");
          setSaveMessage(t("workflowBuilder.export.success"));
          setTimeout(() => setSaveState("idle"), 1500);
          return;
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error(t("workflowBuilder.export.error"));
        }
      }

      setSaveState("error");
      setSaveMessage(lastError?.message ?? t("workflowBuilder.export.error"));
    } finally {
      setIsExporting(false);
    }
  }, [
    authHeader,
    isExporting,
    selectedWorkflow,
    selectedWorkflowId,
    selectedVersionId,
    t,
    versions,
  ]);

  const handleOpenDeployModal = useCallback(() => {
    setSaveMessage(null);
    setDeployToProduction(true);
    setDeployModalOpen(true);
  }, []);

  const handleCloseDeployModal = useCallback(() => {
    if (isDeploying) {
      return;
    }
    setDeployModalOpen(false);
  }, [isDeploying]);

  const resolveVersionIdToPromote = useCallback(
    (
      preferDraft = false,
      options: { selectedId?: number | null } = {},
    ): number | null => {
      const draftId = draftVersionIdRef.current;
      const selectedId = Object.prototype.hasOwnProperty.call(options, "selectedId")
        ? options.selectedId ?? null
        : selectedVersionIdRef.current;

      if (preferDraft) {
        return draftId ?? selectedId ?? null;
      }

      if (selectedId != null) {
        return selectedId;
      }

      return draftId ?? null;
    },
    [],
  );

  const handleConfirmDeploy = useCallback(async () => {
    if (!selectedWorkflowId) {
      return;
    }

    let versionIdToPromote = resolveVersionIdToPromote();
    if (!versionIdToPromote) {
      setSaveState("error");
      setSaveMessage(t("workflowBuilder.deploy.missingTarget"));
      return;
    }

    setIsDeploying(true);

    if (hasPendingChanges) {
      await handleSave();
      if (hasPendingChanges) {
        setIsDeploying(false);
        setSaveState("error");
        setSaveMessage(t("workflowBuilder.deploy.pendingChangesError"));
        return;
      }
      versionIdToPromote = resolveVersionIdToPromote(true) ?? versionIdToPromote;
      if (!versionIdToPromote) {
        setIsDeploying(false);
        setSaveState("error");
        setSaveMessage(t("workflowBuilder.deploy.missingTarget"));
        return;
      }
    }

    const graphPayload = buildGraphPayload();
    const graphSnapshot = JSON.stringify(graphPayload);
    setSaveState("saving");
    setSaveMessage(t("workflowBuilder.deploy.promoting"));

    const promoteCandidates = makeApiEndpointCandidates(
      backendUrl,
      `/api/workflows/${selectedWorkflowId}/production`,
    );
    let lastError: Error | null = null;

    for (const url of promoteCandidates) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({ version_id: versionIdToPromote }),
        });
        if (!response.ok) {
          throw new Error(
            t("workflowBuilder.deploy.promoteFailedWithStatus", { status: response.status }),
          );
        }
        const promoted: WorkflowVersionResponse = await response.json();

        if (draftVersionIdRef.current === versionIdToPromote) {
          draftVersionIdRef.current = null;
          draftVersionSummaryRef.current = null;
        }
        setSelectedVersionId(promoted.id);
        await loadVersions(selectedWorkflowId, promoted.id);
        await loadWorkflows({ selectWorkflowId: selectedWorkflowId, selectVersionId: promoted.id });
        lastSavedSnapshotRef.current = graphSnapshot;
        setHasPendingChanges(false);
        setSaveState("saved");
        setSaveMessage(
          deployToProduction
            ? t("workflowBuilder.deploy.successProduction")
            : t("workflowBuilder.deploy.successPublished"),
        );
        setTimeout(() => setSaveState("idle"), 1500);
        setDeployModalOpen(false);
        setIsDeploying(false);
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError =
          error instanceof Error
            ? error
            : new Error(t("workflowBuilder.deploy.promoteError"));
      }
    }

    setIsDeploying(false);
    setSaveState("error");
    setSaveMessage(lastError?.message ?? t("workflowBuilder.deploy.publishError"));
  }, [
    authHeader,
    backendUrl,
    buildGraphPayload,
    deployToProduction,
    handleSave,
    hasPendingChanges,
    loadVersions,
    loadWorkflows,
    selectedWorkflowId,
    resolveVersionIdToPromote,
    t,
  ]);

  useEffect(() => {
    if (!isDeployModalOpen) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleCloseDeployModal();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [handleCloseDeployModal, isDeployModalOpen]);

  const handleDuplicateWorkflow = useCallback(
    async (workflowId?: number) => {
      const targetId = workflowId ?? selectedWorkflowId;
      if (!targetId || !selectedWorkflow || targetId !== selectedWorkflowId) {
        setOpenWorkflowMenuId(null);
        if (targetId && targetId !== selectedWorkflowId) {
          setSaveState("error");
          setSaveMessage("Sélectionnez le workflow avant de le dupliquer.");
          setTimeout(() => setSaveState("idle"), 1500);
        }
        return;
      }

      const baseName = selectedWorkflow.display_name?.trim() || "Workflow sans nom";
      const proposed = window.prompt("Nom du duplicata ?", `${baseName} (copie)`);
      if (!proposed) {
        return;
      }

      const displayName = proposed.trim();
      if (!displayName) {
        return;
      }

      const payload = {
        slug: slugifyWorkflowName(displayName),
        display_name: displayName,
        description: selectedWorkflow.description,
        graph: buildGraphPayload(),
      };

      const candidates = makeApiEndpointCandidates(backendUrl, "/api/workflows");
      let lastError: Error | null = null;
      setSaveState("saving");
      setSaveMessage("Duplication en cours…");
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            throw new Error(`Échec de la duplication (${response.status})`);
          }

          const data: WorkflowVersionResponse = await response.json();
          setOpenWorkflowMenuId(null);
          await loadWorkflows({ selectWorkflowId: data.workflow_id, selectVersionId: data.id });
          setSaveState("saved");
          setSaveMessage(`Workflow dupliqué sous "${displayName}".`);
          setTimeout(() => setSaveState("idle"), 1500);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Impossible de dupliquer le workflow.");
        }
      }

      setSaveState("error");
      setSaveMessage(lastError?.message ?? "Impossible de dupliquer le workflow.");
    },
    [
      authHeader,
      buildGraphPayload,
      loadWorkflows,
      selectedWorkflow,
      selectedWorkflowId,
    ],
  );

  const handleRenameWorkflow = useCallback(
    async (workflowId?: number) => {
      const targetId = workflowId ?? selectedWorkflowId;
      if (!targetId) {
        return;
      }

      const target = workflows.find((workflow) => workflow.id === targetId);
      if (!target) {
        setOpenWorkflowMenuId(null);
        return;
      }

      setOpenWorkflowMenuId(null);

      const baseName = target.display_name?.trim() || "Workflow sans nom";
      const proposed = window.prompt("Nouveau nom du workflow ?", baseName);
      if (proposed === null) {
        return;
      }

      const displayName = proposed.trim();
      if (!displayName || displayName === target.display_name) {
        return;
      }

      const slug =
        target.slug === "workflow-par-defaut"
          ? target.slug
          : slugifyWorkflowName(displayName);
      if (!slug) {
        setSaveState("error");
        setSaveMessage("Impossible de renommer le workflow.");
        return;
      }

      const payload = {
        display_name: displayName,
        slug,
      };

      const candidates = makeApiEndpointCandidates(backendUrl, `/api/workflows/${targetId}`);
      let lastError: Error | null = null;

      setSaveState("saving");
      setSaveMessage("Renommage en cours…");

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            throw new Error(`Échec du renommage (${response.status})`);
          }

          const summary: WorkflowSummary = await response.json();
          await loadWorkflows({
            selectWorkflowId: summary.id,
            selectVersionId: selectedVersionId ?? null,
          });
          setSaveState("saved");
          setSaveMessage(`Workflow renommé en "${summary.display_name}".`);
          setTimeout(() => setSaveState("idle"), 1500);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            continue;
          }
          lastError = error instanceof Error ? error : new Error("Impossible de renommer le workflow.");
        }
      }

      setSaveState("error");
      setSaveMessage(lastError?.message ?? "Impossible de renommer le workflow.");
    },
    [
      authHeader,
      backendUrl,
      loadWorkflows,
      selectedVersionId,
      selectedWorkflowId,
      workflows,
    ],
  );

  const disableSave = useMemo(() => {
    if (!selectedWorkflowId) {
      return true;
    }

    if (nodes.some((node) => node.data.parametersError)) {
      return true;
    }

    if (conditionGraphError) {
      return true;
    }

    const availableVectorStoreSlugs = new Set(vectorStores.map((store) => store.slug));
    const availableWidgetSlugs = new Set(widgets.map((widget) => widget.slug));

    return nodes.some((node) => {
      if (!node.data.isEnabled) {
        return false;
      }

      if (node.data.kind === "agent") {
        const fileSearchConfig = getAgentFileSearchConfig(node.data.parameters);
        if (fileSearchConfig) {
          const slug = fileSearchConfig.vector_store_slug?.trim() ?? "";
          if (!slug) {
            return true;
          }

          if (
            !vectorStoresError &&
            vectorStores.length > 0 &&
            !availableVectorStoreSlugs.has(slug)
          ) {
            return true;
          }
        }

        const responseFormat = getAgentResponseFormat(node.data.parameters);
        if (responseFormat.kind === "widget") {
          const slug = responseFormat.slug.trim();
          if (!slug) {
            return true;
          }
          if (!widgetsError && widgets.length > 0 && !availableWidgetSlugs.has(slug)) {
            return true;
          }
        }

        return false;
      }

      if (node.data.kind === "json_vector_store") {
        const config = getVectorStoreNodeConfig(node.data.parameters);
        const slug = config.vector_store_slug.trim();
        if (!slug) {
          return true;
        }
        if (!vectorStoresError && vectorStores.length > 0 && !availableVectorStoreSlugs.has(slug)) {
          return true;
        }
        return false;
      }

      return false;
    });
  }, [
    conditionGraphError,
    nodes,
    selectedWorkflowId,
    vectorStores,
    vectorStoresError,
    widgets,
    widgetsError,
  ]);

  useEffect(() => {
    if (conditionGraphError) {
      setSaveState((previous) => (previous === "saving" ? previous : "error"));
      setSaveMessage(conditionGraphError);
    }
  }, [conditionGraphError]);

  useEffect(() => {
    if (isPropertiesPanelOpen) {
      if (autoSaveTimeoutRef.current !== null) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      return;
    }

    if (
      !hasPendingChanges ||
      disableSave ||
      saveState === "saving" ||
      loading ||
      !selectedWorkflowId
    ) {
      if (autoSaveTimeoutRef.current !== null) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      return;
    }

    if (autoSaveTimeoutRef.current !== null) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = window.setTimeout(() => {
      autoSaveTimeoutRef.current = null;
      void handleSave();
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (autoSaveTimeoutRef.current !== null) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    };
  }, [
    disableSave,
    handleSave,
    hasPendingChanges,
    isPropertiesPanelOpen,
    loading,
    saveState,
    selectedWorkflowId,
  ]);

  const blockLibraryItems = useMemo(
    () => [
      {
        key: "agent",
        label: "Agent",
        shortLabel: "A",
        color: NODE_COLORS.agent,
        onClick: handleAddAgentNode,
      },
      {
        key: "condition",
        label: "Condition",
        shortLabel: "C",
        color: NODE_COLORS.condition,
        onClick: handleAddConditionNode,
      },
      {
        key: "state",
        label: "Bloc état",
        shortLabel: "É",
        color: NODE_COLORS.state,
        onClick: handleAddStateNode,
      },
      {
        key: "watch",
        label: "Bloc watch",
        shortLabel: "W",
        color: NODE_COLORS.watch,
        onClick: handleAddWatchNode,
      },
      {
        key: "transform",
        label: "Bloc transform",
        shortLabel: "T",
        color: NODE_COLORS.transform,
        onClick: handleAddTransformNode,
      },
      {
        key: "wait-for-user-input",
        label: "Wait for user input",
        shortLabel: "AU",
        color: NODE_COLORS.wait_for_user_input,
        onClick: handleAddWaitForUserInputNode,
      },
      {
        key: "assistant-message",
        label: "Message assistant",
        shortLabel: "MA",
        color: NODE_COLORS.assistant_message,
        onClick: handleAddAssistantMessageNode,
      },
      {
        key: "user-message",
        label: "Message utilisateur",
        shortLabel: "MU",
        color: NODE_COLORS.user_message,
        onClick: handleAddUserMessageNode,
      },
      {
        key: "json-vector-store",
        label: "Stockage JSON",
        shortLabel: "VS",
        color: NODE_COLORS.json_vector_store,
        onClick: handleAddVectorStoreNode,
      },
      {
        key: "widget",
        label: "Bloc widget",
        shortLabel: "W",
        color: NODE_COLORS.widget,
        onClick: handleAddWidgetNode,
      },
      {
        key: "end",
        label: "Fin",
        shortLabel: "F",
        color: NODE_COLORS.end,
        onClick: handleAddEndNode,
      },
    ],
    [
      handleAddAgentNode,
      handleAddConditionNode,
      handleAddStateNode,
      handleAddWatchNode,
      handleAddTransformNode,
      handleAddWaitForUserInputNode,
      handleAddAssistantMessageNode,
      handleAddUserMessageNode,
      handleAddVectorStoreNode,
      handleAddWidgetNode,
      handleAddEndNode,
    ],
  );

  const updateBlockLibraryTransforms = useCallback(() => {
    if (!isMobileLayout || typeof window === "undefined") {
      return;
    }
    const container = blockLibraryScrollRef.current;
    if (!container) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    if (containerRect.height === 0) {
      return;
    }
    const containerCenter = containerRect.top + containerRect.height / 2;
    const maxDistance = Math.max(containerRect.height / 2, 1);

    blockLibraryItems.forEach((item) => {
      const element = blockLibraryItemRefs.current[item.key];
      if (!element) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const elementCenter = rect.top + rect.height / 2;
      const distance = Math.abs(elementCenter - containerCenter);
      const normalized = Math.min(distance / maxDistance, 1);
      const eased = 1 - Math.pow(normalized, 1.6);
      const scale = 0.82 + eased * 0.38;
      const arcOffset = Math.pow(normalized, 1.5) * 32;
      const opacity = 0.55 + eased * 0.45;

      element.style.transform = `translateX(${arcOffset}px) scale(${scale})`;
      element.style.opacity = opacity.toFixed(3);
      element.style.zIndex = String(100 + Math.round(eased * 100));
    });
  }, [blockLibraryItems, isMobileLayout]);

  const scheduleBlockLibraryTransformUpdate = useCallback(() => {
    if (!isMobileLayout || typeof window === "undefined") {
      return;
    }
    if (blockLibraryAnimationFrameRef.current !== null) {
      cancelAnimationFrame(blockLibraryAnimationFrameRef.current);
    }
    blockLibraryAnimationFrameRef.current = requestAnimationFrame(updateBlockLibraryTransforms);
  }, [isMobileLayout, updateBlockLibraryTransforms]);

  useEffect(() => {
    if (!isMobileLayout || !isBlockLibraryOpen) {
      return () => {};
    }
    const container = blockLibraryScrollRef.current;
    if (!container) {
      return () => {};
    }

    const handleScroll = () => {
      scheduleBlockLibraryTransformUpdate();
    };

    scheduleBlockLibraryTransformUpdate();

    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [isBlockLibraryOpen, isMobileLayout, scheduleBlockLibraryTransformUpdate]);

  useEffect(() => {
    if (!isMobileLayout || !isBlockLibraryOpen || typeof document === "undefined") {
      return;
    }
    const { style } = document.body;
    const previousOverflow = style.overflow;
    style.overflow = "hidden";

    return () => {
      style.overflow = previousOverflow;
    };
  }, [isBlockLibraryOpen, isMobileLayout]);

  useEffect(() => {
    if (!isMobileLayout || !isBlockLibraryOpen) {
      return () => {
        if (blockLibraryAnimationFrameRef.current !== null) {
          cancelAnimationFrame(blockLibraryAnimationFrameRef.current);
          blockLibraryAnimationFrameRef.current = null;
        }
      };
    }

    scheduleBlockLibraryTransformUpdate();
    return () => {
      if (blockLibraryAnimationFrameRef.current !== null) {
        cancelAnimationFrame(blockLibraryAnimationFrameRef.current);
        blockLibraryAnimationFrameRef.current = null;
      }
    };
  }, [
    blockLibraryItems,
    isBlockLibraryOpen,
    isMobileLayout,
    scheduleBlockLibraryTransformUpdate,
  ]);

  const getBlockLibraryButtonStyle = useCallback(
    (disabled: boolean): CSSProperties => {
      if (isMobileLayout) {
        return {
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "1.15rem 1.1rem",
          border: "none",
          background: "rgba(15, 23, 42, 0.28)",
          borderRadius: "1.1rem",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.45 : 1,
          width: "100%",
          textAlign: "left",
          transition: "background 0.3s ease, transform 0.3s ease",
          color: "#f8fafc",
        };
      }
      return {
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.5rem 0",
        border: "none",
        background: "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        width: "100%",
        textAlign: "left",
      };
    },
    [isMobileLayout],
  );

  const workflowSidebarContent = useMemo(() => {
    const sectionId = "workflow-builder-sidebar";
    const warningStyle: CSSProperties = { color: "#b45309", fontWeight: 600 };

    const renderWorkflowList = () => {
      if (loading && workflows.length === 0) {
        return (
          <p className="chatkit-sidebar__section-text" aria-live="polite">
            Chargement des workflows…
          </p>
        );
      }

      if (loadError) {
        return (
          <p className="chatkit-sidebar__section-error" aria-live="polite">
            {loadError}
          </p>
        );
      }

      if (workflows.length === 0) {
        return (
          <>
            <p className="chatkit-sidebar__section-text" aria-live="polite">
              Aucun workflow disponible pour le moment.
            </p>
            <button
              type="button"
              onClick={handleCreateWorkflow}
              disabled={loading}
              style={getCreateWorkflowButtonStyle(isMobileLayout, { disabled: loading })}
            >
              Nouveau
            </button>
          </>
        );
      }

      return (
        <ul className="chatkit-sidebar__workflow-list">
          {workflows.map((workflow) => {
            const isActive = workflow.id === selectedWorkflowId;
            const isMenuOpen = openWorkflowMenuId === workflow.id;
            const canDuplicate = !loading && workflow.id === selectedWorkflowId;
            const canDelete = !loading && !workflow.is_chatkit_default;
            const menuId = `workflow-actions-${workflow.id}`;
            const menuStyle = getActionMenuStyle(isMobileLayout);
            menuStyle.right = "var(--chatkit-sidebar-padding-x)";
            if (isMobileLayout) {
              menuStyle.left = "calc(-1 * var(--chatkit-sidebar-padding-x))";
              menuStyle.right = undefined;
              menuStyle.width = "calc(100% + (var(--chatkit-sidebar-padding-x) * 2))";
              menuStyle.minWidth = "0";
            }
            return (
              <li key={workflow.id} className="chatkit-sidebar__workflow-list-item">
                <button
                  type="button"
                  className="chatkit-sidebar__workflow-button"
                  onClick={() => handleSelectWorkflow(workflow.id)}
                  aria-current={isActive ? "true" : undefined}
                >
                  {workflow.display_name}
                </button>
                <div className="chatkit-sidebar__workflow-actions" data-workflow-menu-container="">
                  <button
                    type="button"
                    className="chatkit-sidebar__workflow-action-button"
                    data-workflow-menu-trigger=""
                    aria-haspopup="true"
                    aria-expanded={isMenuOpen}
                    aria-controls={menuId}
                    disabled={loading}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenWorkflowMenuId((current) =>
                        current === workflow.id ? null : workflow.id,
                      );
                    }}
                  >
                    <span aria-hidden="true">…</span>
                    <span className="visually-hidden">
                      Actions pour {workflow.display_name}
                    </span>
                  </button>
                </div>
                {isMenuOpen ? (
                  <div
                    id={menuId}
                    role="menu"
                    data-workflow-menu=""
                    className="chatkit-sidebar__workflow-menu"
                    style={menuStyle}
                  >
                    <button
                      type="button"
                      onClick={() => handleRenameWorkflow(workflow.id)}
                      disabled={loading}
                      style={getActionMenuItemStyle(isMobileLayout, {
                        disabled: loading,
                      })}
                    >
                      Renommer
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDuplicateWorkflow(workflow.id)}
                      disabled={!canDuplicate}
                      style={getActionMenuItemStyle(isMobileLayout, {
                        disabled: !canDuplicate,
                      })}
                    >
                      Dupliquer
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteWorkflow(workflow.id)}
                      disabled={!canDelete}
                      style={getActionMenuItemStyle(isMobileLayout, {
                        disabled: !canDelete,
                        danger: true,
                      })}
                    >
                      Supprimer
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      );
    };

    return (
      <section className="chatkit-sidebar__section" aria-labelledby={`${sectionId}-title`}>
        <div className="chatkit-sidebar__section-header">
          <h2 id={`${sectionId}-title`} className="chatkit-sidebar__section-title">
            Workflow
          </h2>
        </div>
        {renderWorkflowList()}
        {workflows.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: isMobileLayout ? "column" : "row",
              gap: "0.5rem",
              alignItems: isMobileLayout ? "stretch" : "center",
            }}
          >
            <button
              type="button"
              onClick={handleCreateWorkflow}
              disabled={loading}
              style={getCreateWorkflowButtonStyle(isMobileLayout, { disabled: loading })}
            >
              Nouveau
            </button>
          </div>
        ) : null}
        {selectedWorkflow?.description ? (
          <p className="chatkit-sidebar__section-text">
            {selectedWorkflow.description}
          </p>
        ) : null}
        {selectedWorkflow && !selectedWorkflow.active_version_id ? (
          <p className="chatkit-sidebar__section-text" style={warningStyle}>
            Publiez une version pour l'utiliser.
          </p>
        ) : null}
      </section>
    );
  }, [
    handleCreateWorkflow,
    handleDeleteWorkflow,
    handleDuplicateWorkflow,
    handleRenameWorkflow,
    handleSelectWorkflow,
    isMobileLayout,
    loadError,
    loading,
    openWorkflowMenuId,
    selectedWorkflow,
    selectedWorkflowId,
    workflows,
  ]);

  useEffect(() => {
    setSidebarContent(workflowSidebarContent);
    return () => clearSidebarContent();
  }, [clearSidebarContent, setSidebarContent, workflowSidebarContent]);

  const renderBlockLibraryContent = () => {
    if (isMobileLayout) {
      return (
        <div className={styles.blockLibraryContent}>
          <div
            ref={(element) => {
              blockLibraryScrollRef.current = element;
              if (element && isBlockLibraryOpen) {
                scheduleBlockLibraryTransformUpdate();
              }
            }}
            className={styles.blockLibraryScroller}
            role="list"
            aria-label="Blocs disponibles"
          >
            {blockLibraryItems.map((item) => {
              const disabled = loading || !selectedWorkflowId;
              return (
                <div
                  key={item.key}
                  role="listitem"
                  className={styles.blockLibraryItemWrapper}
                  ref={(node) => {
                    if (node) {
                      blockLibraryItemRefs.current[item.key] = node;
                      scheduleBlockLibraryTransformUpdate();
                    } else {
                      delete blockLibraryItemRefs.current[item.key];
                    }
                  }}
                >
                  <button
                    type="button"
                    onClick={() => item.onClick()}
                    disabled={disabled}
                    style={getBlockLibraryButtonStyle(disabled)}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: "2.85rem",
                        height: "2.85rem",
                        borderRadius: "0.95rem",
                        background: item.color,
                        color: "#fff",
                        display: "grid",
                        placeItems: "center",
                        fontWeight: 700,
                        fontSize: "1.25rem",
                      }}
                    >
                      {item.shortLabel}
                    </span>
                    <span
                      style={{
                        fontSize: "1.05rem",
                        fontWeight: 600,
                        lineHeight: 1.1,
                      }}
                    >
                      {item.label}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    const primaryTextColor = "var(--text-color)";
    const secondaryTextColor = "var(--text-muted)";
    return (
      <div>
        <div
          style={{
            marginBottom: "0.5rem",
            fontSize: "0.85rem",
            fontWeight: 600,
            color: secondaryTextColor,
          }}
        >
          Bibliothèque de blocs
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {blockLibraryItems.map((item) => {
            const disabled = loading || !selectedWorkflowId;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => item.onClick()}
                disabled={disabled}
                style={getBlockLibraryButtonStyle(disabled)}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: "2.35rem",
                    height: "2.35rem",
                    borderRadius: "0.75rem",
                    background: item.color,
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 700,
                    fontSize: "1.05rem",
                  }}
                >
                  {item.shortLabel}
                </span>
                <div style={{ textAlign: "left", color: primaryTextColor }}>
                  <strong style={{ fontSize: "1rem" }}>{item.label}</strong>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const hasSelectedElement = Boolean(selectedNode || selectedEdge);
  const showPropertiesPanel = hasSelectedElement && (!isMobileLayout || isPropertiesPanelOpen);

  const versionIdToPromote = useMemo(
    () => resolveVersionIdToPromote(false, { selectedId: selectedVersionId }),
    [resolveVersionIdToPromote, selectedVersionId],
  );

  const versionSummaryForPromotion = useMemo(() => {
    if (versionIdToPromote == null) {
      return null;
    }
    return versions.find((version) => version.id === versionIdToPromote) ?? null;
  }, [versionIdToPromote, versions]);

  const isPromotingDraft = Boolean(
    versionSummaryForPromotion && draftVersionIdRef.current === versionSummaryForPromotion.id,
  );

  const deployModalTitle = versionSummaryForPromotion
    ? isPromotingDraft
      ? t("workflowBuilder.deploy.modal.titlePublishDraft")
      : t("workflowBuilder.deploy.modal.titlePromoteSelected")
    : t("workflowBuilder.deploy.modal.titleMissing");

  const deployModalDescription = versionSummaryForPromotion
    ? isPromotingDraft
      ? t("workflowBuilder.deploy.modal.descriptionPublishDraft")
      : t("workflowBuilder.deploy.modal.descriptionPromoteSelected", {
          version: versionSummaryForPromotion.version,
        })
    : t("workflowBuilder.deploy.modal.descriptionMissing");

  const deployModalSourceLabel = versionSummaryForPromotion
    ? isPromotingDraft
      ? t("workflowBuilder.deploy.modal.path.draft")
      : t("workflowBuilder.deploy.modal.path.selectedWithVersion", {
          version: versionSummaryForPromotion.version,
        })
    : t("workflowBuilder.deploy.modal.path.draft");

  const deployModalTargetLabel = versionSummaryForPromotion
    ? isPromotingDraft
      ? t("workflowBuilder.deploy.modal.path.newVersion")
      : t("workflowBuilder.deploy.modal.path.production")
    : t("workflowBuilder.deploy.modal.path.production");

  const deployModalPrimaryLabel = versionSummaryForPromotion
    ? isPromotingDraft
      ? t("workflowBuilder.deploy.modal.action.publish")
      : t("workflowBuilder.deploy.modal.action.deploy")
    : t("workflowBuilder.deploy.modal.action.publish");

  const isPrimaryActionDisabled = !versionSummaryForPromotion || isDeploying;
  const selectedElementLabel = selectedNode
    ? selectedNode.data.displayName.trim() || labelForKind(selectedNode.data.kind)
    : selectedEdge
      ? `${selectedEdge.source} → ${selectedEdge.target}`
      : "";

  const headerOverlayOffset = useMemo(() => (isMobileLayout ? "4rem" : "4.25rem"), [isMobileLayout]);

  const floatingPanelStyle = useMemo<CSSProperties | undefined>(() => {
    if (isMobileLayout) {
      return undefined;
    }
    return {
      top: `calc(${headerOverlayOffset} + 1.5rem)`,
      maxHeight: `calc(100% - (${headerOverlayOffset} + 3rem))`,
    };
  }, [headerOverlayOffset, isMobileLayout]);

  const propertiesPanelElement = (
    <aside
      id={propertiesPanelId}
      aria-label="Propriétés du bloc sélectionné"
      aria-labelledby={propertiesPanelTitleId}
      className={isMobileLayout ? styles.propertiesPanelMobile : styles.propertiesPanel}
      role={isMobileLayout ? "dialog" : undefined}
      aria-modal={isMobileLayout ? true : undefined}
      onClick={isMobileLayout ? (event) => event.stopPropagation() : undefined}
      style={!isMobileLayout ? floatingPanelStyle : undefined}
    >
      <header className={styles.propertiesPanelHeader}>
        <div className={styles.propertiesPanelHeaderMeta}>
          <p className={styles.propertiesPanelOverline}>Propriétés du bloc</p>
          <h2 id={propertiesPanelTitleId} className={styles.propertiesPanelTitle}>
            {selectedElementLabel || "Bloc"}
          </h2>
        </div>
        <button
          type="button"
          ref={propertiesPanelCloseButtonRef}
          onClick={handleClosePropertiesPanel}
          aria-label="Fermer le panneau de propriétés"
          className={styles.propertiesPanelCloseButton}
        >
          ×
        </button>
      </header>
      <div className={styles.propertiesPanelBody}>
        {selectedNode ? (
          <NodeInspector
            node={selectedNode}
            onDisplayNameChange={handleDisplayNameChange}
            onAgentMessageChange={handleAgentMessageChange}
            onAgentModelChange={handleAgentModelChange}
            onAgentReasoningChange={handleAgentReasoningChange}
            onAgentReasoningSummaryChange={handleAgentReasoningSummaryChange}
            onAgentTextVerbosityChange={handleAgentTextVerbosityChange}
            onAgentTemperatureChange={handleAgentTemperatureChange}
            onAgentTopPChange={handleAgentTopPChange}
            onAgentMaxOutputTokensChange={handleAgentMaxOutputTokensChange}
            onAgentResponseFormatKindChange={handleAgentResponseFormatKindChange}
            onAgentResponseFormatNameChange={handleAgentResponseFormatNameChange}
            onAgentResponseFormatSchemaChange={handleAgentResponseFormatSchemaChange}
            onAgentResponseWidgetSlugChange={handleAgentResponseWidgetSlugChange}
            onAgentResponseWidgetSourceChange={handleAgentResponseWidgetSourceChange}
            onAgentResponseWidgetDefinitionChange={
              handleAgentResponseWidgetDefinitionChange
            }
            onWidgetNodeSlugChange={handleWidgetNodeSlugChange}
            onWidgetNodeSourceChange={handleWidgetNodeSourceChange}
            onWidgetNodeDefinitionExpressionChange={
              handleWidgetNodeDefinitionExpressionChange
            }
            onWidgetNodeVariablesChange={handleWidgetNodeVariablesChange}
            onWidgetNodeAwaitActionChange={handleWidgetNodeAwaitActionChange}
            onAgentIncludeChatHistoryChange={handleAgentIncludeChatHistoryChange}
            onAgentDisplayResponseInChatChange={handleAgentDisplayResponseInChatChange}
            onAgentShowSearchSourcesChange={handleAgentShowSearchSourcesChange}
            onAgentContinueOnErrorChange={handleAgentContinueOnErrorChange}
            onAgentStorePreferenceChange={handleAgentStorePreferenceChange}
            onAgentWebSearchChange={handleAgentWebSearchChange}
            onAgentFileSearchChange={handleAgentFileSearchChange}
            onAgentImageGenerationChange={handleAgentImageGenerationChange}
            onVectorStoreNodeConfigChange={handleVectorStoreNodeConfigChange}
            onTransformExpressionsChange={handleTransformExpressionsChange}
            onStartAutoRunChange={handleStartAutoRunChange}
            onStartAutoRunMessageChange={handleStartAutoRunMessageChange}
            onStartAutoRunAssistantMessageChange={
              handleStartAutoRunAssistantMessageChange
            }
            onConditionPathChange={handleConditionPathChange}
            onConditionModeChange={handleConditionModeChange}
            onConditionValueChange={handleConditionValueChange}
            availableModels={availableModels}
            availableModelsLoading={availableModelsLoading}
            availableModelsError={availableModelsError}
            isReasoningModel={isReasoningModel}
            onAgentWeatherToolChange={handleAgentWeatherToolChange}
            onAgentWidgetValidationToolChange={handleAgentWidgetValidationToolChange}
            vectorStores={vectorStores}
            vectorStoresLoading={vectorStoresLoading}
            vectorStoresError={vectorStoresError}
            widgets={widgets}
            widgetsLoading={widgetsLoading}
            widgetsError={widgetsError}
            onStateAssignmentsChange={handleStateAssignmentsChange}
            onEndMessageChange={handleEndMessageChange}
            onAssistantMessageChange={handleAssistantMessageChange}
            onAssistantMessageStreamEnabledChange={
              handleAssistantMessageStreamEnabledChange
            }
            onAssistantMessageStreamDelayChange={
              handleAssistantMessageStreamDelayChange
            }
            onWaitForUserInputMessageChange={
              handleWaitForUserInputMessageChange
            }
            onUserMessageChange={handleUserMessageChange}
            onRemove={handleRemoveNode}
          />
        ) : selectedEdge ? (
          <EdgeInspector
            edge={selectedEdge}
            onConditionChange={handleConditionChange}
            onLabelChange={handleEdgeLabelChange}
            onRemove={handleRemoveEdge}
          />
        ) : null}
      </div>
    </aside>
  );
  const toastStyles = useMemo(() => {
    switch (saveState) {
      case "error":
        return {
          background: "rgba(239, 68, 68, 0.18)",
          color: "#b91c1c",
          border: "1px solid rgba(248, 113, 113, 0.35)",
        } as const;
      case "saving":
        return {
          background: "rgba(14, 165, 233, 0.18)",
          color: "#0284c7",
          border: "1px solid rgba(56, 189, 248, 0.35)",
        } as const;
      case "saved":
        return {
          background: "rgba(34, 197, 94, 0.18)",
          color: "#15803d",
          border: "1px solid rgba(74, 222, 128, 0.35)",
        } as const;
      default:
        return {
          background: "var(--color-surface-subtle)",
          color: "var(--text-color)",
          border: "1px solid var(--surface-border)",
        } as const;
    }
  }, [saveState]);

  useEffect(() => {
    const key = viewportKeyFor(selectedWorkflowId, selectedVersionId);
    viewportKeyRef.current = key;
    const savedViewport = key ? viewportMemoryRef.current.get(key) ?? null : null;
    viewportRef.current = savedViewport;
    hasUserViewportChangeRef.current = savedViewport != null;
    pendingViewportRestoreRef.current = true;
  }, [selectedVersionId, selectedWorkflowId]);

  const headerStyle = useMemo(() => {
    const baseStyle = getHeaderContainerStyle(isMobileLayout);
    return { ...baseStyle, position: "absolute", top: 0, left: 0, right: 0 };
  }, [isMobileLayout]);

  const workspaceWrapperStyle = useMemo<CSSProperties>(() => {
    if (isMobileLayout) {
      return { position: "absolute", inset: 0, overflow: "hidden" };
    }
    return { position: "relative", flex: 1, overflow: "hidden", minHeight: 0 };
  }, [isMobileLayout]);

  const shouldShowWorkflowDescription = !isMobileLayout && Boolean(selectedWorkflow?.description);
  const shouldShowPublicationReminder =
    !isMobileLayout && Boolean(selectedWorkflow) && !selectedWorkflow?.active_version_id;

  const workspaceContentStyle = useMemo<CSSProperties>(() => {
    if (isMobileLayout) {
      return {
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: "0",
      };
    }

    const hasWorkflowMeta = shouldShowWorkflowDescription || shouldShowPublicationReminder;

    return {
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      gap: hasWorkflowMeta ? "1rem" : "0",
      paddingTop: `calc(${headerOverlayOffset}${hasWorkflowMeta ? " + 1.5rem" : ""})`,
      paddingBottom: 0,
      paddingLeft: "1.5rem",
      paddingRight: "1.5rem",
    };
  }, [
    headerOverlayOffset,
    isMobileLayout,
    shouldShowPublicationReminder,
    shouldShowWorkflowDescription,
  ]);

  const editorContainerStyle = useMemo<CSSProperties>(() => {
    const baseStyle: CSSProperties = {
      flex: 1,
      minHeight: 0,
      borderRadius: isMobileLayout ? 0 : "1.25rem",
      border: isMobileLayout ? "none" : "1px solid var(--surface-border)",
      background: "var(--surface-strong)",
      overflow: "hidden",
      boxShadow: isMobileLayout ? "none" : "var(--shadow-card)",
    };

    if (!isMobileLayout && !(shouldShowWorkflowDescription || shouldShowPublicationReminder)) {
      baseStyle.marginTop = `calc(-1 * ${headerOverlayOffset})`;
    }

    return baseStyle;
  }, [
    headerOverlayOffset,
    isMobileLayout,
    shouldShowPublicationReminder,
    shouldShowWorkflowDescription,
  ]);

  return (
    <ReactFlowProvider>
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          background: isMobileLayout ? "transparent" : "var(--color-surface-subtle)",
          overflow: "hidden",
        }}
      >
        <header style={headerStyle}>
          <button
            type="button"
            onClick={openSidebar}
            aria-label="Ouvrir la navigation générale"
            style={getHeaderNavigationButtonStyle(isMobileLayout)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          {renderHeaderControls()}
        </header>

        <div style={workspaceWrapperStyle}>
          <div style={workspaceContentStyle}>
            {shouldShowWorkflowDescription ? renderWorkflowDescription() : null}
            {shouldShowPublicationReminder ? renderWorkflowPublicationReminder() : null}
            <div
              ref={reactFlowContainerRef}
              style={editorContainerStyle}
              aria-label="Éditeur visuel du workflow"
            >
              {loading ? (
                <div style={loadingStyle}>Chargement du workflow…</div>
              ) : loadError ? (
                <div style={loadingStyle} role="alert">
                  {loadError}
                </div>
              ) : (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={handleEdgesChange}
                  onNodeDragStart={handleNodeDragStart}
                  onNodeDragStop={handleNodeDragStop}
                  onNodeClick={handleNodeClick}
                  onEdgeClick={handleEdgeClick}
                  onPaneClick={handleClearSelection}
                  onConnect={onConnect}
                  defaultEdgeOptions={defaultEdgeOptions}
                  connectionLineStyle={connectionLineStyle}
                  selectionOnDrag={!isMobileLayout}
                  panOnDrag={isMobileLayout ? true : [1, 2]}
                  multiSelectionKeyCode={['Meta', 'Control']}
                  onSelectionChange={handleSelectionChange}
                  style={{ background: isMobileLayout ? "transparent" : "#f8fafc", height: "100%" }}
                  minZoom={minViewportZoom}
                  onInit={(instance) => {
                    reactFlowInstanceRef.current = instance;
                    refreshViewportConstraints(instance);
                    if (pendingViewportRestoreRef.current) {
                      restoreViewport();
                    }
                  }}
                  onMoveEnd={(_, viewport) => {
                    if (isHydratingRef.current) {
                      return;
                    }
                    viewportRef.current = viewport;
                    hasUserViewportChangeRef.current = true;
                    const key = viewportKeyRef.current;
                    if (key) {
                      viewportMemoryRef.current.set(key, { ...viewport });
                      persistViewportMemory();
                    }
                  }}
                >
                  <Background gap={18} size={1} />
                  {!isMobileLayout ? (
                    <MiniMap
                      nodeStrokeColor={(node) => NODE_COLORS[(node.data as FlowNodeData).kind]}
                      nodeColor={(node) => NODE_COLORS[(node.data as FlowNodeData).kind]}
                    />
                  ) : null}
                  <Controls />
                </ReactFlow>
              )}
            </div>
          </div>
          {isMobileLayout ? (
            <>
              {isBlockLibraryOpen ? (
                <div
                  className={styles.mobileOverlay}
                  role="presentation"
                  onClick={(event) => {
                    if (event.target === event.currentTarget) {
                      closeBlockLibrary({ focusToggle: true });
                    }
                  }}
                >
                  <aside
                    id={blockLibraryId}
                    aria-label="Bibliothèque de blocs"
                    className={`${styles.blockLibrary} ${styles.blockLibraryMobile}`}
                    role="dialog"
                    aria-modal="true"
                  >
                    {renderBlockLibraryContent()}
                  </aside>
                </div>
              ) : null}
              <button
                type="button"
                ref={blockLibraryToggleRef}
                className={styles.mobileToggleButton}
                onClick={toggleBlockLibrary}
                aria-controls={blockLibraryId}
                aria-expanded={isBlockLibraryOpen}
              >
                <span aria-hidden="true">{isBlockLibraryOpen ? "×" : "+"}</span>
                <span className={styles.srOnly}>
                  {isBlockLibraryOpen ? "Fermer la bibliothèque de blocs" : "Ouvrir la bibliothèque de blocs"}
                </span>
              </button>
            </>
          ) : (
            <aside
              id={blockLibraryId}
              aria-label="Bibliothèque de blocs"
              className={styles.blockLibrary}
              style={floatingPanelStyle}
            >
              {renderBlockLibraryContent()}
            </aside>
          )}
          {isMobileLayout && hasSelectedElement ? (
            <button
              type="button"
              ref={propertiesPanelToggleRef}
              className={styles.propertiesToggleButton}
              onClick={isPropertiesPanelOpen ? handleClosePropertiesPanel : handleOpenPropertiesPanel}
              aria-controls={propertiesPanelId}
              aria-expanded={isPropertiesPanelOpen}
            >
              {isPropertiesPanelOpen ? "Masquer les propriétés" : "Propriétés du bloc"}
            </button>
          ) : null}
          {showPropertiesPanel ? (
            isMobileLayout ? (
              <div
                className={styles.propertiesPanelOverlay}
                role="presentation"
                onClick={handleClosePropertiesPanel}
              >
                {propertiesPanelElement}
              </div>
            ) : (
              propertiesPanelElement
            )
          ) : null}
        </div>
        {saveMessage ? (
          <div
            style={{
              position: "absolute",
                bottom: "1.5rem",
                left: "50%",
                transform: "translateX(-50%)",
                padding: "0.65rem 1.25rem",
                borderRadius: "9999px",
                boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)",
                zIndex: 30,
                ...toastStyles,
              }}
              role={saveState === "error" ? "alert" : "status"}
            >
              {saveMessage}
            </div>
          ) : null}
          {isDeployModalOpen ? (
            <div
              role="presentation"
              onClick={handleCloseDeployModal}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1.5rem",
                zIndex: 30,
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="deploy-dialog-title"
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: "100%",
                  maxWidth: "460px",
                  background: "var(--surface-strong)",
                  borderRadius: "1rem",
                  boxShadow: "var(--shadow-card)",
                  padding: "1.75rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1.25rem",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <h2
                    id="deploy-dialog-title"
                    style={{
                      fontSize: "1.35rem",
                      fontWeight: 700,
                      color: "var(--color-text-strong)",
                      margin: 0,
                    }}
                  >
                    {deployModalTitle}
                  </h2>
                  <p style={{ margin: 0, color: "var(--text-muted)", lineHeight: 1.45 }}>
                    {deployModalDescription}
                  </p>
                  {versionSummaryForPromotion ? (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        fontWeight: 600,
                        color: "var(--text-color)",
                      }}
                    >
                      <span
                        style={{ padding: "0.25rem 0.5rem", background: "#e2e8f0", borderRadius: "999px" }}
                      >
                        {deployModalSourceLabel}
                      </span>
                      <span aria-hidden="true">→</span>
                      <span
                        style={{ padding: "0.25rem 0.5rem", background: "#dcfce7", borderRadius: "999px" }}
                      >
                        {deployModalTargetLabel}
                      </span>
                    </div>
                  ) : null}
                </div>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    fontWeight: 600,
                    color: "var(--text-color)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={deployToProduction}
                    onChange={(event) => setDeployToProduction(event.target.checked)}
                    disabled={isDeploying}
                    style={{ width: "1.2rem", height: "1.2rem" }}
                  />
                  {t("workflowBuilder.deploy.modal.productionToggle")}
                </label>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
                  <button
                    type="button"
                    onClick={handleCloseDeployModal}
                    disabled={isDeploying}
                    style={{
                      padding: "0.6rem 1.2rem",
                      borderRadius: "0.75rem",
                      border: "1px solid var(--surface-border)",
                      background: "var(--surface-strong)",
                      color: "var(--text-color)",
                      fontWeight: 600,
                      cursor: isDeploying ? "not-allowed" : "pointer",
                      opacity: isDeploying ? 0.5 : 1,
                    }}
                  >
                    {t("workflowBuilder.deploy.modal.action.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDeploy}
                    disabled={isPrimaryActionDisabled}
                    style={{
                      padding: "0.6rem 1.2rem",
                      borderRadius: "0.75rem",
                      border: "none",
                      background: "#2563eb",
                      color: "#fff",
                      fontWeight: 700,
                      cursor: isPrimaryActionDisabled ? "not-allowed" : "pointer",
                      opacity: isPrimaryActionDisabled ? 0.7 : 1,
                    }}
                  >
                    {deployModalPrimaryLabel}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </ReactFlowProvider>
  );
};

export default WorkflowBuilderPage;
