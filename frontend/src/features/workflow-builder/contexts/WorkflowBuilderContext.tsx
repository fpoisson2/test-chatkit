import { createContext, useContext, type ReactNode } from "react";
import type { ReactFlowInstance, Viewport } from "reactflow";
import type {
  AvailableModel,
  HostedWorkflowMetadata,
  VectorStoreSummary,
  WidgetTemplateSummary,
} from "../../../utils/backend";
import type {
  AgentNestedWorkflowSelection,
  ComputerUseConfig,
  FileSearchConfig,
  FlowEdge,
  FlowNode,
  ImageGenerationToolConfig,
  SaveState,
  StateAssignment,
  StateAssignmentScope,
  VectorStoreNodeConfig,
  WebSearchConfig,
  WidgetVariableAssignment,
  VoiceAgentStartBehavior,
  VoiceAgentStopBehavior,
  VoiceAgentTool,
  WorkflowSummary,
  WorkflowVersionResponse,
  WorkflowVersionSummary,
  ParallelBranch,
  McpSseToolConfig,
} from "../types";
import type { MobileActionLabels } from "../components/WorkflowBuilderCanvas";
import type { WorkflowAppearanceTarget } from "../../workflows/WorkflowAppearanceModal";
import type { ActionMenuPlacement } from "../styles";
import type {
  StoredWorkflowLastUsedAt,
  StoredWorkflowPinnedLookup,
} from "../../workflows/utils";

