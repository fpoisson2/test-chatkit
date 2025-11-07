import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";

import {
  MarkerType,
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

import { useAuth } from "../../auth";
import { useI18n } from "../../i18n";
import { useAppLayout } from "../../components/AppLayout";
import { chatkitApi, makeApiEndpointCandidates } from "../../utils/backend";
import { resolveAgentParameters, resolveStateParameters } from "../../utils/agentPresets";
import { useEscapeKeyHandler } from "./hooks/useEscapeKeyHandler";
import { useOutsidePointerDown } from "./hooks/useOutsidePointerDown";
import useWorkflowResources from "./hooks/useWorkflowResources";
import useWorkflowSidebarState from "./hooks/useWorkflowSidebarState";
import { useWorkflowKeyboardShortcuts } from "./hooks/useWorkflowKeyboardShortcuts";
import { useRemoteVersionPolling } from "./hooks/useRemoteVersionPolling";
import { useWorkflowHistory } from "./hooks/useWorkflowHistory";
import { useWorkflowBuilderModals } from "./hooks/useWorkflowBuilderModals";
import { validateGraphStructure } from "./utils/graphValidation";
import { resolveNodeParameters } from "./utils/parameterResolver";
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
import DeployWorkflowModal from "./components/DeployWorkflowModal";
import NodeInspector from "./components/NodeInspector";
import WorkflowBuilderSidebar from "./components/WorkflowBuilderSidebar";
import BlockLibrary, { type BlockLibraryItem } from "./components/BlockLibrary";
import WorkflowBuilderCanvas, {
  type MobileActionLabels,
} from "./components/WorkflowBuilderCanvas";
import WorkflowBuilderToast from "./components/WorkflowBuilderToast";
import WorkflowBuilderModals from "./components/WorkflowBuilderModals";
import WorkflowBuilderPropertiesPanel from "./components/WorkflowBuilderPropertiesPanel";
import WorkflowBuilderHeader from "./components/WorkflowBuilderHeader";
import useWorkflowNodeHandlers from "./hooks/useWorkflowNodeHandlers";
import useGraphEditor from "./hooks/useGraphEditor";
import useWorkflowPersistence from "./hooks/useWorkflowPersistence";
import { parseWorkflowImport } from "./importWorkflow";
import WorkflowAppearanceModal, {
  type WorkflowAppearanceTarget,
} from "../workflows/WorkflowAppearanceModal";
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
  buildEdgeStyle,
  buildGraphPayloadFrom,
  buildNodeStyle,
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
  getHeaderNavigationButtonStyle,
  type ActionMenuPlacement,
} from "./styles";
import styles from "./WorkflowBuilderPage.module.css";
import {
  backendUrl,
  cx,
  DESKTOP_MIN_VIEWPORT_ZOOM,
  DESKTOP_WORKSPACE_HORIZONTAL_PADDING,
  HISTORY_LIMIT,
  isAgentKind,
  isValidNodeKind,
  MOBILE_MIN_VIEWPORT_ZOOM,
  REMOTE_VERSION_POLL_INTERVAL_MS,
  resolveDraftCandidate,
  sortVersionsWithDraftFirst,
  useMediaQuery,
  versionSummaryFromResponse,
  viewportKeyFor,
  type AgentLikeKind,
  type ClassValue,
  type DeviceType,
} from "./WorkflowBuilderUtils";
import { useWorkflowViewportPersistence } from "./hooks/useWorkflowViewportPersistence";
// Phase 4: Import and use contexts
import {
  useSaveContext,
  useUIContext,
  useModalContext,
  useSelectionContext,
  useGraphContext,
  useViewportContext,
  useWorkflowContext,
} from "./contexts";

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
  const { openSidebar, closeSidebar, isSidebarCollapsed } = useAppLayout();

  // Phase 4: Use contexts instead of local state
  const {
    saveState,
    saveMessage,
    setSaveState,
    setSaveMessage,
    saveStateRef,
    lastSavedSnapshotRef,
    setLastSavedSnapshot,
  } = useSaveContext();

  const {
    isBlockLibraryOpen,
    setIsBlockLibraryOpen,
    isPropertiesPanelOpen,
    setIsPropertiesPanelOpen,
    openWorkflowMenuId,
    setOpenWorkflowMenuId,
    isMobileLayout: contextIsMobileLayout,
    setIsMobileLayout: setContextIsMobileLayout,
    isExporting,
    setIsExporting,
    isImporting,
    setIsImporting,
  } = useUIContext();

  const {
    createWorkflowKind,
    setCreateWorkflowKind,
    createWorkflowName,
    setCreateWorkflowName,
    createWorkflowRemoteId,
    setCreateWorkflowRemoteId,
    createWorkflowError,
    setCreateWorkflowError,
    isCreatingWorkflow,
    setIsCreatingWorkflow,
    deployToProduction,
    setDeployToProduction,
    isDeploying,
    setIsDeploying,
    isCreateModalOpen,
    closeCreateModal: handleCloseCreateModal,
    isDeployModalOpen,
    openDeployModal,
    closeDeployModal: handleCloseDeployModal,
    isAppearanceModalOpen,
    closeAppearanceModal: handleCloseAppearanceModal,
  } = useModalContext();

  const {
    selectedNodeId,
    setSelectedNodeId,
    selectedEdgeId,
    setSelectedEdgeId,
    selectedNodeIdRef,
    selectedEdgeIdRef,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedEdgeIds,
    setSelectedEdgeIds,
    selectedNodeIdsRef,
    selectedEdgeIdsRef,
    previousSelectedElementRef,
    selectNode,
    selectEdge,
    clearSelection: clearSelectionContext,
    handleSelectionChange: handleSelectionChangeContext,
  } = useSelectionContext();

  const {
    nodes,
    setNodes,
    edges,
    setEdges,
    onNodesChange,
    applyEdgesChange,
    hasPendingChanges,
    updateHasPendingChanges,
    nodesRef,
    edgesRef,
    hasPendingChangesRef,
    isNodeDragInProgressRef,
    setIsNodeDragInProgress,
  } = useGraphContext();

  // Phase 4: ViewportContext for viewport-related state
  const {
    viewport,
    minViewportZoom,
    initialViewport,
    hasUserViewportChange,
    pendingViewportRestore,
    viewportRef,
    viewportMemoryRef,
    viewportKeyRef,
    hasUserViewportChangeRef,
    pendingViewportRestoreRef,
    setViewport,
    setMinViewportZoom,
    setInitialViewport,
    setHasUserViewportChange,
    setPendingViewportRestore,
    saveViewport,
    restoreViewport,
    clearViewport,
    updateViewport,
    calculateMinZoom,
    refreshViewportConstraints,
    generateViewportKey,
  } = useViewportContext();

  // Phase 4: WorkflowContext for workflow/version-related state
  // NOW FULLY MIGRATED: workflows, hostedWorkflows, selectedWorkflowId come from WorkflowContext
  const {
    workflows,
    setWorkflows,
    workflowsRef,
    hostedWorkflows,
    setHostedWorkflows,
    hostedWorkflowsRef,
    selectedWorkflowId,
    setSelectedWorkflowId,
    selectedWorkflowIdRef,
    versions,
    selectedVersionId,
    selectedVersionDetail,
    draftVersionId,
    draftVersionSummary,
    loading,
    loadError,
    hostedLoading,
    hostedError,
    versionsRef,
    selectedVersionIdRef,
    draftVersionIdRef,
    draftVersionSummaryRef,
    setVersions,
    setSelectedVersionId,
    setSelectedVersionDetail,
    setDraftVersionId,
    setDraftVersionSummary,
    setLoading,
    setLoadError,
    setHostedLoading,
    setHostedError,
    setWorkflows: setWorkflowsContext,
    setHostedWorkflows: setHostedWorkflowsContext,
    setSelectedWorkflowId: setSelectedWorkflowIdContext,
  } = useWorkflowContext();

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

  // useWorkflowSidebarState now only provides sidebar-specific functionality
  // workflows, hostedWorkflows, selectedWorkflowId come from WorkflowContext above
  const {
    initialSidebarCache,
    initialSidebarCacheUsedRef,
    setWorkflows: setSidebarWorkflows,
    setHostedWorkflows: setSidebarHostedWorkflows,
    setSelectedWorkflowId: setSidebarSelectedWorkflowId,
    lastUsedAt,
    pinnedLookup,
    toggleLocalPin,
    toggleHostedPin,
    workflowSortCollatorRef,
    hasLoadedWorkflowsRef,
  } = useWorkflowSidebarState({ token });

  const {
    vectorStores: vectorStoresState,
    availableModels: availableModelsState,
    widgets: widgetsState,
  } = useWorkflowResources(token);

  const { data: vectorStores, loading: vectorStoresLoading, error: vectorStoresError } =
    vectorStoresState;
  const {
    data: availableModels,
    loading: availableModelsLoading,
    error: availableModelsError,
  } = availableModelsState;
  const { data: widgets, loading: widgetsLoading, error: widgetsError } = widgetsState;

  // Phase 4: State fully migrated to contexts!
  // - SaveContext: saveState, saveMessage, lastSavedSnapshotRef
  // - UIContext: isBlockLibraryOpen, isPropertiesPanelOpen, openWorkflowMenuId, isExporting, isImporting
  // - ModalContext: createWorkflow*, isCreatingWorkflow, deployToProduction, isDeploying, modal open states
  // - SelectionContext: selectedNodeId, selectedEdgeId, selectedNodeIds, selectedEdgeIds, refs
  // - GraphContext: nodes, edges, hasPendingChanges, nodesRef, edgesRef, hasPendingChangesRef, isNodeDragInProgressRef
  // - ViewportContext: viewport, minViewportZoom, initialViewport, hasUserViewportChange, pendingViewportRestore, refs
  // - WorkflowContext: versions, selectedVersionId, selectedVersionDetail, loading, loadError, hostedLoading, hostedError, refs

  // Remaining local state (UI-specific):
  const [workflowMenuPlacement, setWorkflowMenuPlacement] =
    useState<ActionMenuPlacement>("up");
  const workflowMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workflowMenuRef = useRef<HTMLDivElement | null>(null);
  const closeWorkflowMenu = useCallback(() => {
    setOpenWorkflowMenuId(null);
    setWorkflowMenuPlacement("up");
    workflowMenuTriggerRef.current = null;
    workflowMenuRef.current = null;
  }, [workflowMenuRef, workflowMenuTriggerRef]);

  // Use modal management hook for mobile actions only
  // Note: Modal states (Appearance, Create, Deploy) come from ModalContext above
  const {
    appearanceModalTarget,
    appearanceModalTriggerRef,
    openAppearanceModal,
    setAppearanceModalTarget,
    handleOpenCreateModal,
    setCreateModalOpen,
    handleOpenDeployModal,
    setDeployModalOpen,
    isMobileActionsOpen,
    toggleMobileActions,
    closeMobileActions,
    mobileActionsTriggerRef,
    mobileActionsMenuRef,
    setIsMobileActionsOpen,
  } = useWorkflowBuilderModals({
    closeWorkflowMenu,
    isCreatingWorkflow,
    isDeploying,
  });

  // Phase 4: Refs migrated to contexts
  // - SaveContext: lastSavedSnapshotRef, saveStateRef
  // - SelectionContext: selectedNodeIdRef, selectedEdgeIdRef, selectedNodeIdsRef, selectedEdgeIdsRef, previousSelectedElementRef
  // - GraphContext: nodesRef, edgesRef, hasPendingChangesRef, isNodeDragInProgressRef
  // - ViewportContext: viewportRef, viewportMemoryRef, viewportKeyRef, hasUserViewportChangeRef, pendingViewportRestoreRef
  // - WorkflowContext: versionsRef, selectedWorkflowIdRef, selectedVersionIdRef, draftVersionIdRef, draftVersionSummaryRef

  // Remaining local refs:
  const isCreatingDraftRef = useRef(false);
  const isHydratingRef = useRef(false);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const reactFlowWrapperRef = useRef<HTMLDivElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const isMobileLayout = useMediaQuery("(max-width: 768px)");
  const deviceType: DeviceType = isMobileLayout ? "mobile" : "desktop";

  // Sync isMobileLayout with UIContext
  useEffect(() => {
    setContextIsMobileLayout(isMobileLayout);
  }, [isMobileLayout, setContextIsMobileLayout]);

  // Calculate base min zoom (used by viewport persistence hook)
  const baseMinViewportZoom = useMemo(
    () => (isMobileLayout ? MOBILE_MIN_VIEWPORT_ZOOM : DESKTOP_MIN_VIEWPORT_ZOOM),
    [isMobileLayout],
  );

  // Note: minViewportZoom, initialViewport, refreshViewportConstraints, restoreViewport come from ViewportContext

  const { persistViewportMemory } =
    useWorkflowViewportPersistence({
      authHeader,
      backendUrl,
      baseMinViewportZoom,
      hasUserViewportChangeRef,
      pendingViewportRestoreRef,
      reactFlowInstanceRef,
      setMinViewportZoom,
      token,
      viewportKeyRef,
      viewportMemoryRef,
      viewportRef,
    });

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

  // Note: isBlockLibraryOpen and isPropertiesPanelOpen come from UIContext (imported above)
  // Note: selectedNodeId, selectedEdgeId and their refs come from SelectionContext (imported above)
  const blockLibraryToggleRef = useRef<HTMLButtonElement | null>(null);
  const propertiesPanelToggleRef = useRef<HTMLButtonElement | null>(null);
  const propertiesPanelCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastTappedElementRef = useRef<{
    kind: "node" | "edge";
    id: string;
    tapCount: number;
  } | null>(null);
  // Note: isNodeDragInProgressRef comes from GraphContext (above)
  const copySequenceRef = useRef<{ count: number; lastTimestamp: number }>({
    count: 0,
    lastTimestamp: 0,
  });
  const workflowBusyRef = useRef(false);
  // Note: nodesRef and edgesRef come from GraphContext (above)

  // Use workflow history hook for undo/redo functionality
  const { historyRef, resetHistory, restoreGraphFromSnapshot, undoHistory, redoHistory } =
    useWorkflowHistory({
      setNodes,
      setEdges,
      setSelectedNodeId,
      setSelectedEdgeId,
      selectedNodeIdsRef,
      selectedEdgeIdsRef,
      selectedNodeIdRef,
      selectedEdgeIdRef,
      decorateNode,
    });
  const isAuthenticated = Boolean(user);
  const isAdmin = Boolean(user?.is_admin);
  const blockLibraryId = "workflow-builder-block-library";
  const blockLibraryContentId = "workflow-builder-block-library-content";
  const propertiesPanelId = "workflow-builder-properties-panel";
  const propertiesPanelTitleId = `${propertiesPanelId}-title`;
  const mobileActionsDialogId = "workflow-builder-mobile-actions";
  const mobileActionsTitleId = `${mobileActionsDialogId}-title`;
  // Mobile actions handlers now provided by useWorkflowBuilderModals hook

  const toggleBlockLibrary = useCallback(() => {
    setIsBlockLibraryOpen((prev) => !prev);
  }, []);
  const closeBlockLibrary = useCallback(
    (options: { focusToggle?: boolean } = {}) => {
      setIsBlockLibraryOpen(false);
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
    setIsBlockLibraryOpen(!isMobileLayout);
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

  // Synchronize local selectedWorkflowId with WorkflowContext
  useEffect(() => {
    setSelectedWorkflowIdContext(selectedWorkflowId);
  }, [selectedWorkflowId, setSelectedWorkflowIdContext]);

  useEffect(() => {
    hasPendingChangesRef.current = hasPendingChanges;
  }, [hasPendingChanges]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  // Synchronize WorkflowContext state with useWorkflowSidebarState for cache/persistence
  useEffect(() => {
    setSidebarWorkflows(workflows);
  }, [workflows, setSidebarWorkflows]);

  useEffect(() => {
    setSidebarHostedWorkflows(hostedWorkflows);
  }, [hostedWorkflows, setSidebarHostedWorkflows]);

  useEffect(() => {
    setSidebarSelectedWorkflowId(selectedWorkflowId as number | null);
  }, [selectedWorkflowId, setSidebarSelectedWorkflowId]);

  useEscapeKeyHandler(
    () => {
      closeBlockLibrary({ focusToggle: true });
    },
    {
      enabled: isMobileLayout && isBlockLibraryOpen,
      preventDefault: true,
    },
  );

  useEscapeKeyHandler(
    () => {
      closeMobileActions({ focusTrigger: true });
    },
    {
      enabled: isMobileActionsOpen,
      preventDefault: true,
    },
  );

  useOutsidePointerDown(
    [mobileActionsTriggerRef, mobileActionsMenuRef],
    () => {
      closeMobileActions();
    },
    { enabled: isMobileActionsOpen },
  );

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

  useOutsidePointerDown(
    [workflowMenuTriggerRef, workflowMenuRef],
    () => {
      closeWorkflowMenu();
    },
    { enabled: openWorkflowMenuId !== null },
  );

  useEscapeKeyHandler(
    () => {
      closeWorkflowMenu();
    },
    {
      enabled: openWorkflowMenuId !== null,
    },
  );

  const {
    applySelection,
    clearSelection,
    onSelectionChange,
    removeElements,
    copySelectionToClipboard,
    pasteClipboardGraph,
    handleDuplicateSelection,
    handleDeleteSelection,
    resetCopySequence,
  } = useGraphEditor({
    nodeClassName: styles.flowNode,
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
  });

  const renderWorkflowDescription = (className?: string) =>
    selectedWorkflow?.description ? (
      <div
        className={className}
        style={
          className
            ? undefined
            : { color: "var(--text-muted)", fontSize: "0.95rem" }
        }
      >
        {selectedWorkflow.description}
      </div>
    ) : null;

  const renderWorkflowPublicationReminder = (className?: string) =>
    selectedWorkflow && !selectedWorkflow.active_version_id ? (
      <div
        className={className}
        style={
          className
            ? undefined
            : { color: "#b45309", fontSize: "0.85rem", fontWeight: 600 }
        }
      >
        {t("workflowBuilder.publicationReminder.publishToUse")}
      </div>
    ) : null;

  // Phase 4: Utiliser WorkflowBuilderHeader qui gère lui-même la logique via les contextes
  const renderHeaderControls = () => {
    return (
      <WorkflowBuilderHeader
        selectedWorkflow={selectedWorkflow ?? null}
        importFileInputRef={importFileInputRef}
        mobileActionsTriggerRef={mobileActionsTriggerRef}
        mobileActionsMenuRef={mobileActionsMenuRef}
        onVersionChange={handleVersionChange}
        onImportFileChange={handleImportFileChange}
        onTriggerImport={handleTriggerImport}
        onExportWorkflow={handleExportWorkflow}
        onOpenDeployModal={handleOpenDeployModalWithSetup}
        renderWorkflowDescription={renderWorkflowDescription}
        renderWorkflowPublicationReminder={renderWorkflowPublicationReminder}
        isMobileActionsOpen={isMobileActionsOpen}
        onToggleMobileActions={toggleMobileActions}
        closeMobileActions={closeMobileActions}
      />
    );
  };

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
          lastError =
            error instanceof Error
              ? error
              : new Error(t("workflowBuilder.errors.unknown"));
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
      t,
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
            throw new Error(
              t("workflowBuilder.errors.loadVersionsFailedWithStatus", {
                status: response.status,
              }),
            );
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
          lastError =
            error instanceof Error
              ? error
              : new Error(t("workflowBuilder.errors.unknown"));
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
      t,
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
            throw new Error(
              t("workflowBuilder.errors.loadLibraryFailedWithStatus", {
                status: response.status,
              }),
            );
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
          lastError =
            error instanceof Error
              ? error
              : new Error(t("workflowBuilder.errors.unknown"));
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
      t,
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
  }, [t, token, setHostedWorkflows, setHostedError, setHostedLoading]);

  useEffect(() => {
    void loadWorkflows({ suppressLoadingState: initialSidebarCacheUsedRef.current });
    initialSidebarCacheUsedRef.current = false;
  }, [loadWorkflows]);

  // Remote version polling
  useRemoteVersionPolling({
    selectedWorkflowId,
    selectedVersionId,
    saveState,
    hasPendingChanges,
    backendUrl,
    authHeader,
    t,
    versions,
    draftVersionId: draftVersionIdRef.current,
    loadVersions,
    loadWorkflows,
  });

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
      selectNode(node.id);  // Update selection state
      // On mobile, applySelection is not called by ReactFlow, so we call it manually to apply visual styling
      if (isMobileLayout) {
        applySelection({ nodeIds: [node.id], primaryNodeId: node.id });
      }
      if (isMobileLayout && isSameElement && nextTapCount >= 2) {
        setIsPropertiesPanelOpen(true);
      }
    },
    [isMobileLayout, selectNode, applySelection, setIsPropertiesPanelOpen],
  );

  const handleEdgeClick = useCallback(
    (_: unknown, edge: FlowEdge) => {
      const lastTapped = lastTappedElementRef.current;
      const isSameElement = lastTapped?.kind === "edge" && lastTapped.id === edge.id;
      const nextTapCount = isSameElement ? Math.min(lastTapped.tapCount + 1, 2) : 1;
      lastTappedElementRef.current = { kind: "edge", id: edge.id, tapCount: nextTapCount };
      selectEdge(edge.id);  // Update selection state
      // On mobile, applySelection is not called by ReactFlow, so we call it manually to apply visual styling
      if (isMobileLayout) {
        applySelection({ edgeIds: [edge.id], primaryEdgeId: edge.id });
      }
      if (isMobileLayout && isSameElement && nextTapCount >= 2) {
        setIsPropertiesPanelOpen(true);
      }
    },
    [isMobileLayout, selectEdge, applySelection, setIsPropertiesPanelOpen],
  );

  const handleClearSelection = clearSelection;

  const handleSelectionChange = onSelectionChange;

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
      setIsPropertiesPanelOpen(false);
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
    setIsPropertiesPanelOpen(true);
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
      setIsPropertiesPanelOpen(false);
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
        setIsPropertiesPanelOpen(false);
      }
    } else if (isNewSelection && !isNodeDragInProgressRef.current) {
      setIsPropertiesPanelOpen(true);
    }

    previousSelectedElementRef.current = selectedElementKey;
  }, [isMobileLayout, selectedEdgeId, selectedElementKey, selectedNodeId]);

  useEffect(() => {
    if (!isMobileLayout) {
      if (selectedElementKey) {
        setIsPropertiesPanelOpen(true);
      }
    }
  }, [isMobileLayout, selectedElementKey]);

  useEffect(() => {
    if (!isMobileLayout || !isPropertiesPanelOpen) {
      return;
    }
    propertiesPanelCloseButtonRef.current?.focus();
  }, [isMobileLayout, isPropertiesPanelOpen]);

  useEscapeKeyHandler(
    () => {
      handleClosePropertiesPanel();
    },
    {
      enabled: isMobileLayout && isPropertiesPanelOpen,
      preventDefault: true,
    },
  );

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

  const nodeHandlers = useWorkflowNodeHandlers({
    updateNodeData,
    addNodeToGraph,
    humanizeSlug,
    isReasoningModel,
    workflows,
    vectorStores,
  });

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


  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((currentNode) => currentNode.id === nodeId);
      let confirmed = true;
      if (node) {
        const trimmedDisplayName =
          typeof node.data.displayName === "string" ? node.data.displayName.trim() : "";
        const displayName = trimmedDisplayName || node.data.slug || nodeId;
        confirmed = window.confirm(t("workflowBuilder.deleteBlock.confirm", { name: displayName }));
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
    [removeElements, selectedNodeId, t, updateHasPendingChanges],
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
    [removeElements, selectedEdgeId, setEdges, updateHasPendingChanges],
  );
  // History management functions now provided by useWorkflowHistory hook

  workflowBusyRef.current = loading || isImporting || isExporting;

  useWorkflowKeyboardShortcuts({
    applySelection,
    copySelectionToClipboard,
    copySequenceRef,
    edgesRef,
    nodesRef,
    pasteClipboardGraph,
    redoHistory,
    removeElements,
    resetCopySequence,
    selectedEdgeIdsRef,
    selectedNodeIdsRef,
    undoHistory,
    workflowBusyRef,
  });

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

  // Override handleOpenCreateModal to include form reset logic
  const handleOpenCreateModalWithReset = useCallback(() => {
    setCreateWorkflowKind("local");
    setCreateWorkflowName("");
    setCreateWorkflowRemoteId("");
    setCreateWorkflowError(null);
    handleOpenCreateModal();
  }, [handleOpenCreateModal]);

  // handleCloseCreateModal is provided by useWorkflowBuilderModals hook

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

  const conditionGraphError = useMemo(() => validateGraphStructure(nodes, edges), [edges, nodes]);

  // Phase 4: Use openDeployModal from ModalContext instead of handleOpenDeployModal from useWorkflowBuilderModals
  const handleOpenDeployModalWithSetup = useCallback(() => {
    setSaveMessage(null);
    openDeployModal(true); // true = deployToProduction
  }, [openDeployModal, setSaveMessage]);

  // handleCloseDeployModal is provided by useWorkflowBuilderModals hook

  useEscapeKeyHandler(handleCloseDeployModal, {
    enabled: isDeployModalOpen,
  });

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

  const {
    handleSave,
    handleImportFileChange,
    handleTriggerImport,
    handleExportWorkflow,
  } = useWorkflowPersistence({
    authHeader,
    autoSaveSuccessMessage,
    backendUrl,
    buildGraphPayload,
    conditionGraphError,
    deviceType,
    disableSave,
    draftDisplayName,
    draftVersionIdRef,
    draftVersionSummaryRef,
    formatSaveFailureWithStatus,
    graphSnapshot,
    hasPendingChanges,
    importFileInputRef,
    isCreatingDraftRef,
    isExporting,
    isHydratingRef,
    isImporting,
    lastSavedSnapshotRef,
    loadVersions,
    loadWorkflows,
    loading,
    nodes,
    persistViewportMemory,
    reactFlowInstanceRef,
    saveFailureMessage,
    saveState,
    selectedWorkflow,
    selectedWorkflowId,
    selectedVersionId,
    setInitialViewport,
    setIsExporting,
    setIsImporting,
    setSaveMessage,
    setSaveState,
    setSelectedVersionId,
    t,
    updateHasPendingChanges,
    versions,
    viewportKeyRef,
    viewportMemoryRef,
    viewportRef,
  });

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

  const blockLibraryItems = useMemo<BlockLibraryItem[]>(() => {
    const definitions: Array<{
      key: string;
      kind: NodeKind;
      shortLabel: string;
      onClick: () => void;
    }> = [
      { key: "agent", kind: "agent", shortLabel: "A", onClick: nodeHandlers.handleAddAgentNode },
      {
        key: "voice-agent",
        kind: "voice_agent",
        shortLabel: "AV",
        onClick: nodeHandlers.handleAddVoiceAgentNode,
      },
      {
        key: "outbound-call",
        kind: "outbound_call",
        shortLabel: "AS",
        onClick: nodeHandlers.handleAddOutboundCallNode,
      },
      { key: "condition", kind: "condition", shortLabel: "C", onClick: nodeHandlers.handleAddConditionNode },
      {
        key: "parallel-split",
        kind: "parallel_split",
        shortLabel: "SP",
        onClick: nodeHandlers.handleAddParallelSplitNode,
      },
      {
        key: "parallel-join",
        kind: "parallel_join",
        shortLabel: "JP",
        onClick: nodeHandlers.handleAddParallelJoinNode,
      },
      { key: "state", kind: "state", shortLabel: "É", onClick: nodeHandlers.handleAddStateNode },
      { key: "watch", kind: "watch", shortLabel: "W", onClick: nodeHandlers.handleAddWatchNode },
      { key: "transform", kind: "transform", shortLabel: "T", onClick: nodeHandlers.handleAddTransformNode },
      {
        key: "wait-for-user-input",
        kind: "wait_for_user_input",
        shortLabel: "AU",
        onClick: nodeHandlers.handleAddWaitForUserInputNode,
      },
      {
        key: "assistant-message",
        kind: "assistant_message",
        shortLabel: "MA",
        onClick: nodeHandlers.handleAddAssistantMessageNode,
      },
      {
        key: "user-message",
        kind: "user_message",
        shortLabel: "MU",
        onClick: nodeHandlers.handleAddUserMessageNode,
      },
      {
        key: "json-vector-store",
        kind: "json_vector_store",
        shortLabel: "VS",
        onClick: nodeHandlers.handleAddVectorStoreNode,
      },
      { key: "widget", kind: "widget", shortLabel: "W", onClick: nodeHandlers.handleAddWidgetNode },
      { key: "end", kind: "end", shortLabel: "F", onClick: nodeHandlers.handleAddEndNode },
    ];

    return definitions.map((definition) => ({
      ...definition,
      label: labelForKind(definition.kind, t),
      color: NODE_COLORS[definition.kind],
    }));
  }, [
    t,
    nodeHandlers.handleAddAgentNode,
    nodeHandlers.handleAddVoiceAgentNode,
    nodeHandlers.handleAddConditionNode,
    nodeHandlers.handleAddParallelSplitNode,
    nodeHandlers.handleAddParallelJoinNode,
    nodeHandlers.handleAddStateNode,
    nodeHandlers.handleAddWatchNode,
    nodeHandlers.handleAddTransformNode,
    nodeHandlers.handleAddWaitForUserInputNode,
    nodeHandlers.handleAddAssistantMessageNode,
    nodeHandlers.handleAddUserMessageNode,
    nodeHandlers.handleAddVectorStoreNode,
    nodeHandlers.handleAddWidgetNode,
    nodeHandlers.handleAddEndNode,
  ]);

  // Phase 4.5: BlockLibrary now uses contexts (8 → 3 props, -62.5%)
  const blockLibraryContent = useMemo(
    () => (
      <BlockLibrary
        contentId={blockLibraryContentId}
        items={blockLibraryItems}
        toggleRef={blockLibraryToggleRef}
      />
    ),
    [blockLibraryContentId, blockLibraryItems, blockLibraryToggleRef],
  );

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
    ? selectedNode.data.displayName.trim() || labelForKind(selectedNode.data.kind, t)
    : selectedEdge
      ? `${selectedEdge.source} → ${selectedEdge.target}`
      : "";

  const headerOverlayOffset = useMemo(
    () => (isMobileLayout ? "4rem" : "4.25rem"),
    [isMobileLayout],
  );

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
            nodeHandlers={nodeHandlers}
            workflows={workflows}
            currentWorkflowId={selectedWorkflowId}
            hostedWorkflows={hostedWorkflows}
            hostedWorkflowsLoading={hostedLoading}
            hostedWorkflowsError={hostedError}
            availableModels={availableModels}
            availableModelsLoading={availableModelsLoading}
            availableModelsError={availableModelsError}
            isReasoningModel={isReasoningModel}
            vectorStores={vectorStores}
            vectorStoresLoading={vectorStoresLoading}
            vectorStoresError={vectorStoresError}
            widgets={widgets}
            widgetsLoading={widgetsLoading}
            widgetsError={widgetsError}
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

  const shouldShowWorkflowDescription = !isMobileLayout && Boolean(selectedWorkflow?.description);
  const shouldShowPublicationReminder =
    !isMobileLayout && Boolean(selectedWorkflow) && !selectedWorkflow?.active_version_id;

  const headerStyle = useMemo(() => {
    const baseStyle = getHeaderContainerStyle(isMobileLayout);
    return { ...baseStyle, position: "absolute", top: 0, left: 0, right: 0 };
  }, [isMobileLayout]);

  const headerNavigationButtonStyle = useMemo(
    () => getHeaderNavigationButtonStyle(isMobileLayout),
    [isMobileLayout],
  );

  const workspaceWrapperStyle = useMemo<CSSProperties>(() => {
    if (isMobileLayout) {
      return { position: "absolute", inset: 0, overflow: "hidden" };
    }
    return { position: "relative", flex: 1, overflow: "hidden", minHeight: 0 };
  }, [isMobileLayout]);

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

  const mobileActionLabels = useMemo<MobileActionLabels>(
    () => ({
      redo: t("workflowBuilder.mobileActions.redo"),
      undo: t("workflowBuilder.mobileActions.undo"),
      duplicate: t("workflowBuilder.mobileActions.duplicate"),
      delete: t("workflowBuilder.mobileActions.delete"),
      properties: t("workflowBuilder.mobileActions.properties"),
    }),
    [t],
  );

  return (
    <ReactFlowProvider>
      {/* Phase 4.5: WorkflowBuilderSidebar now uses contexts (28 → 13 props, -54%) */}
      <WorkflowBuilderSidebar
        lastUsedAt={lastUsedAt}
        pinnedLookup={pinnedLookup}
        workflowMenuPlacement={workflowMenuPlacement}
        isSidebarCollapsed={isSidebarCollapsed}
        workflowSortCollator={workflowSortCollatorRef.current}
        onSelectWorkflow={handleSelectWorkflow}
        onRenameWorkflow={handleRenameWorkflow}
        onDeleteWorkflow={handleDeleteWorkflow}
        onDuplicateWorkflow={handleDuplicateWorkflow}
        onDeleteHostedWorkflow={handleDeleteHostedWorkflow}
        onToggleLocalPin={toggleLocalPin}
        onToggleHostedPin={toggleHostedPin}
        onOpenCreateModal={handleOpenCreateModalWithReset}
        onOpenAppearanceModal={openAppearanceModal}
        onExportWorkflow={handleExportWorkflow}
        workflowMenuTriggerRef={workflowMenuTriggerRef}
        workflowMenuRef={workflowMenuRef}
        setWorkflowMenuPlacement={setWorkflowMenuPlacement}
      />
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
        {/* Phase 4.5: WorkflowBuilderCanvas now uses contexts (26 → 21 props, -19%) */}
        <WorkflowBuilderCanvas
          openSidebar={openSidebar}
          renderHeaderControls={renderHeaderControls}
          renderWorkflowDescription={renderWorkflowDescription}
          renderWorkflowPublicationReminder={renderWorkflowPublicationReminder}
          blockLibraryContent={blockLibraryContent}
          propertiesPanelElement={propertiesPanelElement}
          reactFlowContainerRef={reactFlowContainerRef}
          handleNodesChange={handleNodesChange}
          handleEdgesChange={handleEdgesChange}
          handleNodeClick={handleNodeClick}
          handleEdgeClick={handleEdgeClick}
          handleClearSelection={handleClearSelection}
          handleSelectionChange={handleSelectionChange}
          handleNodeDragStart={handleNodeDragStart}
          handleNodeDragStop={handleNodeDragStop}
          redoHistory={redoHistory}
          undoHistory={undoHistory}
          handleDuplicateSelection={handleDuplicateSelection}
          handleDeleteSelection={handleDeleteSelection}
          canRedoHistory={canRedoHistory}
          canUndoHistory={canUndoHistory}
        />
      </div>
      <WorkflowBuilderToast />
      <WorkflowBuilderModals
        onSubmitCreateWorkflow={handleSubmitCreateWorkflow}
        onConfirmDeploy={handleConfirmDeploy}
        deployModalTitle={deployModalTitle}
        deployModalDescription={deployModalDescription}
        deployModalSourceLabel={deployModalSourceLabel}
        deployModalTargetLabel={deployModalTargetLabel}
        deployModalPrimaryLabel={deployModalPrimaryLabel}
        isPrimaryActionDisabled={isPrimaryActionDisabled}
        shouldShowVersionPath={versionSummaryForPromotion != null}
        appearanceModalTarget={appearanceModalTarget}
        onCloseAppearanceModal={handleCloseAppearanceModal}
      />
    </ReactFlowProvider>
  );
};

export default WorkflowBuilderPage;
