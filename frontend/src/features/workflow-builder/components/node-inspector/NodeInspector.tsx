import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "../../../../auth";
import {
  type AvailableModel,
  type TelephonySipServer,
  type VectorStoreSummary,
  type WidgetTemplateSummary,
} from "../../../../utils/backend";
import { useI18n } from "../../../../i18n";
import {
  getAssistantMessage,
  getAssistantMessageStreamDelay,
  getAssistantMessageStreamEnabled,
  getConditionMode,
  getConditionPath,
  getConditionValue,
  getEndMessage,
  getStartAutoRun,
  getStartAutoRunAssistantMessage,
  getStartAutoRunMessage,
  getStartTelephonyRoutes,
  getStartTelephonyWorkflow,
  getStartTelephonySipServerId,
  getStartTelephonyRealtimeOverrides,
  getStateAssignments,
  getUserMessage,
  getVectorStoreNodeConfig,
  getWaitForUserInputMessage,
  getParallelSplitJoinSlug,
  getParallelSplitBranches,
  type StartTelephonyRealtimeOverrides,
} from "../../../../utils/workflows";
import type {
  AgentNestedWorkflowSelection,
  ComputerUseConfig,
  FileSearchConfig,
  FlowNode,
  ImageGenerationToolConfig,
  StateAssignment,
  StateAssignmentScope,
  VectorStoreNodeConfig,
  VoiceAgentTool,
  VoiceAgentStartBehavior,
  VoiceAgentStopBehavior,
  WebSearchConfig,
  WidgetVariableAssignment,
  WorkflowSummary,
  ParallelBranch,
} from "../../types";
import { labelForKind } from "../../utils";
import { TrashIcon } from "./components/TrashIcon";
import styles from "./NodeInspector.module.css";
import { useTransformInspectorState } from "./hooks/useTransformInspectorState";
import { AgentInspectorSection } from "./sections/AgentInspectorSection";
import { AssistantMessageInspectorSection } from "./sections/AssistantMessageInspectorSection";
import { ConditionInspectorSection } from "./sections/ConditionInspectorSection";
import { EndInspectorSection } from "./sections/EndInspectorSection";
import { JsonVectorStoreInspectorSection } from "./sections/JsonVectorStoreInspectorSection";
import { VoiceAgentInspectorSection } from "./sections/VoiceAgentInspectorSection";
import { StartInspectorSection } from "./sections/StartInspectorSection";
import { StateInspectorSection } from "./sections/StateInspectorSection";
import { TransformInspectorSection } from "./sections/TransformInspectorSection";
import { UserMessageInspectorSection } from "./sections/UserMessageInspectorSection";
import { WaitForUserInputInspectorSection } from "./sections/WaitForUserInputInspectorSection";
import { WatchInspectorSection } from "./sections/WatchInspectorSection";
import { ParallelSplitInspectorSection } from "./sections/ParallelSplitInspectorSection";
import { WidgetInspectorSection } from "./sections/WidgetInspectorSection";

