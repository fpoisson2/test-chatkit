import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { useSearchParams } from "react-router-dom";

import { type EdgeChange, type NodeChange, type ReactFlowInstance, type Viewport } from "reactflow";

import "reactflow/dist/style.css";
import "@reactflow/node-resizer/dist/style.css";

import { useAuth } from "../../auth";
import { useI18n } from "../../i18n";
import { useAppLayout } from "../../components/AppLayout";
import { chatkitApi, makeApiEndpointCandidates, type HostedWorkflowMetadata } from "../../utils/backend";
import { resolveAgentParameters, resolveStateParameters } from "../../utils/agentPresets";
import { useEscapeKeyHandler } from "./hooks/useEscapeKeyHandler";
import { useOutsidePointerDown } from "./hooks/useOutsidePointerDown";
import useWorkflowResources from "./hooks/useWorkflowResources";
import { useWorkflowSidebar } from "../workflows/WorkflowSidebarProvider";
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
import { WorkflowBuilderSidebar } from "../workflows/WorkflowSidebar";
import BlockLibrary, { type BlockLibraryItem } from "./components/BlockLibrary";
import WorkflowBuilderCanvas, {
  type MobileActionLabels,
} from "./components/WorkflowBuilderCanvas";
import WorkflowBuilderToast from "./components/WorkflowBuilderToast";
import WorkflowBuilderModals from "./components/WorkflowBuilderModals";
import WorkflowBuilderPropertiesPanel from "./components/WorkflowBuilderPropertiesPanel";
import EditableBlockTitle from "./components/EditableBlockTitle";
import WorkflowBuilderHeader from "./components/WorkflowBuilderHeader";
import useWorkflowNodeHandlers from "./hooks/useWorkflowNodeHandlers";
import useGraphEditor from "./hooks/useGraphEditor";
import useWorkflowPersistence from "./hooks/useWorkflowPersistence";
import { useWorkflowLoader } from "./hooks/useWorkflowLoader";
import { useWorkflowCRUD } from "./hooks/useWorkflowCRUD";
import { useWorkflowDeployment } from "./hooks/useWorkflowDeployment";
import { useEdgeHandlers } from "./hooks/useEdgeHandlers";
import { useElementDeletion } from "./hooks/useElementDeletion";
import { useNodeOperations } from "./hooks/useNodeOperations";
import { useWorkflowSelection } from "./hooks/useWorkflowSelection";
import { useWorkflowValidation } from "./hooks/useWorkflowValidation";
import { usePropertiesPanel } from "./hooks/usePropertiesPanel";
import { useNodeInteractions } from "./hooks/useNodeInteractions";
import { useWorkflowSync } from "./hooks/useWorkflowSync";
import { useDeploymentModal } from "./hooks/useDeploymentModal";
import { useViewportManagement } from "./hooks/useViewportManagement";
import { useBlockLibraryItems } from "./hooks/useBlockLibraryItems";
import { useWorkflowMenu } from "./hooks/useWorkflowMenu";
import { useWorkflowStyles } from "./hooks/useWorkflowStyles";
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
  DEFAULT_WHILE_NODE_SIZE,
  WHILE_NODE_LAYER_INDEX,
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
  ViewportProvider,
} from "./contexts";

