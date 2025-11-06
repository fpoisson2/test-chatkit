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
  type NodeChange,
  type ReactFlowInstance,
  ReactFlowProvider,
  type Viewport,
  useEdgesState,
  useNodesState,
} from "reactflow";

import "reactflow/dist/style.css";

import { ChevronDown, Copy, PenSquare, Redo2, Trash2, Undo2 } from "lucide-react";

import { useAuth } from "../../auth";
import { useI18n } from "../../i18n";
import { useAppLayout, useSidebarPortal } from "../../components/AppLayout";
import {
  buildWorkflowOrderingTimestamps,
  readStoredWorkflowSelection,
  readStoredWorkflowLastUsedMap,
  readWorkflowSidebarCache,
  readStoredWorkflowPinnedLookup,
  createEmptyStoredWorkflowPinned,
  type StoredWorkflowPinned,
  type StoredWorkflowPinnedLookup,
  type StoredWorkflowLastUsedAt,
  updateStoredWorkflowSelection,
  WORKFLOW_SELECTION_CHANGED_EVENT,
  writeWorkflowSidebarCache,
} from "../workflows/utils";
import {
  chatkitApi,
  makeApiEndpointCandidates,
  modelRegistryApi,
  widgetLibraryApi,
  vectorStoreApi,
  type AvailableModel,
  type HostedWorkflowMetadata,
  type WidgetTemplateSummary,
  type VectorStoreSummary,
} from "../../utils/backend";
import { resolveAgentParameters, resolveStateParameters } from "../../utils/agentPresets";
import {
  getAgentFileSearchConfig,
  getAgentWorkflowTools,
  getAgentResponseFormat,
  getAgentNestedWorkflow,
  setAgentContinueOnError,
  setAgentDisplayResponseInChat,
  setAgentFileSearchConfig,
  setAgentImageGenerationConfig,
  setAgentIncludeChatHistory,
  setAgentMaxOutputTokens,
  setAgentMessage,
  setAgentModel,
  setAgentModelProvider,
  setAgentComputerUseConfig,
  setAgentReasoningEffort,
  setAgentReasoningSummary,
  setAgentTextVerbosity,
  setAgentResponseFormatKind,
  setAgentResponseFormatName,
  setAgentResponseFormatSchema,
  setAgentResponseWidgetSlug,
  setAgentResponseWidgetSource,
  setAgentResponseWidgetDefinition,
  setAgentNestedWorkflow,
  setAgentShowSearchSources,
  setAgentStorePreference,
  setAgentTemperature,
  setAgentTopP,
  setAgentWeatherToolEnabled,
  setAgentWorkflowValidationToolEnabled,
  setAgentWorkflowTools,
  setAgentWidgetValidationToolEnabled,
  setAgentWebSearchConfig,
  setVoiceAgentVoice,
  setVoiceAgentStartBehavior,
  setVoiceAgentStopBehavior,
  setVoiceAgentToolEnabled,
  setTranscriptionModel,
  setTranscriptionLanguage,
  setTranscriptionPrompt,
  setStateAssignments,
  setStartAutoRun,
  setStartAutoRunMessage,
  setStartAutoRunAssistantMessage,
  setStartTelephonySipAccountId,
  setStartTelephonyRingTimeout,
  setStartTelephonySpeakFirst,
  setConditionMode,
  setConditionPath,
  setConditionValue,
  setParallelSplitJoinSlug,
  setParallelSplitBranches,
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
  createVoiceAgentParameters,
  resolveVoiceAgentParameters,
  resolveStartParameters,
  createParallelSplitParameters,
  createParallelJoinParameters,
  resolveParallelSplitParameters,
  getParallelSplitJoinSlug,
  getParallelSplitBranches,
  type WorkflowToolConfig,
  type McpSseToolConfig,
  setAgentMcpServers,
} from "../../utils/workflows";
import EdgeInspector from "./components/EdgeInspector";
import CreateWorkflowModal from "./components/CreateWorkflowModal";
import NodeInspector from "./components/NodeInspector";
import WorkflowAppearanceModal, {
  type WorkflowAppearanceTarget,
} from "../workflows/WorkflowAppearanceModal";

// ============================================================================
// Extracted Modules (Custom Hooks, Services, Components)
// ============================================================================
// Components integrated: useMediaQuery, SaveToast, DeployModal, WorkflowHeader,
// WorkflowSidebar, PropertiesPanel
// TODO: Integrate remaining hooks and services

// Custom Hooks - Extracted state management
import { useWorkflowState } from "./hooks/useWorkflowState";
import { useFlowState } from "./hooks/useFlowState";
import { useVersionState } from "./hooks/useVersionState";
import { useSaveState } from "./hooks/useSaveState";
import { useModalState } from "./hooks/useModalState";
import { useResourcesState } from "./hooks/useResourcesState";
import { useViewportState } from "./hooks/useViewportState";
import { useMediaQuery } from "./hooks/useMediaQuery";

// Services - Extracted API logic
import { WorkflowService } from "./services/workflowService";
import { VersionService } from "./services/versionService";
import { ImportExportService } from "./services/importExportService";

// UI Components - Extracted presentation logic
import { SaveToast } from "./components/modals/SaveToast";
import { DeployModal } from "./components/modals/DeployModal";
import { PropertiesPanel } from "./components/panels/PropertiesPanel";
import { BlockLibraryPanel } from "./components/panels/BlockLibraryPanel";
import { WorkflowHeader } from "./components/header/WorkflowHeader";
import { WorkflowSidebar } from "./components/sidebar/WorkflowSidebar";

// ============================================================================
import {
  parseWorkflowImport,
  WorkflowImportError,
  type ParsedWorkflowImport,
} from "./importWorkflow";
import type {
  AgentParameters,
  AgentNestedWorkflowSelection,
  ComputerUseConfig,
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
  VoiceAgentTool,
  VoiceAgentStartBehavior,
  VoiceAgentStopBehavior,
  ParallelBranch,
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
  getHeaderContainerStyle,
  loadingStyle,
  type ActionMenuPlacement,
} from "./styles";
import styles from "./WorkflowBuilderPage.module.css";

const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();
const DESKTOP_MIN_VIEWPORT_ZOOM = 0.1;
const MOBILE_MIN_VIEWPORT_ZOOM = 0.05;
const DESKTOP_WORKSPACE_HORIZONTAL_PADDING = "1.5rem";
const HISTORY_LIMIT = 50;
const REMOTE_VERSION_POLL_INTERVAL_MS = 10000;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

type DeviceType = "mobile" | "desktop";

type WorkflowViewportRecord = {
  workflow_id: number;
  version_id: number | null;
  device_type: DeviceType;
  x: number;
  y: number;
  zoom: number;
};

const isValidNodeKind = (value: string): value is NodeKind =>
  Object.prototype.hasOwnProperty.call(NODE_COLORS, value);
type AgentLikeKind = Extract<NodeKind, "agent" | "voice_agent">;
const isAgentKind = (kind: NodeKind): kind is AgentLikeKind =>
  kind === "agent" || kind === "voice_agent";

type ClassValue =
  | string
  | false
  | null
  | undefined
  | Record<string, boolean | null | undefined>;

const cx = (...values: ClassValue[]): string => {
  const classes: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (typeof value === "string") {
      classes.push(value);
      continue;
    }
    for (const [className, condition] of Object.entries(value)) {
      if (condition) {
        classes.push(className);
      }
    }
  }
  return classes.join(" ");
};

type WorkflowViewportListResponse = {
  viewports: WorkflowViewportRecord[];
};

const viewportKeyFor = (
  workflowId: number | null,
  versionId: number | null,
  deviceType: DeviceType | null,
) =>
  workflowId != null && deviceType != null
    ? `${deviceType}:${workflowId}:${versionId ?? "latest"}`
    : null;