export type NodeInspectorProps = {
  node: FlowNode;
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
  onAgentResponseWidgetSourceChange: (
    nodeId: string,
    source: "library" | "variable",
  ) => void;
  onAgentResponseWidgetDefinitionChange: (nodeId: string, expression: string) => void;
  onWidgetNodeSlugChange: (nodeId: string, slug: string) => void;
  onWidgetNodeSourceChange: (
    nodeId: string,
    source: "library" | "variable",
  ) => void;
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
  workflows: WorkflowSummary[];
  currentWorkflowId: number | null;
  onVoiceAgentVoiceChange: (nodeId: string, value: string) => void;
  onVoiceAgentStartBehaviorChange: (
    nodeId: string,
    behavior: VoiceAgentStartBehavior,
  ) => void;
  onVoiceAgentStopBehaviorChange: (
    nodeId: string,
    behavior: VoiceAgentStopBehavior,
  ) => void;
  onVoiceAgentToolChange: (
    nodeId: string,
    tool: VoiceAgentTool,
    enabled: boolean,
  ) => void;
  onVectorStoreNodeConfigChange: (
    nodeId: string,
    updates: Partial<VectorStoreNodeConfig>,
  ) => void;
  onTransformExpressionsChange: (
    nodeId: string,
    expressions: Record<string, unknown>,
  ) => void;
  onStartAutoRunChange: (nodeId: string, value: boolean) => void;
  onStartAutoRunMessageChange: (nodeId: string, value: string) => void;
  onStartAutoRunAssistantMessageChange: (nodeId: string, value: string) => void;
  onStartTelephonyRoutesChange: (nodeId: string, routes: string[]) => void;
  onStartTelephonyWorkflowChange: (
    nodeId: string,
    reference: { id?: number | null; slug?: string | null },
  ) => void;
  onStartTelephonySipServerChange: (nodeId: string, serverId: string) => void;
  onStartTelephonyRealtimeChange: (
    nodeId: string,
    overrides: Partial<StartTelephonyRealtimeOverrides>,
  ) => void;
  telephonySipServers: TelephonySipServer[];
  telephonySipServersLoading: boolean;
  telephonySipServersError: string | null;
  onConditionPathChange: (nodeId: string, value: string) => void;
  onConditionModeChange: (nodeId: string, value: string) => void;
  onConditionValueChange: (nodeId: string, value: string) => void;
  onParallelJoinSlugChange: (nodeId: string, value: string) => void;
  onParallelBranchesChange: (nodeId: string, branches: ParallelBranch[]) => void;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  isReasoningModel: (model: string) => boolean;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWidgetValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowToolToggle: (nodeId: string, slug: string, enabled: boolean) => void;
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  widgets: WidgetTemplateSummary[];
  widgetsLoading: boolean;
  widgetsError: string | null;
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
  onRemove: (nodeId: string) => void;
};