const WorkflowBuilderPage = () => {
  const { token, logout, user } = useAuth();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
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
    closeBlockLibrary,
    registerBlockLibraryToggle,
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
    onEdgesChange,
    onConnect,
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
    clearViewport,
    updateViewport,
    calculateMinZoom,
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
  } = useWorkflowContext();

  const decorateNode = useCallback(
    (node: FlowNode): FlowNode => {
      if (node.data.kind === "while") {
        const baseStyle = node.style ?? {};
        const nextStyle = {
          ...baseStyle,
          width: baseStyle.width ?? DEFAULT_WHILE_NODE_SIZE.width,
          height: baseStyle.height ?? DEFAULT_WHILE_NODE_SIZE.height,
          zIndex: baseStyle.zIndex ?? WHILE_NODE_LAYER_INDEX,
        } as CSSProperties;
        return {
          ...node,
          type: "while",
          resizable: true,
          className: styles.flowNode,
          style: nextStyle,
          selected: node.selected ?? false,
          zIndex: node.zIndex ?? WHILE_NODE_LAYER_INDEX,
        } satisfies FlowNode;
      }

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

  // Use WorkflowSidebarProvider for sidebar-specific functionality
  const {
    workflows: sidebarWorkflows,
    hostedWorkflows: sidebarHostedWorkflows,
    selectedWorkflowId: sidebarSelectedWorkflowId,
    setWorkflows: setSidebarWorkflows,
    setHostedWorkflows: setSidebarHostedWorkflows,
    setSelectedWorkflowId: setSidebarSelectedWorkflowId,
    lastUsedAt,
    pinnedLookup,
    toggleLocalPin,
    toggleHostedPin,
    workflowCollator,
    hasLoadedWorkflowsRef,
  } = useWorkflowSidebar();

  // Create a ref for the collator for compatibility
  const workflowSortCollatorRef = useRef(workflowCollator);

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

  // Phase 9: Extract workflow menu logic into custom hook
  const {
    workflowMenuPlacement,
    setWorkflowMenuPlacement,
    workflowMenuTriggerRef,
    workflowMenuRef,
    closeWorkflowMenu,
  } = useWorkflowMenu(setOpenWorkflowMenuId);

  // Use modal management hook for mobile actions only
  // Note: Modal states (Appearance, Create, Deploy) come from ModalContext above
  const {
    appearanceModalTarget,
    appearanceModalTriggerRef,
    openAppearanceModal,
    setAppearanceModalTarget,
    handleOpenCreateModal,
    handleOpenDeployModal,
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

  // Note: minViewportZoom and initialViewport come from ViewportContext.

  const {
    persistViewportMemory,
    refreshViewportConstraints,
    restoreViewport,
  } = useWorkflowViewportPersistence({
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

  useEffect(() => {
    setMinViewportZoom(baseMinViewportZoom);
  }, [baseMinViewportZoom]);

  useEffect(() => {
    setIsBlockLibraryOpen(!isMobileLayout);
  }, [isMobileLayout]);

  useEffect(() => {
    registerBlockLibraryToggle(blockLibraryToggleRef.current);
    return () => {
      registerBlockLibraryToggle(null);
    };
  }, [registerBlockLibraryToggle]);

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
    hasPendingChangesRef.current = hasPendingChanges;
  }, [hasPendingChanges]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

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

  // Phase 8: Extract workflow synchronization into custom hook
  useWorkflowSync({
    sidebarWorkflows,
    sidebarHostedWorkflows,
    sidebarSelectedWorkflowId,
    setSidebarWorkflows,
    setSidebarHostedWorkflows,
    setSidebarSelectedWorkflowId,
    workflows,
    hostedWorkflows,
    selectedWorkflowId,
    setWorkflows,
    setHostedWorkflows,
    setSelectedWorkflowId,
    loadVersions,
  });

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

  // Phase 7: Extract edge handlers into custom hook
  const { handleConditionChange, handleEdgeLabelChange } = useEdgeHandlers({
    setEdges,
    updateHasPendingChanges,
  });

  // Phase 7: Extract element deletion into custom hook
  const { handleRemoveNode, handleRemoveEdge } = useElementDeletion({
    nodesRef,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNodeId,
    setSelectedEdgeId,
    setEdges,
    removeElements,
    updateHasPendingChanges,
    t,
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

  // Only load workflows if they haven't been loaded by the WorkflowSidebarProvider yet
  useEffect(() => {
    // Check if workflows are already loaded in the provider
    if (!hasLoadedWorkflowsRef.current) {
      void loadWorkflows({ suppressLoadingState: false });
    }
  }, [loadWorkflows, hasLoadedWorkflowsRef]);

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

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  );

  // Phase 8: Extract properties panel logic into custom hook
  const {
    handleClosePropertiesPanel,
    handleOpenPropertiesPanel,
    propertiesPanelToggleRef,
    propertiesPanelCloseButtonRef,
    lastTappedElementRef,
  } = usePropertiesPanel({
    isMobileLayout,
    selectedNodeId,
    selectedEdgeId,
    selectedNode,
    selectedEdge,
    isPropertiesPanelOpen,
    setIsPropertiesPanelOpen,
    isNodeDragInProgressRef,
    handleClearSelection: clearSelection,
  });

  // Phase 8: Extract node interactions into custom hook
  const { handleNodeClick, handleEdgeClick, handleNodeDragStart, handleNodeDragStop } = useNodeInteractions({
    isMobileLayout,
    selectNode,
    selectEdge,
    applySelection,
    setIsPropertiesPanelOpen,
    isNodeDragInProgressRef,
    historyRef,
    lastTappedElementRef,
  });

  // Phase 8: handleNodeClick, handleEdgeClick, handleNodeDragStart, handleNodeDragStop now provided by useNodeInteractions hook
  // Phase 8: handleClosePropertiesPanel, handleOpenPropertiesPanel now provided by usePropertiesPanel hook
  // Phase 8: Properties panel effects now handled by usePropertiesPanel hook

  const handleClearSelection = clearSelection;
  const handleSelectionChange = onSelectionChange;

  useEffect(() => {
    selectedVersionIdRef.current = selectedVersionId;
  }, [selectedVersionId]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    selectedEdgeIdRef.current = selectedEdgeId;
  }, [selectedEdgeId]);

  useEscapeKeyHandler(
    () => {
      handleClosePropertiesPanel();
    },
    {
      enabled: isMobileLayout && isPropertiesPanelOpen,
      preventDefault: true,
    },
  );

  // Phase 9: Extract viewport management into custom hook
  const { updateViewportState } = useViewportManagement({
    viewportRef,
    viewportKeyRef,
    viewportMemoryRef,
    hasUserViewportChangeRef,
    setViewport,
    setHasUserViewportChange,
    persistViewportMemory,
  });

  // Phase 7: Extract node operations into custom hook
  const { updateNodeData, addNodeToGraph, centerViewportOnNode } = useNodeOperations({
    setNodes,
    decorateNode,
    applySelection,
    minViewportZoom,
    reactFlowInstanceRef,
    reactFlowWrapperRef,
    viewportRef,
    updateViewportState,
  });

  const nodeHandlers = useWorkflowNodeHandlers({
    updateNodeData,
    addNodeToGraph,
    humanizeSlug,
    isReasoningModel,
    workflows,
    vectorStores,
  });

  // Phase 7: handleConditionChange, handleEdgeLabelChange now provided by useEdgeHandlers hook
  // Phase 7: handleRemoveNode, handleRemoveEdge now provided by useElementDeletion hook
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

  // Phase 7: Extract workflow selection into custom hook
  const { handleSelectWorkflow, handleVersionChange } = useWorkflowSelection({
    selectedWorkflowId,
    isMobileLayout,
    setSelectedWorkflowId,
    setSelectedVersionId,
    closeWorkflowMenu,
    closeSidebar,
    loadVersions,
    loadVersionDetail,
    deviceType,
    viewportMemoryRef,
    viewportKeyFor,
  });

  // Override handleOpenCreateModal to include form reset logic
  const handleOpenCreateModalWithReset = useCallback(() => {
    setCreateWorkflowKind("local");
    setCreateWorkflowName("");
    setCreateWorkflowRemoteId("");
    setCreateWorkflowError(null);
    handleOpenCreateModal();
  }, [handleOpenCreateModal]);

  // Auto-open create modal if navigated from chat with ?create=true
  useEffect(() => {
    if (searchParams.get("create") === "true" && !isCreateModalOpen) {
      handleOpenCreateModalWithReset();
      // Remove the param from URL after opening the modal
      setSearchParams((params) => {
        params.delete("create");
        return params;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams, isCreateModalOpen, handleOpenCreateModalWithReset]);

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

  // Phase 8: Extract deployment modal logic into custom hook
  const {
    resolveVersionIdToPromote,
    versionIdToPromote,
    versionSummaryForPromotion,
    isPromotingDraft,
    deployModalTitle,
    deployModalDescription,
    deployModalSourceLabel,
    deployModalTargetLabel,
    deployModalPrimaryLabel,
    isPrimaryActionDisabled,
  } = useDeploymentModal({
    selectedVersionId,
    selectedVersionIdRef,
    draftVersionIdRef,
    versions,
    isDeploying,
    t,
  });

  // Phase 6: Extract deployment logic into useWorkflowDeployment hook
  const { handleConfirmDeploy } = useWorkflowDeployment({
    authHeader,
    token,
    t,
    handleSave,
    buildGraphPayload,
    loadVersions,
    loadWorkflows,
    resolveVersionIdToPromote,
  });

  // Phase 9: Extract block library items generation into custom hook
  const blockLibraryItems = useBlockLibraryItems({
    nodeHandlers,
    t,
  });

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

  // Phase 8: versionIdToPromote, versionSummaryForPromotion, isPromotingDraft, and all deployModal variables now provided by useDeploymentModal hook
  const selectedElementLabel = selectedNode
    ? selectedNode.data.displayName.trim() || labelForKind(selectedNode.data.kind, t)
    : selectedEdge
      ? `${selectedEdge.source} → ${selectedEdge.target}`
      : "";

  // Phase 9: Extract all layout styles into custom hook
  const {
    headerOverlayOffset,
    floatingPanelStyle,
    shouldShowWorkflowDescription,
    shouldShowPublicationReminder,
    headerStyle,
    headerNavigationButtonStyle,
    workspaceWrapperStyle,
    workspaceContentStyle,
    editorContainerStyle,
  } = useWorkflowStyles({
    isMobileLayout,
    selectedWorkflow,
  });

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
          {selectedNode ? (
            <EditableBlockTitle
              value={selectedNode.data.displayName}
              nodeId={selectedNode.id}
              onSave={nodeHandlers.handleDisplayNameChange}
              placeholder="Bloc"
              className={styles.propertiesPanelTitle}
            />
          ) : (
            <h2 id={propertiesPanelTitleId} className={styles.propertiesPanelTitle}>
              {selectedElementLabel || "Bloc"}
            </h2>
          )}
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
            currentWorkflow={selectedWorkflow}
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
            onWorkflowUpdate={() => loadWorkflows({ suppressLoadingState: true })}
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

  // Phase 9: shouldShowWorkflowDescription, shouldShowPublicationReminder, headerStyle, etc. now provided by useWorkflowStyles hook

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
    <ViewportProvider
      reactFlowInstanceRef={reactFlowInstanceRef}
      isHydratingRef={isHydratingRef}
      persistViewportMemory={persistViewportMemory}
      restoreViewport={restoreViewport}
      refreshViewportConstraints={refreshViewportConstraints}
    >
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
    </ViewportProvider>
  );
};

export default WorkflowBuilderPage;