const parseViewportKey = (
  key: string,
): {
  deviceType: DeviceType;
  workflowId: number;
  versionId: number | null;
} | null => {
  const [devicePart, workflowPart, versionPart] = key.split(":");
  if (devicePart !== "mobile" && devicePart !== "desktop") {
    return null;
  }
  const workflowId = Number.parseInt(workflowPart ?? "", 10);
  if (!Number.isFinite(workflowId)) {
    return null;
  }
  if (!versionPart || versionPart === "latest") {
    return { deviceType: devicePart, workflowId, versionId: null };
  }
  const versionId = Number.parseInt(versionPart, 10);
  if (!Number.isFinite(versionId)) {
    return null;
  }
  return { deviceType: devicePart, workflowId, versionId };
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

// useMediaQuery hook now imported from ./hooks/useMediaQuery (line 167)
// Removed inline definition (was 27 lines) - using extracted hook instead

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

  const extractSaveErrorMessage = useCallback(
    async (response: Response) => {
      try {
        const payload = (await response.json()) as { detail?: unknown };
        if (payload && typeof payload.detail === "string") {
          const trimmed = payload.detail.trim();
          if (trimmed) {
            return trimmed;
          }
        }
      } catch (error) {
        console.error("Impossible de lire la réponse d'erreur de sauvegarde", error);
      }
      return formatSaveFailureWithStatus(response.status);
    },
    [formatSaveFailureWithStatus],
  );
  const authHeader = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );
  const { openSidebar, closeSidebar, isSidebarCollapsed } = useAppLayout();
  const { setSidebarContent, setCollapsedSidebarContent, clearSidebarContent } = useSidebarPortal();

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
    [buildNodeStyle],
  );

  const decorateNodes = useCallback(
    (list: FlowNode[]): FlowNode[] => list.map(decorateNode),
    [decorateNode],
  );
  const initialSidebarCacheRef = useRef(readWorkflowSidebarCache());
  const initialStoredSelectionRef = useRef(readStoredWorkflowSelection());
  const initialSidebarCache = initialSidebarCacheRef.current;
  const initialStoredSelection = initialStoredSelectionRef.current;
  const initialSidebarCacheUsedRef = useRef(Boolean(initialSidebarCache));

  const [loading, setLoading] = useState(() => !initialSidebarCache);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
  const [edges, setEdges, applyEdgesChange] = useEdgesState<FlowEdgeData>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>(
    () => initialSidebarCache?.workflows ?? [],
  );
  const [hostedWorkflows, setHostedWorkflows] = useState<HostedWorkflowMetadata[]>(
    () => initialSidebarCache?.hostedWorkflows ?? [],
  );
  const [lastUsedAt, setLastUsedAt] = useState<StoredWorkflowLastUsedAt>(() =>
    buildWorkflowOrderingTimestamps(
      initialSidebarCache?.workflows ?? [],
      initialSidebarCache?.hostedWorkflows ?? [],
      readStoredWorkflowLastUsedMap(),
    ),
  );
  const [pinnedLookup, setPinnedLookup] = useState<StoredWorkflowPinnedLookup>(() =>
    readStoredWorkflowPinnedLookup(),
  );
  const workflowsRef = useRef(workflows);
  const hostedWorkflowsRef = useRef(hostedWorkflows);
  const workflowSortCollatorRef = useRef<Intl.Collator | null>(null);
  const hasLoadedWorkflowsRef = useRef(false);
  const [hostedLoading, setHostedLoading] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);
  const [isAppearanceModalOpen, setAppearanceModalOpen] = useState(false);
  const [appearanceModalTarget, setAppearanceModalTarget] =
    useState<WorkflowAppearanceTarget | null>(null);
  const appearanceModalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [versions, setVersions] = useState<WorkflowVersionSummary[]>([]);
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<WorkflowVersionResponse | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(() => {
    if (initialSidebarCache?.selectedWorkflowId != null) {
      return initialSidebarCache.selectedWorkflowId;
    }
    return initialStoredSelection?.localWorkflowId ?? null;
  });
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const updateHasPendingChanges = useCallback(
    (value: boolean | ((previous: boolean) => boolean)) => {
      setHasPendingChanges(value);
    },
    [],
  );
  const persistPinnedLookup = useCallback(
    (next: StoredWorkflowPinnedLookup) => {
      const pinnedForStorage: StoredWorkflowPinned = {
        local: Array.from(next.local),
        hosted: Array.from(next.hosted),
      };
      updateStoredWorkflowSelection((previous) => ({
        mode: previous?.mode ?? (selectedWorkflowId != null ? "local" : "hosted"),
        localWorkflowId: previous?.localWorkflowId ?? selectedWorkflowId ?? null,
        hostedSlug: previous?.hostedSlug ?? null,
        lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
        pinned: pinnedForStorage,
      }));
    },
    [selectedWorkflowId],
  );

  const toggleLocalPin = useCallback(
    (workflowId: number) => {
      setPinnedLookup((current) => {
        const next: StoredWorkflowPinnedLookup = {
          local: new Set(current.local),
          hosted: new Set(current.hosted),
        };
        if (next.local.has(workflowId)) {
          next.local.delete(workflowId);
        } else {
          next.local.add(workflowId);
        }
        persistPinnedLookup(next);
        return next;
      });
    },
    [persistPinnedLookup],
  );

  const toggleHostedPin = useCallback(
    (slug: string) => {
      setPinnedLookup((current) => {
        const next: StoredWorkflowPinnedLookup = {
          local: new Set(current.local),
          hosted: new Set(current.hosted),
        };
        if (next.hosted.has(slug)) {
          next.hosted.delete(slug);
        } else {
          next.hosted.add(slug);
        }
        persistPinnedLookup(next);
        return next;
      });
    },
    [persistPinnedLookup],
  );
  const [vectorStores, setVectorStores] = useState<VectorStoreSummary[]>([]);
  const [vectorStoresLoading, setVectorStoresLoading] = useState(false);
  const [vectorStoresError, setVectorStoresError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [availableModelsLoading, setAvailableModelsLoading] = useState(false);
  const [availableModelsError, setAvailableModelsError] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<WidgetTemplateSummary[]>([]);
  const [widgetsLoading, setWidgetsLoading] = useState(false);
  const [widgetsError, setWidgetsError] = useState<string | null>(null);
  const [openWorkflowMenuId, setOpenWorkflowMenuId] = useState<string | number | null>(null);
  const [isDeployModalOpen, setDeployModalOpen] = useState(false);
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [createWorkflowKind, setCreateWorkflowKind] = useState<"local" | "hosted">("local");
  const [createWorkflowName, setCreateWorkflowName] = useState("");
  const [createWorkflowRemoteId, setCreateWorkflowRemoteId] = useState("");
  const [createWorkflowError, setCreateWorkflowError] = useState<string | null>(null);
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);
  const [deployToProduction, setDeployToProduction] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isMobileActionsOpen, setIsMobileActionsOpen] = useState(false);
  const [workflowMenuPlacement, setWorkflowMenuPlacement] =
    useState<ActionMenuPlacement>("up");
  const closeWorkflowMenu = useCallback(() => {
    setOpenWorkflowMenuId(null);
    setWorkflowMenuPlacement("up");
  }, []);
  const handleCloseAppearanceModal = useCallback(() => {
    setAppearanceModalOpen(false);
    setAppearanceModalTarget(null);
    const trigger = appearanceModalTriggerRef.current;
    appearanceModalTriggerRef.current = null;
    if (trigger) {
      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        window.requestAnimationFrame(() => {
          trigger.focus();
        });
      } else {
        trigger.focus();
      }
    }
  }, []);
  const openAppearanceModal = useCallback(
    (target: WorkflowAppearanceTarget, trigger?: HTMLButtonElement | null) => {
      closeWorkflowMenu();
      setAppearanceModalTarget(target);
      setAppearanceModalOpen(true);
      appearanceModalTriggerRef.current = trigger ?? null;
    },
    [closeWorkflowMenu],
  );
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const draftVersionIdRef = useRef<number | null>(null);
  const draftVersionSummaryRef = useRef<WorkflowVersionSummary | null>(null);
  const versionsRef = useRef<WorkflowVersionSummary[]>([]);
  const selectedWorkflowIdRef = useRef<number | null>(null);
  const hasPendingChangesRef = useRef(hasPendingChanges);
  const saveStateRef = useRef<SaveState>(saveState);

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
  const mobileActionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const blockLibraryScrollRef = useRef<HTMLDivElement | null>(null);
  const blockLibraryItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const blockLibraryAnimationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof Intl === "undefined" || typeof Intl.Collator !== "function") {
      return;
    }

    if (!workflowSortCollatorRef.current) {
      workflowSortCollatorRef.current = new Intl.Collator(undefined, {
        sensitivity: "base",
      });
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleSelectionChange = () => {
      setLastUsedAt(
        buildWorkflowOrderingTimestamps(
          workflowsRef.current,
          hostedWorkflowsRef.current,
          readStoredWorkflowLastUsedMap(),
        ),
      );
      setPinnedLookup(readStoredWorkflowPinnedLookup());
    };

    window.addEventListener(WORKFLOW_SELECTION_CHANGED_EVENT, handleSelectionChange);
    return () => {
      window.removeEventListener(WORKFLOW_SELECTION_CHANGED_EVENT, handleSelectionChange);
    };
  }, []);

  useEffect(() => {
    workflowsRef.current = workflows;
  }, [workflows]);

  useEffect(() => {
    hostedWorkflowsRef.current = hostedWorkflows;
  }, [hostedWorkflows]);

  useEffect(() => {
    setLastUsedAt(
      buildWorkflowOrderingTimestamps(workflows, hostedWorkflows, readStoredWorkflowLastUsedMap()),
    );
  }, [hostedWorkflows, workflows]);

  const isMobileLayout = useMediaQuery("(max-width: 768px)");
  const deviceType: DeviceType = isMobileLayout ? "mobile" : "desktop";
  const baseMinViewportZoom = useMemo(
    () => (isMobileLayout ? MOBILE_MIN_VIEWPORT_ZOOM : DESKTOP_MIN_VIEWPORT_ZOOM),
    [isMobileLayout],
  );
  const [minViewportZoom, setMinViewportZoom] = useState(baseMinViewportZoom);
  const [initialViewport, setInitialViewport] = useState<Viewport | undefined>(undefined);

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
        device_type: parsedKey.deviceType,
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
          if (reactFlowInstanceRef.current) {
            reactFlowInstanceRef.current.setViewport(targetViewport, { duration: 0 });
          }
        }, 10);

        setTimeout(() => {
          if (reactFlowInstanceRef.current) {
            reactFlowInstanceRef.current.setViewport(targetViewport, { duration: 0 });
          }
        }, 50);

        setTimeout(() => {
          if (reactFlowInstanceRef.current) {
            reactFlowInstanceRef.current.setViewport(targetViewport, { duration: 0 });
            const actualViewport = reactFlowInstanceRef.current.getViewport();
            const match = Math.abs(actualViewport.x - targetViewport.x) < 1 &&
                         Math.abs(actualViewport.y - targetViewport.y) < 1;
            // Update viewportRef only if viewport was successfully applied
            if (match) {
              viewportRef.current = actualViewport;
              const key = viewportKeyRef.current;
              if (key) {
                viewportMemoryRef.current.set(key, { ...actualViewport });
              }
            }
          }
        }, 100);
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
            const entryDeviceType: DeviceType =
              entry.device_type === "mobile" ? "mobile" : "desktop";
            const key = viewportKeyFor(entry.workflow_id, versionId, entryDeviceType);
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

  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNodeData>[]) => {
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdgeData>[]) => {
      if (changes.some((change) => change.type !== "select")) {
        updateHasPendingChanges(true);
      }
      applyEdgesChange(changes);
    },
    [applyEdgesChange, updateHasPendingChanges],
  );

  const [isBlockLibraryOpen, setBlockLibraryOpen] = useState<boolean>(() => !isMobileLayout);
  const blockLibraryToggleRef = useRef<HTMLButtonElement | null>(null);
  const propertiesPanelToggleRef = useRef<HTMLButtonElement | null>(null);
  const propertiesPanelCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isPropertiesPanelOpen, setPropertiesPanelOpen] = useState(false);
  const previousSelectedElementRef = useRef<string | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const selectedEdgeIdRef = useRef<string | null>(null);
  const lastTappedElementRef = useRef<{
    kind: "node" | "edge";
    id: string;
    tapCount: number;
  } | null>(null);
  const selectedNodeIdsRef = useRef<Set<string>>(new Set());
  const selectedEdgeIdsRef = useRef<Set<string>>(new Set());
  const isNodeDragInProgressRef = useRef(false);
  const copySequenceRef = useRef<{ count: number; lastTimestamp: number }>({
    count: 0,
    lastTimestamp: 0,
  });
  const nodesRef = useRef<FlowNode[]>([]);
  const edgesRef = useRef<FlowEdge[]>([]);
  const historyRef = useRef<{
    past: string[];
    future: string[];
    last: string | null;
    isRestoring: boolean;
    pendingSnapshot: string | null;
  }>({ past: [], future: [], last: null, isRestoring: false, pendingSnapshot: null });
  const resetHistory = useCallback((snapshot: string | null) => {
    historyRef.current.past = [];
    historyRef.current.future = [];
    historyRef.current.last = snapshot;
    historyRef.current.isRestoring = false;
    historyRef.current.pendingSnapshot = null;
  }, []);
  const isAuthenticated = Boolean(user);
  const isAdmin = Boolean(user?.is_admin);
  const blockLibraryId = "workflow-builder-block-library";
  const blockLibraryContentId = "workflow-builder-block-library-content";
  const propertiesPanelId = "workflow-builder-properties-panel";
  // propertiesPanelTitleId, mobileActionsDialogId, mobileActionsTitleId removed - now handled by extracted components
  const closeMobileActions = useCallback(
    (options: { focusTrigger?: boolean } = {}) => {
      setIsMobileActionsOpen(false);
      if (options.focusTrigger && mobileActionsTriggerRef.current) {
        mobileActionsTriggerRef.current.focus();
      }
    },
    [mobileActionsTriggerRef],
  );
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

  // Ferme les actions mobiles quand on n’est pas en layout mobile
  useEffect(() => {
    if (!isMobileLayout) {
      setIsMobileActionsOpen(false);
    }
  }, [isMobileLayout]);

  // Garde la ref des nodes à jour
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Garde la ref des edges à jour
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    versionsRef.current = versions;
  }, [versions]);

  useEffect(() => {
    draftVersionIdRef.current = null;
    draftVersionSummaryRef.current = null;
  }, [selectedWorkflowId]);

  useEffect(() => {
    selectedWorkflowIdRef.current = selectedWorkflowId;
  }, [selectedWorkflowId]);

  useEffect(() => {
    if (!token || !hasLoadedWorkflowsRef.current) {
      return;
    }

    setPinnedLookup((current) => {
      const availableLocalIds = new Set(workflows.map((workflow) => workflow.id));
      const availableHostedSlugs = new Set(
        hostedWorkflows.filter((workflow) => workflow.managed).map((workflow) => workflow.slug),
      );

      const nextLocal = Array.from(current.local).filter((id) => availableLocalIds.has(id));
      const nextHosted = Array.from(current.hosted).filter((slug) => availableHostedSlugs.has(slug));

      if (nextLocal.length === current.local.size && nextHosted.length === current.hosted.size) {
        return current;
      }

      const next: StoredWorkflowPinnedLookup = {
        local: new Set(nextLocal),
        hosted: new Set(nextHosted),
      };
      persistPinnedLookup(next);
      return next;
    });
  }, [hostedWorkflows, persistPinnedLookup, token, workflows]);

  useEffect(() => {
    updateStoredWorkflowSelection((previous) => {
      if (selectedWorkflowId == null) {
        if (!previous || previous.mode === "hosted" || previous.localWorkflowId == null) {
          return previous;
        }

        return { ...previous, localWorkflowId: null };
      }

      const preservedHostedSlug = previous?.hostedSlug ?? null;

      if (
        previous &&
        previous.mode === "local" &&
        previous.localWorkflowId === selectedWorkflowId &&
        previous.hostedSlug === preservedHostedSlug
      ) {
        return previous;
      }

      return {
        mode: "local",
        localWorkflowId: selectedWorkflowId,
        hostedSlug: preservedHostedSlug,
        lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
        pinned: previous?.pinned ?? createEmptyStoredWorkflowPinned(),
      };
    });
  }, [selectedWorkflowId]);

  useEffect(() => {
    if (workflows.length === 0 && hostedWorkflows.length === 0) {
      return;
    }

    const existingCache = readWorkflowSidebarCache();
    const storedSelection = initialStoredSelectionRef.current;

    writeWorkflowSidebarCache({
      workflows,
      hostedWorkflows,
      selectedWorkflowId,
      selectedHostedSlug: existingCache?.selectedHostedSlug ?? storedSelection?.hostedSlug ?? null,
      mode: existingCache?.mode ?? storedSelection?.mode ?? "local",
    });
  }, [hostedWorkflows, selectedWorkflowId, workflows]);

  useEffect(() => {
    hasPendingChangesRef.current = hasPendingChanges;
  }, [hasPendingChanges]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

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
    if (!isMobileActionsOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileActions({ focusTrigger: true });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMobileActions, isMobileActionsOpen]);

  useEffect(() => {
    if (!isMobileActionsOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (mobileActionsTriggerRef.current?.contains(target)) {
        return;
      }
      if (mobileActionsMenuRef.current?.contains(target)) {
        return;
      }
      closeMobileActions();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeMobileActions, isMobileActionsOpen]);

  useEffect(() => {
    if (!isBlockLibraryOpen) {
      closeWorkflowMenu();
    }
  }, [closeWorkflowMenu, isBlockLibraryOpen]);

  useEffect(() => {
    if (workflows.length === 0) {
      closeWorkflowMenu();
    }
  }, [closeWorkflowMenu, workflows.length]);

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
      closeWorkflowMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeWorkflowMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeWorkflowMenu, openWorkflowMenuId]);

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
          const nextClassName = styles.flowNode;
          const hasSameClassName = node.className === nextClassName;

          if (hasSameSelection && hasSameStyle && hasSameClassName) {
            return node;
          }

          return {
            ...node,
            selected: isSelected,
            style: nextStyle,
            className: nextClassName,
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

  // renderWorkflowDescription and renderWorkflowPublicationReminder functions inlined below

  // renderHeaderControls function removed - now handled by WorkflowHeader component (line 179)

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
          setSelectedVersionDetail(data);
          const flowNodes = data.graph.nodes.map<FlowNode>((node, index) => {
            const positionFromMetadata = extractPosition(node.metadata);
            const displayName = node.display_name ?? humanizeSlug(node.slug);
            const agentKey = isAgentKind(node.kind) ? node.agent_key ?? null : null;
            const parameters =
              node.kind === "agent"
                ? resolveAgentParameters(agentKey, node.parameters)
                : node.kind === "voice_agent"
                  ? resolveVoiceAgentParameters(node.parameters)
                  : node.kind === "state"
                    ? resolveStateParameters(node.slug, node.parameters)
                    : node.kind === "json_vector_store"
                      ? setVectorStoreNodeConfig(
                          {},
                          getVectorStoreNodeConfig(node.parameters),
                        )
                      : node.kind === "widget"
                        ? resolveWidgetNodeParameters(node.parameters)
                        : node.kind === "start"
                          ? resolveStartParameters(node.parameters)
                          : node.kind === "parallel_split"
                            ? resolveParallelSplitParameters(node.parameters)
                            : node.kind === "parallel_join"
                              ? ({ ...(node.parameters ?? {}) } as AgentParameters)
                              : resolveAgentParameters(null, node.parameters);
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
          updateHasPendingChanges(false);
          if (background) {
            historyRef.current.isRestoring = true;
            historyRef.current.pendingSnapshot = null;
            historyRef.current.last = nextSnapshot;
          } else {
            resetHistory(nextSnapshot);
          }
          setNodes(flowNodes);
          setEdges(flowEdges);
          // Reset isHydrating after a short delay to allow viewport restoration
          setTimeout(() => {
            isHydratingRef.current = false;
          }, 100);
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
                // Update initialViewport so ReactFlow uses it when re-rendering
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
            // This prevents flickering when the viewport is restored
            setTimeout(() => {
              setLoading(false);
            }, 250);
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
      setSelectedVersionDetail(null);
      if (!background) {
        setLoading(false);
      }
      return false;
    },
    [
      authHeader,
      applySelection,
      deviceType,
      persistViewportMemory,
      resetHistory,
      restoreViewport,
      setEdges,
      updateHasPendingChanges,
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
            const emptySnapshot = JSON.stringify(buildGraphPayloadFrom([], []));
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
      deviceType,
      loadVersionDetail,
      persistViewportMemory,
      resetHistory,
      restoreViewport,
      selectedWorkflowId,
      selectedVersionId,
      setEdges,
      updateHasPendingChanges,
      setNodes,
    ],
  );

  const loadWorkflows = useCallback(
    async (
      options: {
        selectWorkflowId?: number | null;
        selectVersionId?: number | null;
        excludeWorkflowId?: number | null;
        suppressLoadingState?: boolean;
      } = {},
    ): Promise<void> => {
      const {
        selectWorkflowId,
        selectVersionId,
        excludeWorkflowId,
        suppressLoadingState = false,
      } = options;
      hasLoadedWorkflowsRef.current = false;
      if (!suppressLoadingState) {
        setLoading(true);
      }
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
          hasLoadedWorkflowsRef.current = true;
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
            const emptySnapshot = JSON.stringify(buildGraphPayloadFrom([], []));
            lastSavedSnapshotRef.current = emptySnapshot;
            resetHistory(emptySnapshot);
            updateHasPendingChanges(false);
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
          const excluded = excludeWorkflowId ?? null;
          const chatkitWorkflow = data.find(
            (workflow) =>
              workflow.is_chatkit_default &&
              workflow.id !== excluded &&
              availableIds.has(workflow.id),
          );
          let nextWorkflowId = selectWorkflowId ?? null;
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
            await loadVersions(nextWorkflowId, selectVersionId ?? null, {
              background: suppressLoadingState,
            });
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
      hasLoadedWorkflowsRef.current = false;
    },
    [
      authHeader,
      loadVersions,
      persistViewportMemory,
      resetHistory,
      restoreViewport,
      selectedWorkflowId,
      setEdges,
      updateHasPendingChanges,
      setNodes,
    ],
  );

  const loadHostedWorkflows = useCallback(async () => {
    if (!token) {
      setHostedWorkflows([]);
      setHostedError(null);
      setHostedLoading(false);
      return;
    }

    setHostedLoading(true);
    setHostedError(null);
    try {
      const response = await chatkitApi.getHostedWorkflows(token, { cache: false });
      if (!response) {
        setHostedWorkflows([]);
      } else {
        setHostedWorkflows(response);
      }
    } catch (error) {
      setHostedWorkflows([]);
      const message =
        error instanceof Error
          ? error.message
          : t("workflowBuilder.hostedSection.loadError");
      setHostedError(message);
    } finally {
      setHostedLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    void loadWorkflows({ suppressLoadingState: initialSidebarCacheUsedRef.current });
    initialSidebarCacheUsedRef.current = false;
  }, [loadWorkflows]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !selectedWorkflowId ||
      !selectedVersionId ||
      saveState !== "idle" ||
      hasPendingChanges
    ) {
      return;
    }

    let isDisposed = false;
    let isPolling = false;

    const pollOnce = async () => {
      const workflowId = selectedWorkflowIdRef.current;
      const versionId = selectedVersionIdRef.current;
      if (
        workflowId == null ||
        versionId == null ||
        hasPendingChangesRef.current ||
        saveStateRef.current !== "idle"
      ) {
        return;
      }

      const candidates = makeApiEndpointCandidates(
        backendUrl,
        `/api/workflows/${workflowId}/versions`,
      );
      let reloadWorkflows = false;
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
          });
          if (!response.ok) {
            if (response.status === 404) {
              reloadWorkflows = true;
            }
            throw new Error(
              `Échec du rafraîchissement des versions (${response.status})`,
            );
          }
          const summaries: WorkflowVersionSummary[] = await response.json();
          const remoteById = new Map(summaries.map((item) => [item.id, item]));
          const currentVersions = versionsRef.current;
          const draftId = draftVersionIdRef.current;
          let shouldRefresh = false;

          for (const summary of summaries) {
            const local = currentVersions.find((item) => item.id === summary.id);
            if (!local) {
              shouldRefresh = true;
              break;
            }
            if (
              local.updated_at !== summary.updated_at ||
              local.version !== summary.version
            ) {
              shouldRefresh = true;
              break;
            }
          }

          if (!shouldRefresh) {
            for (const local of currentVersions) {
              if (local.id === draftId) {
                continue;
              }
              if (!remoteById.has(local.id)) {
                shouldRefresh = true;
                break;
              }
            }
          }

          if (
            shouldRefresh &&
            !hasPendingChangesRef.current &&
            saveStateRef.current === "idle" &&
            selectedWorkflowIdRef.current === workflowId &&
            selectedVersionIdRef.current === versionId
          ) {
            await loadVersions(workflowId, versionId, {
              background: true,
              preserveViewport: true,
            });
          }
          return;
        } catch (error) {
          continue;
        }
      }

      if (reloadWorkflows && !hasPendingChangesRef.current) {
        await loadWorkflows({ selectWorkflowId: null });
      }
    };

    const triggerPoll = () => {
      if (isDisposed || isPolling) {
        return;
      }
      if (hasPendingChangesRef.current || saveStateRef.current !== "idle") {
        return;
      }
      isPolling = true;
      void (async () => {
        try {
          await pollOnce();
        } finally {
          isPolling = false;
        }
      })();
    };

    triggerPoll();
    const intervalId = window.setInterval(triggerPoll, REMOTE_VERSION_POLL_INTERVAL_MS);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
    };
  }, [
    authHeader,
    backendUrl,
    hasPendingChanges,
    loadWorkflows,
    loadVersions,
    saveState,
    selectedVersionId,
    selectedWorkflowId,
  ]);

  useEffect(() => {
    void loadHostedWorkflows();
  }, [loadHostedWorkflows]);

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
      updateHasPendingChanges(true);
    },
    [setEdges, updateHasPendingChanges]
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: FlowNode) => {
      const lastTapped = lastTappedElementRef.current;
      const isSameElement = lastTapped?.kind === "node" && lastTapped.id === node.id;
      const nextTapCount = isSameElement ? Math.min(lastTapped.tapCount + 1, 2) : 1;
      lastTappedElementRef.current = { kind: "node", id: node.id, tapCount: nextTapCount };
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
      if (isMobileLayout && isSameElement && nextTapCount >= 2) {
        setPropertiesPanelOpen(true);
      }
    },
    [isMobileLayout],
  );

  const handleEdgeClick = useCallback(
    (_: unknown, edge: FlowEdge) => {
      const lastTapped = lastTappedElementRef.current;
      const isSameElement = lastTapped?.kind === "edge" && lastTapped.id === edge.id;
      const nextTapCount = isSameElement ? Math.min(lastTapped.tapCount + 1, 2) : 1;
      lastTappedElementRef.current = { kind: "edge", id: edge.id, tapCount: nextTapCount };
      setSelectedEdgeId(edge.id);
      setSelectedNodeId(null);
      if (isMobileLayout && isSameElement && nextTapCount >= 2) {
        setPropertiesPanelOpen(true);
      }
    },
    [isMobileLayout],
  );

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
    const history = historyRef.current;
    const pending = history.pendingSnapshot;
    if (!pending) {
      return;
    }
    if (history.last == null) {
      history.last = pending;
    } else if (history.last !== pending) {
      history.past = [...history.past, history.last].slice(-HISTORY_LIMIT);
      history.future = [];
      history.last = pending;
    }
    history.pendingSnapshot = null;
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
    if (!selectedElementKey) {
      setPropertiesPanelOpen(false);
      lastTappedElementRef.current = null;
      previousSelectedElementRef.current = selectedElementKey;
      return;
    }

    const isNewSelection = previousSelectedElementRef.current !== selectedElementKey;
    if (isNewSelection) {
      const matchesLastTap =
        (selectedNodeId &&
          lastTappedElementRef.current?.kind === "node" &&
          lastTappedElementRef.current.id === selectedNodeId) ||
        (selectedEdgeId &&
          lastTappedElementRef.current?.kind === "edge" &&
          lastTappedElementRef.current.id === selectedEdgeId);

      if (!matchesLastTap) {
        lastTappedElementRef.current = null;
      } else if (lastTappedElementRef.current) {
        lastTappedElementRef.current = {
          ...lastTappedElementRef.current,
          tapCount: 1,
        };
      }
    }

    if (isMobileLayout) {
      if (isNewSelection) {
        setPropertiesPanelOpen(false);
      }
    } else if (isNewSelection && !isNodeDragInProgressRef.current) {
      setPropertiesPanelOpen(true);
    }

    previousSelectedElementRef.current = selectedElementKey;
  }, [isMobileLayout, selectedEdgeId, selectedElementKey, selectedNodeId]);

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
          return decorateNode({
            ...node,
            data: nextData,
          });
        })
      );
    },
    [decorateNode, setNodes]
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

  const handleStartTelephonySipAccountIdChange = useCallback(
    (nodeId: string, sipAccountId: number | null) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartTelephonySipAccountId(data.parameters, sipAccountId);
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

  const handleStartTelephonyRingTimeoutChange = useCallback(
    (nodeId: string, ringTimeout: number) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartTelephonyRingTimeout(data.parameters, ringTimeout);
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

  const handleStartTelephonySpeakFirstChange = useCallback(
    (nodeId: string, speakFirst: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartTelephonySpeakFirst(data.parameters, speakFirst);
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

  const handleOutboundCallParametersChange = useCallback(
    (nodeId: string, parameters: Record<string, unknown>) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "outbound_call") {
          return data;
        }
        const nextParameters = parameters;
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
        if (!isAgentKind(data.kind)) {
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
    (
      nodeId: string,
      selection: {
        model: string;
        providerId?: string | null;
        providerSlug?: string | null;
        store?: boolean | null;
      },
    ) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        let nextParameters = setAgentModel(data.parameters, selection.model);
        nextParameters = setAgentModelProvider(nextParameters, selection);
        if (selection.store === false) {
          nextParameters = setAgentStorePreference(nextParameters, false);
        } else if (selection.store === null) {
          nextParameters = setAgentStorePreference(nextParameters, null);
        }
        if (!isReasoningModel(selection.model)) {
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

  const handleAgentProviderChange = useCallback(
    (
      nodeId: string,
      selection: { providerId?: string | null; providerSlug?: string | null },
    ) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentModelProvider(data.parameters, selection);
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

  const handleAgentNestedWorkflowChange = useCallback(
    (nodeId: string, selection: AgentNestedWorkflowSelection) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }

        const currentReference = getAgentNestedWorkflow(data.parameters);
        if (selection.mode === "custom") {
          const nextParameters = setAgentNestedWorkflow(data.parameters, {
            id: null,
            slug: null,
          });
          return {
            ...data,
            parameters: nextParameters,
            parametersText: stringifyAgentParameters(nextParameters),
            parametersError: null,
          } satisfies FlowNodeData;
        }

        const trimmedSlug = selection.workflowSlug.trim();
        const persistedSlug = trimmedSlug || currentReference.slug;

        let reference: { id?: number | null; slug?: string | null };
        if (selection.mode === "local") {
          if (selection.workflowId == null) {
            reference = { id: null, slug: null };
          } else {
            const slugForLocal = trimmedSlug || currentReference.slug;
            reference = {
              id: selection.workflowId,
              slug: slugForLocal.trim().length > 0 ? slugForLocal : null,
            };
          }
        } else if (!selection.workflowId && !persistedSlug.trim()) {
          reference = { id: null, slug: null };
        } else if (!persistedSlug.trim()) {
          reference = { id: selection.workflowId };
        } else {
          reference = {
            id: selection.workflowId,
            slug: persistedSlug.trim(),
          };
        }

        const nextParameters = setAgentNestedWorkflow(data.parameters, reference);
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

  const handleAgentReasoningChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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

  const handleParallelJoinSlugChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "parallel_split") {
          return data;
        }
        const nextParameters = setParallelSplitJoinSlug(data.parameters, value);
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

  const handleParallelBranchesChange = useCallback(
    (nodeId: string, branches: ParallelBranch[]) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "parallel_split") {
          return data;
        }
        const nextParameters = setParallelSplitBranches(data.parameters, branches);
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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

  const handleAgentComputerUseChange = useCallback(
    (nodeId: string, config: ComputerUseConfig | null) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentComputerUseConfig(data.parameters, config);
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

  const handleAgentMcpServersChange = useCallback(
    (nodeId: string, configs: McpSseToolConfig[]) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind) && data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setAgentMcpServers(data.parameters, configs);
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
        if (!isAgentKind(data.kind)) {
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
        if (!isAgentKind(data.kind)) {
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

  const handleAgentWorkflowValidationToolChange = useCallback(
    (nodeId: string, enabled: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentWorkflowValidationToolEnabled(
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

  const handleAgentWorkflowToolToggle = useCallback(
    (nodeId: string, slug: string, enabled: boolean) => {
      const normalizedSlug = slug.trim();
      if (!normalizedSlug) {
        return;
      }

      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }

        const existingConfigs = getAgentWorkflowTools(data.parameters);
        const remainingConfigs = existingConfigs.filter(
          (config) => config.slug !== normalizedSlug,
        );

        let nextConfigs = remainingConfigs;
        if (enabled) {
          const workflow = workflows.find(
            (candidate) => candidate.slug === normalizedSlug,
          );
          if (!workflow) {
            return data;
          }

          const displayName = workflow.display_name?.trim();
          const enriched: WorkflowToolConfig = {
            slug: workflow.slug,
            name: workflow.slug,
            identifier: workflow.slug,
            workflowId: workflow.id,
          };

          if (displayName) {
            enriched.title = displayName;
          }

          if (workflow.description?.trim()) {
            enriched.description = workflow.description.trim();
          }

          nextConfigs = [...remainingConfigs, enriched];
        }

        const nextParameters = setAgentWorkflowTools(data.parameters, nextConfigs);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData, workflows],
  );

  const handleVoiceAgentVoiceChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setVoiceAgentVoice(data.parameters, value);
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

  const handleVoiceAgentStartBehaviorChange = useCallback(
    (nodeId: string, behavior: VoiceAgentStartBehavior) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setVoiceAgentStartBehavior(data.parameters, behavior);
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

  const handleVoiceAgentStopBehaviorChange = useCallback(
    (nodeId: string, behavior: VoiceAgentStopBehavior) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setVoiceAgentStopBehavior(data.parameters, behavior);
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

  const handleVoiceAgentToolChange = useCallback(
    (nodeId: string, tool: VoiceAgentTool, enabled: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setVoiceAgentToolEnabled(
          data.parameters,
          tool,
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

  const handleTranscriptionModelChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setTranscriptionModel(data.parameters, value);
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

  const handleTranscriptionLanguageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setTranscriptionLanguage(data.parameters, value);
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

  const handleTranscriptionPromptChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setTranscriptionPrompt(data.parameters, value);
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
      updateHasPendingChanges(true);
    },
    [setEdges, updateHasPendingChanges]
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
      updateHasPendingChanges(true);
    },
    [setEdges, updateHasPendingChanges]
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
      const node = nodesRef.current.find((currentNode) => currentNode.id === nodeId);
      let confirmed = true;
      if (node) {
        const trimmedDisplayName =
          typeof node.data.displayName === "string" ? node.data.displayName.trim() : "";
        const displayName = trimmedDisplayName || node.data.slug || nodeId;
        confirmed = window.confirm(
          t("workflowBuilder.deleteBlock.confirm", { name: displayName }),
        );
      } else {
        confirmed = window.confirm(t("workflowBuilder.deleteSelection.confirmSingle"));
      }
      if (!confirmed) {
        return;
      }
      removeElements({ nodeIds: [nodeId] });
      updateHasPendingChanges(true);
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
    },
    [removeElements, selectedNodeId, t, updateHasPendingChanges]
  );

  const handleRemoveEdge = useCallback(
    (edgeId: string) => {
      removeElements({ edgeIds: [edgeId] });
      setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== edgeId));
      updateHasPendingChanges(true);
      if (selectedEdgeId === edgeId) {
        setSelectedEdgeId(null);
      }
    },
    [removeElements, selectedEdgeId, setEdges, updateHasPendingChanges]
  );

  const addNodeToGraph = useCallback(
    (node: FlowNode) => {
      setNodes((current) => {
        const cleared = current.map((existing) =>
          decorateNode({
            ...existing,
            selected: false,
          }),
        );
        const prepared = decorateNode({
          ...node,
          selected: true,
        });
        return [...cleared, prepared];
      });
      applySelection({ nodeIds: [node.id], primaryNodeId: node.id });
    },
    [applySelection, decorateNode, setNodes]
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
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddVoiceAgentNode = useCallback(() => {
    const slug = `voice-agent-${Date.now()}`;
    const parameters = createVoiceAgentParameters();
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 220 },
      data: {
        slug,
        kind: "voice_agent",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddOutboundCallNode = useCallback(() => {
    const slug = `outbound-call-${Date.now()}`;
    const parameters: AgentParameters = {
      to_number: "",
      voice_workflow_id: null,
      sip_account_id: null,
      wait_for_completion: true,
      metadata: {},
    };
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 240 },
      data: {
        slug,
        kind: "outbound_call",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        isPreviewActive: false,
        isPreviewDimmed: false,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
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
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddParallelSplitNode = useCallback(() => {
    const slug = `parallel-split-${Date.now()}`;
    const joinSlug = `parallel-join-${Date.now()}`;
    const parameters = {
      ...createParallelSplitParameters(),
      join_slug: joinSlug,
    };
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 420, y: 200 },
      data: {
        slug,
        kind: "parallel_split",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  const handleAddParallelJoinNode = useCallback(() => {
    const slug = `parallel-join-${Date.now()}`;
    const parameters = createParallelJoinParameters();
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 520, y: 220 },
      data: {
        slug,
        kind: "parallel_join",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
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
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph]);

  type InsertGraphResult =
    | { success: true; nodeIds: string[]; edgeIds: string[] }
    | { success: false; reason: "nothing_to_insert" | "error" };

  const insertGraphElements = useCallback(
    (
      graph: ParsedWorkflowImport["graph"],
      options: {
        computeTargetCenter?: (
          selectionCenter: { x: number; y: number },
        ) => { x: number; y: number } | null;
      } = {},
    ): InsertGraphResult => {
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
          return { success: false, reason: "nothing_to_insert" };
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
          } else {
            targetCenter = { x: selectionCenter.x, y: selectionCenter.y };
          }
        }

        const offsetX = targetCenter.x - selectionCenter.x;
        const offsetY = targetCenter.y - selectionCenter.y;

        const adjustedNodes = nodesToInsert.map((node) => {
          const x = node.position.x + offsetX;
          const y = node.position.y + offsetY;
          return decorateNode({
            ...node,
            position: { x, y },
            data: {
              ...node.data,
              metadata: { ...node.data.metadata, position: { x, y } },
            },
          });
        });

        const existingEdgeIds = new Set(existingEdges.map((edge) => edge.id));
        const tempEdgeIds = new Set<string>();
        const edgesToInsert: FlowEdge[] = [];

        for (const edge of importedEdges) {
          const source = slugMapping.get(edge.source);
          const target = slugMapping.get(edge.target);
          if (!source || !target) {
            continue;
          }
          const baseId = `${source}-${target}`;
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
          });
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

        return { success: true, nodeIds: newNodeIds, edgeIds: newEdgeIds };
      } catch (error) {
        console.error(error);
        return { success: false, reason: "error" };
      }
    },
    [applySelection, setEdges, updateHasPendingChanges, setNodes],
  );

  const resetCopySequence = useCallback(() => {
    copySequenceRef.current.count = 0;
    copySequenceRef.current.lastTimestamp = 0;
  }, []);

  const copySelectionToClipboard = useCallback(
    async ({ includeEntireGraph = false }: { includeEntireGraph?: boolean } = {}) => {
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
    [resetCopySequence, setSaveMessage, setSaveState, t],
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
  }, [insertGraphElements, t]);

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
  }, [insertGraphElements, t]);

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
  }, [removeElements, t, updateHasPendingChanges]);

  const restoreGraphFromSnapshot = useCallback(
    (snapshot: string): boolean => {
      let parsed;
      try {
        parsed = parseWorkflowImport(snapshot);
      } catch (error) {
        console.error("Failed to parse workflow history snapshot", error);
        return false;
      }

      const flowNodes: FlowNode[] = parsed.graph.nodes.reduce<FlowNode[]>((accumulator, node, index) => {
        if (!isValidNodeKind(node.kind)) {
          return accumulator;
        }
        const kind = node.kind;
        const positionFromMetadata = extractPosition(node.metadata);
        const position = positionFromMetadata ?? { x: 150 * index, y: 120 * index };
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
      }, []);

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
    [setEdges, setNodes, setSelectedEdgeId, setSelectedNodeId],
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

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
      const isCtrlOrMeta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const now = Date.now();
      const workflowBusy = loading || isImporting || isExporting;

      if (isCtrlOrMeta && key === "c") {
        const previousTimestamp = copySequenceRef.current.lastTimestamp;
        const previousCount = copySequenceRef.current.count;
        const nextCount =
          previousTimestamp && now - previousTimestamp <= 600 ? previousCount + 1 : 1;
        copySequenceRef.current.count = nextCount;
        copySequenceRef.current.lastTimestamp = now;

        if (workflowBusy) {
          return;
        }

        if (isEditableTarget(event.target) && nextCount < 2) {
          return;
        }

        event.preventDefault();
        void copySelectionToClipboard({ includeEntireGraph: nextCount >= 2 });
        return;
      }

      const allowDueToCopySequence =
        copySequenceRef.current.count >= 2 &&
        now - copySequenceRef.current.lastTimestamp <= 800;

      if (isEditableTarget(event.target) && !allowDueToCopySequence) {
        if (!isCtrlOrMeta) {
          resetCopySequence();
        }
        return;
      }

      if (isCtrlOrMeta && key === "z") {
        if (workflowBusy) {
          return;
        }
        const performed = event.shiftKey ? redoHistory() : undoHistory();
        if (performed) {
          event.preventDefault();
          resetCopySequence();
        }
        return;
      }

      if (isCtrlOrMeta && key === "y") {
        if (workflowBusy) {
          return;
        }
        const performed = redoHistory();
        if (performed) {
          event.preventDefault();
          resetCopySequence();
        }
        return;
      }

      if (isCtrlOrMeta && key === "a") {
        if (workflowBusy) {
          return;
        }
        event.preventDefault();
        const allNodeIds = nodesRef.current.map((node) => node.id);
        const allEdgeIds = edgesRef.current.map((edge) => edge.id);
        const primaryNodeId = allNodeIds[0] ?? null;
        const primaryEdgeId = primaryNodeId ? null : allEdgeIds[0] ?? null;
        applySelection({
          nodeIds: allNodeIds,
          edgeIds: allEdgeIds,
          primaryNodeId,
          primaryEdgeId,
        });
        resetCopySequence();
        return;
      }

      if (isCtrlOrMeta && key === "v") {
        if (workflowBusy) {
          return;
        }
        event.preventDefault();
        void pasteClipboardGraph().finally(() => {
          resetCopySequence();
        });
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

      if (!isCtrlOrMeta) {
        resetCopySequence();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    applySelection,
    copySelectionToClipboard,
    isExporting,
    isImporting,
    loading,
    pasteClipboardGraph,
    redoHistory,
    removeElements,
    resetCopySequence,
    undoHistory,
  ]);

  const handleSelectWorkflow = useCallback(
    (workflowId: number) => {
      if (workflowId === selectedWorkflowId) {
        if (isMobileLayout) {
          closeWorkflowMenu();
          closeSidebar();
        }
        return;
      }
      setSelectedWorkflowId(workflowId);
      setSelectedVersionId(null);
      closeWorkflowMenu();
      if (isMobileLayout) {
        closeSidebar();
      }
      void loadVersions(workflowId, null);
    },
    [
      closeSidebar,
      closeWorkflowMenu,
      isMobileLayout,
      loadVersions,
      selectedWorkflowId,
    ],
  );

  const handleVersionChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = Number(event.target.value);
      const versionId = Number.isFinite(value) ? value : null;
      setSelectedVersionId(versionId);
      if (selectedWorkflowId && versionId) {
        const key = viewportKeyFor(selectedWorkflowId, versionId, deviceType);
        const hasSavedViewport = key ? viewportMemoryRef.current.has(key) : false;
        if (hasSavedViewport) {
          void loadVersionDetail(selectedWorkflowId, versionId);
        } else {
          void loadVersionDetail(selectedWorkflowId, versionId, { preserveViewport: true });
        }
      }
    },
    [deviceType, loadVersionDetail, selectedWorkflowId],
  );

  const handleOpenCreateModal = useCallback(() => {
    setCreateWorkflowKind("local");
    setCreateWorkflowName("");
    setCreateWorkflowRemoteId("");
    setCreateWorkflowError(null);
    setCreateModalOpen(true);
  }, []);

  const handleCloseCreateModal = useCallback(() => {
    if (isCreatingWorkflow) {
      return;
    }
    setCreateModalOpen(false);
  }, [isCreatingWorkflow]);

  const handleSubmitCreateWorkflow = useCallback(async () => {
    setCreateWorkflowError(null);
    const trimmedName = createWorkflowName.trim();
    if (!trimmedName) {
      setCreateWorkflowError(t("workflowBuilder.createWorkflow.errorMissingName"));
      return;
    }

    if (createWorkflowKind === "hosted") {
      const remoteId = createWorkflowRemoteId.trim();
      if (!remoteId) {
        setCreateWorkflowError(t("workflowBuilder.createWorkflow.errorMissingRemoteId"));
        return;
      }
      if (!token) {
        const message = t("workflowBuilder.createWorkflow.errorAuthentication");
        setSaveState("error");
        setSaveMessage(message);
        setCreateWorkflowError(message);
        return;
      }

      setIsCreatingWorkflow(true);
      const slug = slugifyWorkflowName(trimmedName);
      setSaveState("saving");
      setSaveMessage(t("workflowBuilder.createWorkflow.creatingHosted"));
      try {
        const created = await chatkitApi.createHostedWorkflow(token, {
          slug,
          workflow_id: remoteId,
          label: trimmedName,
          description: undefined,
        });
        chatkitApi.invalidateHostedWorkflowCache();
        await loadHostedWorkflows();
        setSaveState("saved");
        setSaveMessage(
          t("workflowBuilder.createWorkflow.successHosted", { label: created.label }),
        );
        setTimeout(() => setSaveState("idle"), 1500);
        setCreateModalOpen(false);
        setCreateWorkflowName("");
        setCreateWorkflowRemoteId("");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("workflowBuilder.createWorkflow.errorCreateHosted");
        setSaveState("error");
        setSaveMessage(message);
        setCreateWorkflowError(message);
      } finally {
        setIsCreatingWorkflow(false);
      }
      return;
    }

    setIsCreatingWorkflow(true);
    try {
      const slug = slugifyWorkflowName(trimmedName);
      const payload = {
        slug,
        display_name: trimmedName,
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
          await loadWorkflows({
            selectWorkflowId: data.workflow_id,
            selectVersionId: data.id,
          });
          setSaveState("saved");
          setSaveMessage(
            t("workflowBuilder.createWorkflow.successLocal", { name: trimmedName }),
          );
          setTimeout(() => setSaveState("idle"), 1500);
          setCreateModalOpen(false);
          setCreateWorkflowName("");
          setCreateWorkflowRemoteId("");
          return;
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error(t("workflowBuilder.createWorkflow.errorCreateLocal"));
        }
      }
      const message = lastError?.message ?? t("workflowBuilder.createWorkflow.errorCreateLocal");
      setSaveState("error");
      setSaveMessage(message);
      setCreateWorkflowError(message);
    } finally {
      setIsCreatingWorkflow(false);
    }
  }, [
    authHeader,
    backendUrl,
    createWorkflowKind,
    createWorkflowName,
    createWorkflowRemoteId,
    loadHostedWorkflows,
    loadWorkflows,
    t,
    token,
  ]);

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
      closeWorkflowMenu();
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
      closeWorkflowMenu,
      loadWorkflows,
      selectedWorkflowId,
      workflows,
    ],
  );

  const handleDeleteHostedWorkflow = useCallback(
    async (slug: string) => {
      if (!token) {
        setSaveState("error");
        setSaveMessage(t("workflowBuilder.createWorkflow.errorAuthentication"));
        return;
      }
      const entry = hostedWorkflows.find((workflow) => workflow.slug === slug);
      if (!entry) {
        return;
      }
      closeWorkflowMenu();
      const confirmed = window.confirm(
        t("workflowBuilder.hostedSection.confirmDelete", { label: entry.label }),
      );
      if (!confirmed) {
        return;
      }
      setSaveState("saving");
      setSaveMessage(t("workflowBuilder.hostedSection.deleting"));
      try {
        await chatkitApi.deleteHostedWorkflow(token, slug);
        chatkitApi.invalidateHostedWorkflowCache();
        await loadHostedWorkflows();
        setSaveState("saved");
        setSaveMessage(
          t("workflowBuilder.hostedSection.deleteSuccess", { label: entry.label }),
        );
        setTimeout(() => setSaveState("idle"), 1500);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("workflowBuilder.hostedSection.deleteError");
        setSaveState("error");
        setSaveMessage(message);
      }
    },
    [closeWorkflowMenu, hostedWorkflows, loadHostedWorkflows, t, token],
  );

  const buildGraphPayload = useCallback(
    () => buildGraphPayloadFrom(nodes, edges),
    [edges, nodes],
  );

  const graphSnapshot = useMemo(() => JSON.stringify(buildGraphPayload()), [buildGraphPayload]);

  useEffect(() => {
    const history = historyRef.current;
    if (!selectedWorkflowId) {
      history.past = [];
      history.future = [];
      history.last = graphSnapshot;
      history.isRestoring = false;
      history.pendingSnapshot = null;
      return;
    }
    if (isHydratingRef.current) {
      history.last = graphSnapshot;
      history.pendingSnapshot = null;
      return;
    }
    if (history.isRestoring) {
      history.isRestoring = false;
      history.last = graphSnapshot;
      history.pendingSnapshot = null;
      return;
    }
    if (!history.last) {
      history.last = graphSnapshot;
      history.pendingSnapshot = null;
      return;
    }
    if (isNodeDragInProgressRef.current) {
      history.pendingSnapshot = graphSnapshot;
      return;
    }
    const nextSnapshot = history.pendingSnapshot ?? graphSnapshot;
    history.pendingSnapshot = null;
    if (history.last !== nextSnapshot) {
      history.past = [...history.past, history.last].slice(-HISTORY_LIMIT);
      history.future = [];
      history.last = nextSnapshot;
    }
  }, [graphSnapshot, selectedWorkflowId]);

  const conditionGraphError = useMemo(() => {
    const enabledNodes = new Map(
      nodes.filter((node) => node.data.isEnabled).map((node) => [node.id, node]),
    );

    const joinAssignments = new Map<string, { slug: string; label: string }>();

    for (const node of nodes) {
      if (!node.data.isEnabled) {
        continue;
      }

      const label = node.data.displayName.trim() || node.data.slug;

      if (node.data.kind === "condition") {
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

      if (node.data.kind === "parallel_split") {
        const outgoing = edges.filter(
          (edge) => edge.source === node.id && enabledNodes.has(edge.target),
        );

        if (outgoing.length < 2) {
          return `Le bloc split parallèle « ${label} » doit comporter au moins deux sorties actives.`;
        }

        const joinSlug = getParallelSplitJoinSlug(node.data.parameters);
        if (!joinSlug) {
          return `Le bloc split parallèle « ${label} » doit préciser une jointure valide.`;
        }

        const joinNode = enabledNodes.get(joinSlug);
        if (!joinNode || joinNode.data.kind !== "parallel_join") {
          return `Le bloc split parallèle « ${label} » doit référencer un bloc de jointure valide.`;
        }

        const joinLabel = joinNode.data.displayName.trim() || joinNode.data.slug;
        const previousAssignment = joinAssignments.get(joinSlug);
        if (previousAssignment && previousAssignment.slug !== node.id) {
          return `La jointure « ${joinLabel} » est déjà associée au split parallèle « ${previousAssignment.label} ».`;
        }
        joinAssignments.set(joinSlug, { slug: node.id, label });

        const branches = getParallelSplitBranches(node.data.parameters);
        if (branches.length !== outgoing.length) {
          return `Le bloc split parallèle « ${label} » doit définir autant de branches que de sorties actives.`;
        }
      }
    }

    for (const node of nodes) {
      if (!node.data.isEnabled || node.data.kind !== "parallel_join") {
        continue;
      }

      const label = node.data.displayName.trim() || node.data.slug;
      const incoming = edges.filter(
        (edge) => edge.target === node.id && enabledNodes.has(edge.source),
      );

      if (incoming.length < 2) {
        return `Le bloc de jointure parallèle « ${label} » doit comporter au moins deux entrées actives.`;
      }

      if (!joinAssignments.has(node.id)) {
        return `Le bloc de jointure parallèle « ${label} » doit être associé à un split parallèle.`;
      }
    }

    return null;
  }, [edges, nodes]);

  useEffect(() => {
    if (!selectedWorkflowId) {
      lastSavedSnapshotRef.current = null;
      updateHasPendingChanges(false);
      return;
    }

    if (isHydratingRef.current) {
      isHydratingRef.current = false;
      return;
    }

    if (!lastSavedSnapshotRef.current) {
      lastSavedSnapshotRef.current = graphSnapshot;
      updateHasPendingChanges(false);
      return;
    }

    updateHasPendingChanges(graphSnapshot !== lastSavedSnapshotRef.current);
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
              const message = await extractSaveErrorMessage(response);
              throw new Error(message);
            }
            const created: WorkflowVersionResponse = await response.json();
            const summary: WorkflowVersionSummary = {
              ...versionSummaryFromResponse(created),
              name: draftDisplayName,
            };
            const newViewportKey = viewportKeyFor(
              selectedWorkflowId,
              summary.id,
              deviceType,
            );
            const currentViewport =
              reactFlowInstanceRef.current?.getViewport() ?? viewportRef.current;
            if (newViewportKey && currentViewport) {
              viewportMemoryRef.current.set(newViewportKey, { ...currentViewport });
              persistViewportMemory();
              // Update initialViewport so ReactFlow uses it as defaultViewport
              setInitialViewport({ ...currentViewport });
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
            // Force viewport to be reapplied after auto-save
            // Apply multiple times to ensure it sticks
            if (currentViewport && reactFlowInstanceRef.current) {
              setTimeout(() => {
                reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
              }, 100);
              setTimeout(() => {
                reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
              }, 200);
              setTimeout(() => {
                reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
              }, 300);
            }
            lastSavedSnapshotRef.current = graphSnapshot;
            updateHasPendingChanges(false);
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
      updateHasPendingChanges(true);
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
          const message = await extractSaveErrorMessage(response);
          throw new Error(message);
        }
        const updated: WorkflowVersionResponse = await response.json();
        const summary: WorkflowVersionSummary = {
          ...versionSummaryFromResponse(updated),
          name: draftDisplayName,
        };
        draftVersionSummaryRef.current = summary;
        const currentViewport = reactFlowInstanceRef.current?.getViewport();
        const viewportKey = viewportKeyFor(selectedWorkflowId, summary.id, deviceType);
        // Update initialViewport so ReactFlow uses it as defaultViewport
        if (currentViewport) {
          setInitialViewport({ ...currentViewport });
          // Save viewport in memory for the draft version
          if (viewportKey) {
            viewportMemoryRef.current.set(viewportKey, { ...currentViewport });
            persistViewportMemory();
          }
        }
        await loadVersions(selectedWorkflowId, summary.id, {
          preserveViewport: true,
          background: true,
        });
        // Force viewport to be reapplied after auto-save
        // Apply multiple times to ensure it sticks
        if (currentViewport && reactFlowInstanceRef.current) {
          setTimeout(() => {
            reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
          }, 100);
          setTimeout(() => {
            reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
          }, 200);
          setTimeout(() => {
            reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
          }, 300);
        }
        lastSavedSnapshotRef.current = graphSnapshot;
        updateHasPendingChanges(false);
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
    updateHasPendingChanges(true);
    setSaveMessage(lastError?.message ?? saveFailureMessage);
  }, [
    closeWorkflowMenu,
    authHeader,
    autoSaveSuccessMessage,
    backendUrl,
    buildGraphPayload,
    conditionGraphError,
    deviceType,
    draftDisplayName,
    extractSaveErrorMessage,
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
        updateHasPendingChanges(false);
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
        closeWorkflowMenu();
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
          closeWorkflowMenu();
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
      closeWorkflowMenu,
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
        closeWorkflowMenu();
        return;
      }

      closeWorkflowMenu();

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
      closeWorkflowMenu,
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

      if (isAgentKind(node.data.kind)) {
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
    loading,
    saveState,
    selectedWorkflowId,
  ]);

  const blockLibraryItems = useMemo(() => {
    const definitions: Array<{
      key: string;
      kind: NodeKind;
      shortLabel: string;
      onClick: () => void;
    }> = [
      { key: "agent", kind: "agent", shortLabel: "A", onClick: handleAddAgentNode },
      {
        key: "voice-agent",
        kind: "voice_agent",
        shortLabel: "AV",
        onClick: handleAddVoiceAgentNode,
      },
      {
        key: "outbound-call",
        kind: "outbound_call",
        shortLabel: "AS",
        onClick: handleAddOutboundCallNode,
      },
      { key: "condition", kind: "condition", shortLabel: "C", onClick: handleAddConditionNode },
      { key: "parallel-split", kind: "parallel_split", shortLabel: "SP", onClick: handleAddParallelSplitNode },
      { key: "parallel-join", kind: "parallel_join", shortLabel: "JP", onClick: handleAddParallelJoinNode },
      { key: "state", kind: "state", shortLabel: "É", onClick: handleAddStateNode },
      { key: "watch", kind: "watch", shortLabel: "W", onClick: handleAddWatchNode },
      { key: "transform", kind: "transform", shortLabel: "T", onClick: handleAddTransformNode },
      {
        key: "wait-for-user-input",
        kind: "wait_for_user_input",
        shortLabel: "AU",
        onClick: handleAddWaitForUserInputNode,
      },
      {
        key: "assistant-message",
        kind: "assistant_message",
        shortLabel: "MA",
        onClick: handleAddAssistantMessageNode,
      },
      {
        key: "user-message",
        kind: "user_message",
        shortLabel: "MU",
        onClick: handleAddUserMessageNode,
      },
      {
        key: "json-vector-store",
        kind: "json_vector_store",
        shortLabel: "VS",
        onClick: handleAddVectorStoreNode,
      },
      { key: "widget", kind: "widget", shortLabel: "W", onClick: handleAddWidgetNode },
      { key: "end", kind: "end", shortLabel: "F", onClick: handleAddEndNode },
    ];

    return definitions.map((definition) => ({
      ...definition,
      label: labelForKind(definition.kind, t),
      color: NODE_COLORS[definition.kind],
    }));
  }, [
    t,
    handleAddAgentNode,
    handleAddVoiceAgentNode,
    handleAddConditionNode,
    handleAddParallelSplitNode,
    handleAddParallelJoinNode,
    handleAddStateNode,
    handleAddWatchNode,
    handleAddTransformNode,
    handleAddWaitForUserInputNode,
    handleAddAssistantMessageNode,
    handleAddUserMessageNode,
    handleAddVectorStoreNode,
    handleAddWidgetNode,
    handleAddEndNode,
  ]);

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

  // getBlockLibraryButtonStyle removed - now handled by BlockLibraryPanel component (line 175)

  // workflowSidebarContent and collapsedWorkflowShortcuts removed - now using WorkflowSidebar component (line 180)
  const { expandedContent: workflowSidebarContent, collapsedContent: collapsedWorkflowShortcuts } =
    WorkflowSidebar({
      workflows,
      hostedWorkflows,
      selectedWorkflowId,
      selectedWorkflow,
      loading,
      loadError,
      hostedLoading,
      hostedError,
      isCreatingWorkflow,
      isMobileLayout,
      isSidebarCollapsed,
      pinnedLookup,
      lastUsedAt,
      openWorkflowMenuId,
      workflowMenuPlacement,
      onSelectWorkflow: handleSelectWorkflow,
      onOpenCreateModal: handleOpenCreateModal,
      onDuplicateWorkflow: handleDuplicateWorkflow,
      onRenameWorkflow: handleRenameWorkflow,
      onExportWorkflow: handleExportWorkflow,
      onDeleteWorkflow: handleDeleteWorkflow,
      onDeleteHostedWorkflow: handleDeleteHostedWorkflow,
      onToggleLocalPin: toggleLocalPin,
      onToggleHostedPin: toggleHostedPin,
      onCloseWorkflowMenu: closeWorkflowMenu,
      onSetOpenWorkflowMenuId: setOpenWorkflowMenuId,
      onSetWorkflowMenuPlacement: setWorkflowMenuPlacement,
      onOpenAppearanceModal: openAppearanceModal,
      t,
    });

  useEffect(() => {
    setSidebarContent(workflowSidebarContent);
    setCollapsedSidebarContent(collapsedWorkflowShortcuts);
    return () => clearSidebarContent();
  }, [
    clearSidebarContent,
    collapsedWorkflowShortcuts,
    setCollapsedSidebarContent,
    setSidebarContent,
    workflowSidebarContent,
  ]);

  // renderBlockLibraryContent function removed - now handled by BlockLibraryPanel component (line 175)

  const workflowBusy = loading || isImporting || isExporting;
  const editingLocked = false;
  const hasSelectedElement = !editingLocked && Boolean(selectedNode || selectedEdge);
  const canDeleteSelection = hasSelectedElement && !workflowBusy;
  const canDuplicateSelection = hasSelectedElement && !workflowBusy;
  const canUndoHistory = !workflowBusy && !editingLocked && historyRef.current.past.length > 0;
  const canRedoHistory = !workflowBusy && !editingLocked && historyRef.current.future.length > 0;
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

  // deployModal labels removed - now handled by DeployModal component (line 176)

  const selectedElementLabel = selectedNode
    ? selectedNode.data.displayName.trim() || labelForKind(selectedNode.data.kind, t)
    : selectedEdge
      ? `${selectedEdge.source} → ${selectedEdge.target}`
      : "";

  const headerOverlayOffset = useMemo(() => (isMobileLayout ? "4rem" : "4.25rem"), [isMobileLayout]);

  const floatingPanelStyle = useMemo<CSSProperties | undefined>(() => {
    if (isMobileLayout) {
      return undefined;
    }
    return {
      top: `calc(${headerOverlayOffset} + ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING})`,
      maxHeight: `calc(100% - (${headerOverlayOffset} + 2 * ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING}))`,
    };
  }, [headerOverlayOffset, isMobileLayout]);

  const propertiesPanelElement = (
    <PropertiesPanel
      isMobileLayout={isMobileLayout}
      selectedElementLabel={selectedElementLabel}
      floatingPanelStyle={floatingPanelStyle}
      onClose={handleClosePropertiesPanel}
      closeButtonRef={propertiesPanelCloseButtonRef}
    >
      {selectedNode ? (
        <NodeInspector
          node={selectedNode}
          onDisplayNameChange={handleDisplayNameChange}
          onAgentMessageChange={handleAgentMessageChange}
          onAgentModelChange={handleAgentModelChange}
          onAgentProviderChange={handleAgentProviderChange}
          onAgentNestedWorkflowChange={handleAgentNestedWorkflowChange}
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
          onAgentComputerUseChange={handleAgentComputerUseChange}
          onAgentMcpServersChange={handleAgentMcpServersChange}
          workflows={workflows}
          currentWorkflowId={selectedWorkflowId}
          hostedWorkflows={hostedWorkflows}
          hostedWorkflowsLoading={hostedLoading}
          hostedWorkflowsError={hostedError}
          onVoiceAgentVoiceChange={handleVoiceAgentVoiceChange}
          onVoiceAgentStartBehaviorChange={handleVoiceAgentStartBehaviorChange}
          onVoiceAgentStopBehaviorChange={handleVoiceAgentStopBehaviorChange}
          onVoiceAgentToolChange={handleVoiceAgentToolChange}
          onTranscriptionModelChange={handleTranscriptionModelChange}
          onTranscriptionLanguageChange={handleTranscriptionLanguageChange}
          onTranscriptionPromptChange={handleTranscriptionPromptChange}
          onVectorStoreNodeConfigChange={handleVectorStoreNodeConfigChange}
          onParametersChange={handleOutboundCallParametersChange}
          onTransformExpressionsChange={handleTransformExpressionsChange}
          onStartAutoRunChange={handleStartAutoRunChange}
          onStartAutoRunMessageChange={handleStartAutoRunMessageChange}
          onStartAutoRunAssistantMessageChange={
            handleStartAutoRunAssistantMessageChange
          }
          onStartTelephonySipAccountIdChange={handleStartTelephonySipAccountIdChange}
          onStartTelephonyRingTimeoutChange={handleStartTelephonyRingTimeoutChange}
          onStartTelephonySpeakFirstChange={handleStartTelephonySpeakFirstChange}
          onConditionPathChange={handleConditionPathChange}
          onConditionModeChange={handleConditionModeChange}
          onConditionValueChange={handleConditionValueChange}
          onParallelJoinSlugChange={handleParallelJoinSlugChange}
          onParallelBranchesChange={handleParallelBranchesChange}
          availableModels={availableModels}
          availableModelsLoading={availableModelsLoading}
          availableModelsError={availableModelsError}
          isReasoningModel={isReasoningModel}
          onAgentWeatherToolChange={handleAgentWeatherToolChange}
          onAgentWidgetValidationToolChange={handleAgentWidgetValidationToolChange}
          onAgentWorkflowValidationToolChange={
            handleAgentWorkflowValidationToolChange
          }
          onAgentWorkflowToolToggle={handleAgentWorkflowToolToggle}
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
    </PropertiesPanel>
  );
  // toastStyles removed - now handled by SaveToast component (line 175)

  useEffect(() => {
    const key = viewportKeyFor(selectedWorkflowId, selectedVersionId, deviceType);
    viewportKeyRef.current = key;
    const savedViewport = key ? viewportMemoryRef.current.get(key) ?? null : null;
    viewportRef.current = savedViewport;
    hasUserViewportChangeRef.current = savedViewport != null;
    pendingViewportRestoreRef.current = true;
  }, [deviceType, selectedVersionId, selectedWorkflowId]);

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
      paddingTop: `calc(${headerOverlayOffset}${
        hasWorkflowMeta ? ` + ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING}` : ""
      })`,
      paddingBottom: 0,
      paddingLeft: DESKTOP_WORKSPACE_HORIZONTAL_PADDING,
      paddingRight: DESKTOP_WORKSPACE_HORIZONTAL_PADDING,
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

    if (!isMobileLayout) {
      baseStyle.marginLeft = `calc(-1 * ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING})`;
      baseStyle.marginRight = `calc(-1 * ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING})`;
    }

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

  const editorContainerClassName = styles.editorContainer;

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
        <WorkflowHeader
          isMobileLayout={isMobileLayout}
          loading={loading}
          isImporting={isImporting}
          isExporting={isExporting}
          isDeploying={isDeploying}
          selectedWorkflowId={selectedWorkflowId}
          selectedVersionId={selectedVersionId}
          versions={versions}
          selectedWorkflow={selectedWorkflow}
          draftVersionIdRef={draftVersionIdRef}
          draftDisplayName={draftDisplayName}
          isMobileActionsOpen={isMobileActionsOpen}
          headerStyle={headerStyle}
          onOpenSidebar={openSidebar}
          onVersionChange={handleVersionChange}
          onTriggerImport={handleTriggerImport}
          onImportFileChange={handleImportFileChange}
          onExportWorkflow={handleExportWorkflow}
          onOpenDeployModal={handleOpenDeployModal}
          onToggleMobileActions={() => {
            setIsMobileActionsOpen((previous) => !previous);
          }}
          onCloseMobileActions={closeMobileActions}
          mobileActionsTriggerRef={mobileActionsTriggerRef}
          mobileActionsMenuRef={mobileActionsMenuRef}
          importFileInputRef={importFileInputRef}
          t={t}
        />

        <div style={workspaceWrapperStyle}>
          <div style={workspaceContentStyle}>
            {shouldShowWorkflowDescription && selectedWorkflow?.description ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
                {selectedWorkflow.description}
              </div>
            ) : null}
            {shouldShowPublicationReminder && selectedWorkflow && !selectedWorkflow.active_version_id ? (
              <div style={{ color: "#b45309", fontSize: "0.85rem", fontWeight: 600 }}>
                Publiez une version pour l'utiliser.
              </div>
            ) : null}
            <div
              ref={reactFlowContainerRef}
              style={editorContainerStyle}
              className={editorContainerClassName}
              aria-label="Éditeur visuel du workflow"
            >
              <div className={styles.editorSplit}>
                <div className={styles.flowViewport}>
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
                      onNodesChange={handleNodesChange}
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
                      style={{
                        background: isMobileLayout ? "transparent" : "var(--color-surface-subtle)",
                        height: "100%",
                      }}
                      minZoom={minViewportZoom}
                      defaultViewport={initialViewport}
                      fitView={false}
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
                    <BlockLibraryPanel
                      isMobileLayout={isMobileLayout}
                      isOpen={isBlockLibraryOpen}
                      items={blockLibraryItems}
                      loading={loading}
                      selectedWorkflowId={selectedWorkflowId}
                      scrollRef={blockLibraryScrollRef}
                      itemRefs={blockLibraryItemRefs}
                      onItemRefSet={scheduleBlockLibraryTransformUpdate}
                    />
                  </aside>
                </div>
              ) : null}
              <div className={styles.mobileActionStack}>
                <button
                  type="button"
                  className={styles.mobileActionButton}
                  onClick={() => {
                    redoHistory();
                  }}
                  disabled={!canRedoHistory}
                >
                  <Redo2 aria-hidden="true" size={20} />
                  <span className={styles.srOnly}>
                    {t("workflowBuilder.mobileActions.redo")}
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.mobileActionButton}
                  onClick={() => {
                    undoHistory();
                  }}
                  disabled={!canUndoHistory}
                >
                  <Undo2 aria-hidden="true" size={20} />
                  <span className={styles.srOnly}>
                    {t("workflowBuilder.mobileActions.undo")}
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.mobileActionButton}
                  onClick={() => {
                    handleDuplicateSelection();
                  }}
                  disabled={!canDuplicateSelection}
                >
                  <Copy aria-hidden="true" size={20} />
                  <span className={styles.srOnly}>
                    {t("workflowBuilder.mobileActions.duplicate")}
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.mobileActionButton}
                  onClick={() => {
                    handleDeleteSelection();
                  }}
                  disabled={!canDeleteSelection}
                >
                  <Trash2 aria-hidden="true" size={20} />
                  <span className={styles.srOnly}>
                    {t("workflowBuilder.mobileActions.delete")}
                  </span>
                </button>
                {hasSelectedElement ? (
                  <button
                    type="button"
                    ref={propertiesPanelToggleRef}
                    className={styles.mobileActionButton}
                    onClick={
                      isPropertiesPanelOpen ? handleClosePropertiesPanel : handleOpenPropertiesPanel
                    }
                    aria-controls={propertiesPanelId}
                    aria-expanded={isPropertiesPanelOpen}
                  >
                    <PenSquare aria-hidden="true" size={20} />
                    <span className={styles.srOnly}>
                      {t("workflowBuilder.mobileActions.properties")}
                    </span>
                  </button>
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
                    {isBlockLibraryOpen
                      ? "Fermer la bibliothèque de blocs"
                      : "Ouvrir la bibliothèque de blocs"}
                  </span>
                </button>
              </div>
            </>
          ) : (
            <aside
              id={blockLibraryId}
              aria-label="Bibliothèque de blocs"
              className={styles.blockLibrary}
              style={floatingPanelStyle}
            >
              <BlockLibraryPanel
                isMobileLayout={isMobileLayout}
                isOpen={isBlockLibraryOpen}
                items={blockLibraryItems}
                loading={loading}
                selectedWorkflowId={selectedWorkflowId}
                onToggle={toggleBlockLibrary}
                toggleRef={blockLibraryToggleRef}
                contentId={blockLibraryContentId}
              />
            </aside>
          )}
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
        {saveMessage ? <SaveToast saveState={saveState} saveMessage={saveMessage} /> : null}
        <WorkflowAppearanceModal
          token={token ?? null}
          isOpen={isAppearanceModalOpen}
          target={appearanceModalTarget}
          onClose={handleCloseAppearanceModal}
        />
        <CreateWorkflowModal
          isOpen={isCreateModalOpen}
          kind={createWorkflowKind}
          name={createWorkflowName}
          remoteId={createWorkflowRemoteId}
          error={createWorkflowError}
          isSubmitting={isCreatingWorkflow}
          onClose={handleCloseCreateModal}
          onSubmit={handleSubmitCreateWorkflow}
          onKindChange={setCreateWorkflowKind}
          onNameChange={setCreateWorkflowName}
          onRemoteIdChange={setCreateWorkflowRemoteId}
        />
        <DeployModal
          isOpen={isDeployModalOpen}
          isDeploying={isDeploying}
          deployToProduction={deployToProduction}
          versionSummaryForPromotion={versionSummaryForPromotion}
          isPromotingDraft={isPromotingDraft}
          onClose={handleCloseDeployModal}
          onConfirm={handleConfirmDeploy}
          onProductionToggle={setDeployToProduction}
          t={t}
        />
        </div>
      </ReactFlowProvider>
  );
};

export default WorkflowBuilderPage;