const NodeInspector = ({
  node,
  onDisplayNameChange,
  onAgentMessageChange,
  onAgentModelChange,
  onAgentProviderChange,
  onAgentNestedWorkflowChange,
  onAgentReasoningChange,
  onAgentReasoningSummaryChange,
  onAgentTextVerbosityChange,
  onAgentTemperatureChange,
  onAgentTopPChange,
  onAgentMaxOutputTokensChange,
  onAgentResponseFormatKindChange,
  onAgentResponseFormatNameChange,
  onAgentResponseFormatSchemaChange,
  onAgentResponseWidgetSlugChange,
  onAgentResponseWidgetSourceChange,
  onAgentResponseWidgetDefinitionChange,
  onWidgetNodeSlugChange,
  onWidgetNodeSourceChange,
  onWidgetNodeDefinitionExpressionChange,
  onWidgetNodeVariablesChange,
  onWidgetNodeAwaitActionChange,
  onAgentIncludeChatHistoryChange,
  onAgentDisplayResponseInChatChange,
  onAgentShowSearchSourcesChange,
  onAgentContinueOnErrorChange,
  onAgentStorePreferenceChange,
  onAgentWebSearchChange,
  onAgentFileSearchChange,
  onAgentImageGenerationChange,
  onAgentComputerUseChange,
  workflows,
  currentWorkflowId,
  onVoiceAgentVoiceChange,
  onVoiceAgentStartBehaviorChange,
  onVoiceAgentStopBehaviorChange,
  onVoiceAgentToolChange,
  onVectorStoreNodeConfigChange,
  onTransformExpressionsChange,
  onStartAutoRunChange,
  onStartAutoRunMessageChange,
  onStartAutoRunAssistantMessageChange,
  onStartTelephonyRoutesChange,
  onStartTelephonyWorkflowChange,
  onStartTelephonySipServerChange,
  onStartTelephonyRealtimeChange,
  telephonySipServers,
  telephonySipServersLoading,
  telephonySipServersError,
  onConditionPathChange,
  onConditionModeChange,
  onConditionValueChange,
  onParallelJoinSlugChange,
  onParallelBranchesChange,
  availableModels,
  availableModelsLoading,
  availableModelsError,
  isReasoningModel,
  onAgentWeatherToolChange,
  onAgentWidgetValidationToolChange,
  onAgentWorkflowValidationToolChange,
  onAgentWorkflowToolToggle,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
  widgets,
  widgetsLoading,
  widgetsError,
  onStateAssignmentsChange,
  onEndMessageChange,
  onAssistantMessageChange,
  onAssistantMessageStreamEnabledChange,
  onAssistantMessageStreamDelayChange,
  onWaitForUserInputMessageChange,
  onUserMessageChange,
  onRemove,
}: NodeInspectorProps) => {
  const { token } = useAuth();
  const { t } = useI18n();
  const { kind, displayName, parameters } = node.data;
  const isFixed = kind === "start";

  const endMessage = kind === "end" ? getEndMessage(parameters) : "";
  const assistantMessage = kind === "assistant_message" ? getAssistantMessage(parameters) : "";
  const assistantMessageStreamEnabled =
    kind === "assistant_message" ? getAssistantMessageStreamEnabled(parameters) : false;
  const assistantMessageStreamDelay =
    kind === "assistant_message" ? getAssistantMessageStreamDelay(parameters) : 30;
  const userMessage = kind === "user_message" ? getUserMessage(parameters) : "";
  const waitForUserInputMessage =
    kind === "wait_for_user_input" ? getWaitForUserInputMessage(parameters) : "";

  const parallelJoinSlug =
    kind === "parallel_split" ? getParallelSplitJoinSlug(parameters) : "";
  const parallelBranches = useMemo<ParallelBranch[]>(
    () => (kind === "parallel_split" ? getParallelSplitBranches(parameters) : []),
    [kind, parameters],
  );

  const [userMessageDraft, setUserMessageDraft] = useState(userMessage);

  useEffect(() => {
    if (kind === "user_message") {
      setUserMessageDraft(userMessage);
    }
  }, [kind, node.id, userMessage]);

  const startAutoRun = kind === "start" ? getStartAutoRun(parameters) : false;
  const startAutoRunMessage = kind === "start" ? getStartAutoRunMessage(parameters) : "";
  const startAutoRunAssistantMessage =
    kind === "start" ? getStartAutoRunAssistantMessage(parameters) : "";

  const startTelephonyRoutes = kind === "start" ? getStartTelephonyRoutes(parameters) : [];
  const startTelephonyWorkflow =
    kind === "start"
      ? getStartTelephonyWorkflow(parameters)
      : { id: null, slug: "" };
  const startTelephonySipServerId =
    kind === "start" ? getStartTelephonySipServerId(parameters) : "";
  const startTelephonyRealtime: StartTelephonyRealtimeOverrides =
    kind === "start"
      ? getStartTelephonyRealtimeOverrides(parameters)
      : { model: "", voice: "", start_mode: null, stop_mode: null };

  const conditionPath = kind === "condition" ? getConditionPath(parameters) : "";
  const conditionMode = kind === "condition" ? getConditionMode(parameters) : "truthy";
  const conditionValue = kind === "condition" ? getConditionValue(parameters) : "";

  const vectorStoreNodeConfig = useMemo(() => getVectorStoreNodeConfig(parameters), [parameters]);
  const vectorStoreNodeSlug = vectorStoreNodeConfig.vector_store_slug.trim();
  const vectorStoreNodeDocIdExpression = vectorStoreNodeConfig.doc_id_expression.trim();
  const vectorStoreNodeDocumentExpression = vectorStoreNodeConfig.document_expression.trim();
  const vectorStoreNodeMetadataExpression = vectorStoreNodeConfig.metadata_expression.trim();
  const vectorStoreNodeBlueprintExpression =
    vectorStoreNodeConfig.workflow_blueprint_expression.trim();

  const vectorStoreNodeExists =
    vectorStoreNodeSlug.length > 0 && vectorStores.some((store) => store.slug === vectorStoreNodeSlug);

  const vectorStoreNodeValidationMessages: string[] = [];
  if (kind === "json_vector_store") {
    if (!vectorStoreNodeSlug) {
      vectorStoreNodeValidationMessages.push("Sélectionnez un vector store pour enregistrer la réponse.");
    } else if (!vectorStoresError && vectorStores.length > 0 && !vectorStoreNodeExists) {
      vectorStoreNodeValidationMessages.push(
        "Le vector store sélectionné n'est plus disponible. Choisissez-en un autre.",
      );
    }
  }

  const globalAssignments = useMemo(
    () => getStateAssignments(parameters, "globals"),
    [parameters],
  );
  const stateAssignments = useMemo(
    () => getStateAssignments(parameters, "state"),
    [parameters],
  );

  const {
    transformExpressionsText,
    updateTransformDraft,
    transformExpressionsError,
    setTransformExpressionsError,
    commitTransformExpressions,
  } = useTransformInspectorState({
    nodeId: node.id,
    kind,
    parameters,
    onTransformExpressionsChange,
  });

  return (
    <section aria-label={`Propriétés du nœud ${node.data.slug}`}>
      <div className={styles.nodeInspectorHeader}>
        <div className={styles.nodeInspectorSummary}>
          <span className={styles.nodeInspectorTitle}>
            {displayName.trim() ? displayName : `Bloc ${labelForKind(kind, t)}`}
          </span>
          <span className={styles.nodeInspectorSubtitle}>Identifiant : {node.data.slug}</span>
        </div>
        {!isFixed ? (
          <button
            type="button"
            onClick={() => onRemove(node.id)}
            className={styles.nodeInspectorDeleteButton}
            aria-label={`Supprimer le bloc ${displayName.trim() ? displayName : node.data.slug}`}
            title="Supprimer ce bloc"
          >
            <TrashIcon />
          </button>
        ) : null}
      </div>

      <dl className={styles.nodeInspectorMetaGrid}>
        <dt>Identifiant</dt>
        <dd>{node.data.slug}</dd>
        <dt>Type</dt>
        <dd>{labelForKind(kind, t)}</dd>
      </dl>

      <label className={styles.nodeInspectorDisplayNameField}>
        <span>Nom affiché</span>
        <input
          type="text"
          value={displayName}
          onChange={(event) => onDisplayNameChange(node.id, event.target.value)}
        />
      </label>

      {kind === "start" ? (
        <StartInspectorSection
          nodeId={node.id}
          startAutoRun={startAutoRun}
          startAutoRunMessage={startAutoRunMessage}
          startAutoRunAssistantMessage={startAutoRunAssistantMessage}
          startTelephonyRoutes={startTelephonyRoutes}
          startTelephonyWorkflow={startTelephonyWorkflow}
          startTelephonySipServerId={startTelephonySipServerId}
          startTelephonyRealtime={startTelephonyRealtime}
          onStartAutoRunChange={onStartAutoRunChange}
          onStartAutoRunMessageChange={onStartAutoRunMessageChange}
          onStartAutoRunAssistantMessageChange={onStartAutoRunAssistantMessageChange}
          onStartTelephonyRoutesChange={onStartTelephonyRoutesChange}
          onStartTelephonyWorkflowChange={onStartTelephonyWorkflowChange}
          onStartTelephonySipServerChange={onStartTelephonySipServerChange}
          onStartTelephonyRealtimeChange={onStartTelephonyRealtimeChange}
          sipServers={telephonySipServers}
          sipServersLoading={telephonySipServersLoading}
          sipServersError={telephonySipServersError}
        />
      ) : null}

      {kind === "condition" ? (
        <ConditionInspectorSection
          nodeId={node.id}
          conditionPath={conditionPath}
          conditionMode={conditionMode}
          conditionValue={conditionValue}
          onConditionPathChange={onConditionPathChange}
          onConditionModeChange={onConditionModeChange}
          onConditionValueChange={onConditionValueChange}
        />
      ) : null}

      {kind === "parallel_split" ? (
        <ParallelSplitInspectorSection
          nodeId={node.id}
          joinSlug={parallelJoinSlug}
          branches={parallelBranches}
          onJoinSlugChange={onParallelJoinSlugChange}
          onBranchesChange={onParallelBranchesChange}
        />
      ) : null}

      {kind === "widget" ? (
        <WidgetInspectorSection
          nodeId={node.id}
          parameters={parameters}
          token={token}
          widgets={widgets}
          widgetsLoading={widgetsLoading}
          widgetsError={widgetsError}
          onWidgetNodeSlugChange={onWidgetNodeSlugChange}
          onWidgetNodeSourceChange={onWidgetNodeSourceChange}
          onWidgetNodeDefinitionExpressionChange={onWidgetNodeDefinitionExpressionChange}
          onWidgetNodeVariablesChange={onWidgetNodeVariablesChange}
          onWidgetNodeAwaitActionChange={onWidgetNodeAwaitActionChange}
        />
      ) : null}

      {kind === "assistant_message" ? (
        <AssistantMessageInspectorSection
          nodeId={node.id}
          assistantMessage={assistantMessage}
          assistantMessageStreamEnabled={assistantMessageStreamEnabled}
          assistantMessageStreamDelay={assistantMessageStreamDelay}
          onAssistantMessageChange={onAssistantMessageChange}
          onAssistantMessageStreamEnabledChange={onAssistantMessageStreamEnabledChange}
          onAssistantMessageStreamDelayChange={onAssistantMessageStreamDelayChange}
        />
      ) : null}

      {kind === "wait_for_user_input" ? (
        <WaitForUserInputInspectorSection
          nodeId={node.id}
          waitForUserInputMessage={waitForUserInputMessage}
          onWaitForUserInputMessageChange={onWaitForUserInputMessageChange}
        />
      ) : null}

      {kind === "user_message" ? (
        <UserMessageInspectorSection
          nodeId={node.id}
          userMessageDraft={userMessageDraft}
          onUserMessageDraftChange={(nodeId, value) => {
            setUserMessageDraft(value);
            onUserMessageChange(nodeId, value);
          }}
        />
      ) : null}

      {kind === "end" ? (
        <EndInspectorSection
          nodeId={node.id}
          endMessage={endMessage}
          onEndMessageChange={onEndMessageChange}
        />
      ) : null}

      {kind === "agent" ? (
          <AgentInspectorSection
            nodeId={node.id}
            parameters={parameters}
            token={token}
            workflows={workflows}
            currentWorkflowId={currentWorkflowId}
            availableModels={availableModels}
            availableModelsLoading={availableModelsLoading}
            availableModelsError={availableModelsError}
            isReasoningModel={isReasoningModel}
            widgets={widgets}
          widgetsLoading={widgetsLoading}
          widgetsError={widgetsError}
          vectorStores={vectorStores}
          vectorStoresLoading={vectorStoresLoading}
          vectorStoresError={vectorStoresError}
            onAgentMessageChange={onAgentMessageChange}
            onAgentModelChange={onAgentModelChange}
            onAgentProviderChange={onAgentProviderChange}
            onAgentNestedWorkflowChange={onAgentNestedWorkflowChange}
          onAgentReasoningChange={onAgentReasoningChange}
          onAgentReasoningSummaryChange={onAgentReasoningSummaryChange}
          onAgentTextVerbosityChange={onAgentTextVerbosityChange}
          onAgentTemperatureChange={onAgentTemperatureChange}
          onAgentTopPChange={onAgentTopPChange}
          onAgentMaxOutputTokensChange={onAgentMaxOutputTokensChange}
          onAgentIncludeChatHistoryChange={onAgentIncludeChatHistoryChange}
          onAgentDisplayResponseInChatChange={onAgentDisplayResponseInChatChange}
          onAgentShowSearchSourcesChange={onAgentShowSearchSourcesChange}
          onAgentContinueOnErrorChange={onAgentContinueOnErrorChange}
          onAgentStorePreferenceChange={onAgentStorePreferenceChange}
          onAgentResponseFormatKindChange={onAgentResponseFormatKindChange}
          onAgentResponseFormatNameChange={onAgentResponseFormatNameChange}
          onAgentResponseFormatSchemaChange={onAgentResponseFormatSchemaChange}
          onAgentResponseWidgetSlugChange={onAgentResponseWidgetSlugChange}
          onAgentResponseWidgetSourceChange={onAgentResponseWidgetSourceChange}
          onAgentResponseWidgetDefinitionChange={onAgentResponseWidgetDefinitionChange}
          onAgentWebSearchChange={onAgentWebSearchChange}
          onAgentFileSearchChange={onAgentFileSearchChange}
          onAgentImageGenerationChange={onAgentImageGenerationChange}
          onAgentComputerUseChange={onAgentComputerUseChange}
          onAgentWeatherToolChange={onAgentWeatherToolChange}
          onAgentWidgetValidationToolChange={onAgentWidgetValidationToolChange}
          onAgentWorkflowValidationToolChange={onAgentWorkflowValidationToolChange}
          onAgentWorkflowToolToggle={onAgentWorkflowToolToggle}
        />
      ) : null}

      {kind === "voice_agent" ? (
        <VoiceAgentInspectorSection
          nodeId={node.id}
          parameters={parameters}
          onAgentModelChange={onAgentModelChange}
          onAgentProviderChange={onAgentProviderChange}
          onAgentMessageChange={onAgentMessageChange}
          onVoiceAgentVoiceChange={onVoiceAgentVoiceChange}
          onVoiceAgentStartBehaviorChange={onVoiceAgentStartBehaviorChange}
          onVoiceAgentStopBehaviorChange={onVoiceAgentStopBehaviorChange}
          onVoiceAgentToolChange={onVoiceAgentToolChange}
          workflows={workflows}
          currentWorkflowId={currentWorkflowId}
          availableModels={availableModels}
          availableModelsLoading={availableModelsLoading}
          onAgentWeatherToolChange={onAgentWeatherToolChange}
          onAgentWidgetValidationToolChange={onAgentWidgetValidationToolChange}
          onAgentWorkflowValidationToolChange={onAgentWorkflowValidationToolChange}
          onAgentWorkflowToolToggle={onAgentWorkflowToolToggle}
        />
      ) : null}

      {kind === "json_vector_store" ? (
        <JsonVectorStoreInspectorSection
          nodeId={node.id}
          vectorStores={vectorStores}
          vectorStoresLoading={vectorStoresLoading}
          vectorStoresError={vectorStoresError}
          vectorStoreNodeSlug={vectorStoreNodeSlug}
          vectorStoreNodeDocIdExpression={vectorStoreNodeDocIdExpression}
          vectorStoreNodeDocumentExpression={vectorStoreNodeDocumentExpression}
          vectorStoreNodeMetadataExpression={vectorStoreNodeMetadataExpression}
          vectorStoreNodeBlueprintExpression={vectorStoreNodeBlueprintExpression}
          vectorStoreNodeValidationMessages={vectorStoreNodeValidationMessages}
          onVectorStoreNodeConfigChange={onVectorStoreNodeConfigChange}
        />
      ) : null}

      {kind === "state" ? (
        <StateInspectorSection
          nodeId={node.id}
          globalAssignments={globalAssignments}
          stateAssignments={stateAssignments}
          onStateAssignmentsChange={onStateAssignmentsChange}
        />
      ) : null}

      {kind === "transform" ? (
        <TransformInspectorSection
          transformExpressionsText={transformExpressionsText}
          transformExpressionsError={transformExpressionsError}
          onDraftChange={(value) => updateTransformDraft(value)}
          onCommit={commitTransformExpressions}
          onResetError={() => setTransformExpressionsError(null)}
        />
      ) : null}

      {kind === "watch" ? <WatchInspectorSection /> : null}
    </section>
  );
};

export default NodeInspector;