export type WorkflowBuilderContextValue = {
  // Core state
  loading: boolean;
  loadError: string | null;
  saveState: SaveState;
  saveMessage: string | null;
  hasPendingChanges: boolean;

  // Workflow state
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  selectedWorkflowId: number | null;
  selectedVersionId: number | null;
  versions: WorkflowVersionSummary[];
  selectedVersionDetail: WorkflowVersionResponse | null;
  lastUsedAt: StoredWorkflowLastUsedAt;
  pinnedLookup: StoredWorkflowPinnedLookup;

  // Graph state
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // Data state
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  widgets: WidgetTemplateSummary[];
  widgetsLoading: boolean;
  widgetsError: string | null;
  hostedLoading: boolean;
  hostedError: string | null;

  // UI state
  isAppearanceModalOpen: boolean;
  appearanceModalTarget: WorkflowAppearanceTarget | null;
  isDeployModalOpen: boolean;
  isCreateModalOpen: boolean;
  createWorkflowKind: "local" | "hosted";
  createWorkflowName: string;
  createWorkflowRemoteId: string;
  createWorkflowError: string | null;
  isCreatingWorkflow: boolean;
  deployToProduction: boolean;
  isDeploying: boolean;
  isExporting: boolean;
  isImporting: boolean;
  isMobileActionsOpen: boolean;
  openWorkflowMenuId: string | number | null;
  workflowMenuPlacement: ActionMenuPlacement;
  isBlockLibraryOpen: boolean;
  isPropertiesPanelOpen: boolean;

  // Viewport state
  minViewportZoom: number;
  initialViewport: Viewport | undefined;
  isMobileLayout: boolean;

  // Refs
  reactFlowInstanceRef: React.RefObject<ReactFlowInstance | null>;
  reactFlowWrapperRef: React.RefObject<HTMLDivElement | null>;
  importFileInputRef: React.RefObject<HTMLInputElement | null>;
  mobileActionsTriggerRef: React.RefObject<HTMLButtonElement | null>;
  mobileActionsMenuRef: React.RefObject<HTMLDivElement | null>;
  blockLibraryScrollRef: React.RefObject<HTMLDivElement | null>;
  blockLibraryItemRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  blockLibraryToggleRef: React.RefObject<HTMLButtonElement | null>;
  propertiesPanelToggleRef: React.RefObject<HTMLButtonElement | null>;
  propertiesPanelCloseButtonRef: React.RefObject<HTMLButtonElement | null>;
  appearanceModalTriggerRef: React.MutableRefObject<HTMLButtonElement | null>;

  // Constants
  blockLibraryId: string;
  blockLibraryContentId: string;
  propertiesPanelId: string;
  propertiesPanelTitleId: string;
  mobileActionsDialogId: string;
  mobileActionsTitleId: string;
  mobileActionLabels: MobileActionLabels;

  // Graph handlers
  onNodesChange: (changes: any[]) => void;
  onEdgesChange: (changes: any[]) => void;
  onConnect: (connection: any) => void;
  onInit: (instance: ReactFlowInstance) => void;
  onMove: () => void;
  onNodeDragStart: () => void;
  onNodeDragStop: () => void;
  onSelectionDragStart: () => void;
  onSelectionDragStop: () => void;

  // Node operations
  onNodeClick: (nodeId: string) => void;
  onEdgeClick: (edgeId: string) => void;
  onPaneClick: () => void;
  onNodeRemove: (nodeId: string) => void;
  onEdgeRemove: (edgeId: string) => void;
  onNodeAdd: (kind: string, options?: { position?: { x: number; y: number } }) => void;
  onNodeCopy: () => void;
  onNodePaste: () => void;

  // Node property handlers
  onDisplayNameChange: (nodeId: string, value: string) => void;
  onAgentMessageChange: (nodeId: string, value: string) => void;
  onAgentModelChange: (
    nodeId: string,
    selection: {
      model: string;
      providerId?: string | null;
      providerSlug?: string | null;
      store?: boolean | null;
    },
  ) => void;
  onAgentProviderChange: (
    nodeId: string,
    selection: { providerId?: string | null; providerSlug?: string | null },
  ) => void;
  onAgentNestedWorkflowChange: (
    nodeId: string,
    selection: AgentNestedWorkflowSelection,
  ) => void;
  onAgentReasoningChange: (nodeId: string, value: string) => void;
  onAgentReasoningSummaryChange: (nodeId: string, value: string) => void;
  onAgentTextVerbosityChange: (nodeId: string, value: string) => void;
  onAgentTemperatureChange: (nodeId: string, value: string) => void;
  onAgentTopPChange: (nodeId: string, value: string) => void;
  onAgentMaxOutputTokensChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatKindChange: (nodeId: string, kind: "text" | "json_schema" | "widget") => void;
  onAgentResponseFormatNameChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatSchemaChange: (nodeId: string, schema: unknown) => void;
  onAgentResponseWidgetSlugChange: (nodeId: string, slug: string) => void;
  onAgentResponseWidgetSourceChange: (nodeId: string, source: "library" | "variable") => void;
  onAgentResponseWidgetDefinitionChange: (nodeId: string, expression: string) => void;
  onWidgetNodeSlugChange: (nodeId: string, slug: string) => void;
  onWidgetNodeSourceChange: (nodeId: string, source: "library" | "variable") => void;
  onWidgetNodeDefinitionExpressionChange: (nodeId: string, expression: string) => void;
  onWidgetNodeVariablesChange: (nodeId: string, assignments: WidgetVariableAssignment[]) => void;
  onWidgetNodeAwaitActionChange: (nodeId: string, value: boolean) => void;
  onAgentIncludeChatHistoryChange: (nodeId: string, value: boolean) => void;
  onAgentDisplayResponseInChatChange: (nodeId: string, value: boolean) => void;
  onAgentShowSearchSourcesChange: (nodeId: string, value: boolean) => void;
  onAgentContinueOnErrorChange: (nodeId: string, value: boolean) => void;
  onAgentStorePreferenceChange: (nodeId: string, value: boolean) => void;
  onAgentWebSearchChange: (nodeId: string, config: WebSearchConfig | null) => void;
  onAgentFileSearchChange: (nodeId: string, config: FileSearchConfig | null) => void;
  onAgentImageGenerationChange: (nodeId: string, config: ImageGenerationToolConfig | null) => void;
  onAgentComputerUseChange: (nodeId: string, config: ComputerUseConfig | null) => void;
  onVoiceAgentVoiceChange: (nodeId: string, value: string) => void;
  onVoiceAgentStartBehaviorChange: (nodeId: string, behavior: VoiceAgentStartBehavior) => void;
  onVoiceAgentStopBehaviorChange: (nodeId: string, behavior: VoiceAgentStopBehavior) => void;
  onVoiceAgentToolChange: (nodeId: string, tool: VoiceAgentTool, enabled: boolean) => void;
  onTranscriptionModelChange: (nodeId: string, value: string) => void;
  onTranscriptionLanguageChange: (nodeId: string, value: string) => void;
  onTranscriptionPromptChange: (nodeId: string, value: string) => void;
  onVectorStoreNodeConfigChange: (nodeId: string, updates: Partial<VectorStoreNodeConfig>) => void;
  onParametersChange: (nodeId: string, parameters: Record<string, unknown>) => void;
  onTransformExpressionsChange: (nodeId: string, expressions: Record<string, unknown>) => void;
  onStartAutoRunChange: (nodeId: string, value: boolean) => void;
  onStartAutoRunMessageChange: (nodeId: string, value: string) => void;
  onStartAutoRunAssistantMessageChange: (nodeId: string, value: string) => void;
  onStartTelephonySipAccountIdChange: (nodeId: string, value: number | null) => void;
  onStartTelephonyRingTimeoutChange: (nodeId: string, value: number) => void;
  onStartTelephonySpeakFirstChange: (nodeId: string, value: boolean) => void;
  onConditionPathChange: (nodeId: string, value: string) => void;
  onConditionModeChange: (nodeId: string, value: string) => void;
  onConditionValueChange: (nodeId: string, value: string) => void;
  onParallelJoinSlugChange: (nodeId: string, value: string) => void;
  onParallelBranchesChange: (nodeId: string, branches: ParallelBranch[]) => void;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWidgetValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowToolToggle: (nodeId: string, slug: string, enabled: boolean) => void;
  onAgentMcpServersChange: (nodeId: string, configs: McpSseToolConfig[]) => void;
  onStateAssignmentsChange: (
    nodeId: string,
    scope: StateAssignmentScope,
    assignments: StateAssignment[],
  ) => void;
  onEndMessageChange: (nodeId: string, value: string) => void;
  onAssistantMessageChange: (nodeId: string, value: string) => void;
  onAssistantMessageStreamEnabledChange: (nodeId: string, value: boolean) => void;
  onAssistantMessageStreamDelayChange: (nodeId: string, value: string) => void;
  onWaitForUserInputMessageChange: (nodeId: string, value: string) => void;
  onUserMessageChange: (nodeId: string, value: string) => void;

  // Workflow operations
  onWorkflowSelect: (workflowId: number) => void;
  onHostedWorkflowSelect: (slug: string) => void;
  onVersionSelect: (versionId: number) => void;
  onWorkflowCreate: () => void;
  onWorkflowDelete: (workflowId: number) => void;
  onHostedWorkflowDelete: (slug: string) => void;
  onWorkflowDuplicate: (workflowId: number) => void;
  onWorkflowRename: (workflowId: number, name: string) => void;
  onWorkflowExport: () => void;
  onWorkflowImport: () => void;
  onWorkflowDeploy: () => void;
  toggleLocalPin: (workflowId: number) => void;
  toggleHostedPin: (slug: string) => void;

  // UI handlers
  setCreateWorkflowName: (value: string) => void;
  setCreateWorkflowRemoteId: (value: string) => void;
  setCreateWorkflowKind: (kind: "local" | "hosted") => void;
  setDeployToProduction: (value: boolean) => void;
  closeWorkflowMenu: () => void;
  openAppearanceModal: (target: WorkflowAppearanceTarget, trigger?: HTMLButtonElement | null) => void;
  handleCloseAppearanceModal: () => void;
  setOpenWorkflowMenuId: (id: string | number | null) => void;
  setWorkflowMenuPlacement: (placement: ActionMenuPlacement) => void;
  setDeployModalOpen: (value: boolean) => void;
  setCreateModalOpen: (value: boolean) => void;
  setIsMobileActionsOpen: (value: boolean) => void;
  setBlockLibraryOpen: (value: boolean) => void;
  setPropertiesPanelOpen: (value: boolean) => void;

  // Utility functions
  isReasoningModel: (model: string) => boolean;
  handleUndo: () => void;
  handleRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

const WorkflowBuilderContext = createContext<WorkflowBuilderContextValue | null>(null);

export const useWorkflowBuilder = () => {
  const context = useContext(WorkflowBuilderContext);
  if (!context) {
    throw new Error("useWorkflowBuilder must be used within WorkflowBuilderProvider");
  }
  return context;
};

export default WorkflowBuilderContext;
