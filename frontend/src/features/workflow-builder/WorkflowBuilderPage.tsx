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
import { useWorkflowLoader } from "./hooks/useWorkflowLoader";
import { useWorkflowCRUD } from "./hooks/useWorkflowCRUD";
import { useWorkflowDeployment } from "./hooks/useWorkflowDeployment";
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
  // Phase 5: Import providers for enricher pattern
  GraphProvider,
  SelectionProvider,
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

  // Phase 6: Extract complex loading logic into useWorkflowLoader hook
  const { loadVersionDetail, loadVersions, loadWorkflows } = useWorkflowLoader({
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
    buildGraphPayloadFrom,
    hasLoadedWorkflowsRef,
  });

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

  // Define buildGraphPayload before useWorkflowCRUD needs it
  const buildGraphPayload = useCallback(
    () => buildGraphPayloadFrom(nodes, edges),
    [edges, nodes],
  );

  // Phase 1: Extract workflow CRUD operations into useWorkflowCRUD hook
  const {
    handleSubmitCreateWorkflow,
    handleDeleteWorkflow,
    handleDeleteHostedWorkflow,
    handleDuplicateWorkflow,
    handleRenameWorkflow,
  } = useWorkflowCRUD({
    authHeader,
    token,
    t,
    loadWorkflows,
    loadHostedWorkflows,
    closeWorkflowMenu,
    applySelection,
    buildGraphPayload,
  });

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
  // handleSubmitCreateWorkflow, handleDeleteWorkflow, handleDeleteHostedWorkflow
  // now provided by useWorkflowCRUD hook (Phase 1)
  // buildGraphPayload is now defined earlier (before useWorkflowCRUD)

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

  // handleDuplicateWorkflow and handleRenameWorkflow
  // now provided by useWorkflowCRUD hook (Phase 1)

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

  // Phase 6: Extract deployment logic into useWorkflowDeployment hook
  const { handleConfirmDeploy } = useWorkflowDeployment({
    authHeader,
    t,
    handleSave,
    buildGraphPayload,
    loadVersions,
    loadWorkflows,
    resolveVersionIdToPromote,
  });

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
      {/* Phase 5: Enrich contexts with handlers from hooks */}
      <GraphProvider
        undoHistory={undoHistory}
        redoHistory={redoHistory}
        canUndoHistory={canUndoHistory}
        canRedoHistory={canRedoHistory}
        handleDuplicateSelection={handleDuplicateSelection}
        handleDeleteSelection={handleDeleteSelection}
        canDuplicateSelection={canDuplicateSelection}
        canDeleteSelection={canDeleteSelection}
      >
        <SelectionProvider
          handleNodeClick={handleNodeClick}
          handleEdgeClick={handleEdgeClick}
          handleClearSelection={handleClearSelection}
          onSelectionChange={handleSelectionChange}
        >
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
        {/* Phase 5: WorkflowBuilderCanvas now uses contexts (21 → 10 props, -52%) */}
        <WorkflowBuilderCanvas
          openSidebar={openSidebar}
          renderHeaderControls={renderHeaderControls}
          renderWorkflowDescription={renderWorkflowDescription}
          renderWorkflowPublicationReminder={renderWorkflowPublicationReminder}
          blockLibraryContent={blockLibraryContent}
          propertiesPanelElement={propertiesPanelElement}
          reactFlowContainerRef={reactFlowContainerRef}
          handleNodeDragStart={handleNodeDragStart}
          handleNodeDragStop={handleNodeDragStop}
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
        </SelectionProvider>
      </GraphProvider>
    </ReactFlowProvider>
  );
};

export default WorkflowBuilderPage;
