import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "../../../../auth";
import {
  type AvailableModel,
  type HostedWorkflowMetadata,
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
  getStartTelephonySipAccountId,
  getStartTelephonyRingTimeout,
  getStartTelephonySpeakFirst,
  getStateAssignments,
  getUserMessage,
  getVectorStoreNodeConfig,
  getWaitForUserInputMessage,
  getParallelSplitJoinSlug,
  getParallelSplitBranches,
} from "../../../../utils/workflows";
import type {
  FlowNode,
  StateAssignment,
  StateAssignmentScope,
  VectorStoreNodeConfig,
  VoiceAgentTool,
  VoiceAgentStartBehavior,
  VoiceAgentStopBehavior,
  WorkflowSummary,
  ParallelBranch,
} from "../../types";
import { labelForKind } from "../../utils";
import type { WorkflowNodeHandlers } from "../../hooks/useWorkflowNodeHandlers";
import { TrashIcon } from "./components/TrashIcon";
import styles from "./NodeInspector.module.css";
import { useTransformInspectorState } from "./hooks/useTransformInspectorState";
import { AgentInspectorSectionV2 as AgentInspectorSection } from "./sections/AgentInspectorSectionV2";
import { AssistantMessageInspectorSection } from "./sections/AssistantMessageInspectorSection";
import { ConditionInspectorSection } from "./sections/ConditionInspectorSection";
import { EndInspectorSection } from "./sections/EndInspectorSection";
import { JsonVectorStoreInspectorSection } from "./sections/JsonVectorStoreInspectorSection";
import { VoiceAgentInspectorSection } from "./sections/VoiceAgentInspectorSection";
import { OutboundCallInspectorSection } from "./sections/OutboundCallInspectorSection";
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
  nodeHandlers: WorkflowNodeHandlers;
  workflows: WorkflowSummary[];
  currentWorkflowId: number | null;
  hostedWorkflows: HostedWorkflowMetadata[];
  hostedWorkflowsLoading: boolean;
  hostedWorkflowsError: string | null;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  isReasoningModel: (model: string) => boolean;
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  widgets: WidgetTemplateSummary[];
  widgetsLoading: boolean;
  widgetsError: string | null;
  onRemove: (nodeId: string) => void;
};

const NodeInspector = ({
  node,
  nodeHandlers,
  workflows,
  currentWorkflowId,
  hostedWorkflows,
  hostedWorkflowsLoading,
  hostedWorkflowsError,
  availableModels,
  availableModelsLoading,
  availableModelsError,
  isReasoningModel,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
  widgets,
  widgetsLoading,
  widgetsError,
  onRemove,
}: NodeInspectorProps) => {
  const {
    handleDisplayNameChange: onDisplayNameChange,
    handleAgentMessageChange: onAgentMessageChange,
    handleAgentModelChange: onAgentModelChange,
    handleAgentProviderChange: onAgentProviderChange,
    handleAgentNestedWorkflowChange: onAgentNestedWorkflowChange,
    handleAgentReasoningChange: onAgentReasoningChange,
    handleAgentReasoningSummaryChange: onAgentReasoningSummaryChange,
    handleAgentTextVerbosityChange: onAgentTextVerbosityChange,
    handleAgentTemperatureChange: onAgentTemperatureChange,
    handleAgentTopPChange: onAgentTopPChange,
    handleAgentMaxOutputTokensChange: onAgentMaxOutputTokensChange,
    handleAgentResponseFormatKindChange: onAgentResponseFormatKindChange,
    handleAgentResponseFormatNameChange: onAgentResponseFormatNameChange,
    handleAgentResponseFormatSchemaChange: onAgentResponseFormatSchemaChange,
    handleAgentResponseWidgetSlugChange: onAgentResponseWidgetSlugChange,
    handleAgentResponseWidgetSourceChange: onAgentResponseWidgetSourceChange,
    handleAgentResponseWidgetDefinitionChange: onAgentResponseWidgetDefinitionChange,
    handleWidgetNodeSlugChange: onWidgetNodeSlugChange,
    handleWidgetNodeSourceChange: onWidgetNodeSourceChange,
    handleWidgetNodeDefinitionExpressionChange: onWidgetNodeDefinitionExpressionChange,
    handleWidgetNodeVariablesChange: onWidgetNodeVariablesChange,
    handleWidgetNodeAwaitActionChange: onWidgetNodeAwaitActionChange,
    handleAgentIncludeChatHistoryChange: onAgentIncludeChatHistoryChange,
    handleAgentDisplayResponseInChatChange: onAgentDisplayResponseInChatChange,
    handleAgentShowSearchSourcesChange: onAgentShowSearchSourcesChange,
    handleAgentContinueOnErrorChange: onAgentContinueOnErrorChange,
    handleAgentStorePreferenceChange: onAgentStorePreferenceChange,
    handleAgentWebSearchChange: onAgentWebSearchChange,
    handleAgentFileSearchChange: onAgentFileSearchChange,
    handleAgentImageGenerationChange: onAgentImageGenerationChange,
    handleAgentComputerUseChange: onAgentComputerUseChange,
    handleAgentMcpServersChange: onAgentMcpServersChange,
    handleVoiceAgentVoiceChange: onVoiceAgentVoiceChange,
    handleVoiceAgentStartBehaviorChange: onVoiceAgentStartBehaviorChange,
    handleVoiceAgentStopBehaviorChange: onVoiceAgentStopBehaviorChange,
    handleVoiceAgentToolChange: onVoiceAgentToolChange,
    handleTranscriptionModelChange: onTranscriptionModelChange,
    handleTranscriptionLanguageChange: onTranscriptionLanguageChange,
    handleTranscriptionPromptChange: onTranscriptionPromptChange,
    handleVectorStoreNodeConfigChange: onVectorStoreNodeConfigChange,
    handleOutboundCallParametersChange: onParametersChange,
    handleTransformExpressionsChange: onTransformExpressionsChange,
    handleStartAutoRunChange: onStartAutoRunChange,
    handleStartAutoRunMessageChange: onStartAutoRunMessageChange,
    handleStartAutoRunAssistantMessageChange: onStartAutoRunAssistantMessageChange,
    handleStartTelephonySipAccountIdChange: onStartTelephonySipAccountIdChange,
    handleStartTelephonyRingTimeoutChange: onStartTelephonyRingTimeoutChange,
    handleStartTelephonySpeakFirstChange: onStartTelephonySpeakFirstChange,
    handleConditionPathChange: onConditionPathChange,
    handleConditionModeChange: onConditionModeChange,
    handleConditionValueChange: onConditionValueChange,
    handleParallelJoinSlugChange: onParallelJoinSlugChange,
    handleParallelBranchesChange: onParallelBranchesChange,
    handleAgentWeatherToolChange: onAgentWeatherToolChange,
    handleAgentWidgetValidationToolChange: onAgentWidgetValidationToolChange,
    handleAgentWorkflowValidationToolChange: onAgentWorkflowValidationToolChange,
    handleAgentWorkflowToolToggle: onAgentWorkflowToolToggle,
    handleStateAssignmentsChange: onStateAssignmentsChange,
    handleEndMessageChange: onEndMessageChange,
    handleAssistantMessageChange: onAssistantMessageChange,
    handleAssistantMessageStreamEnabledChange: onAssistantMessageStreamEnabledChange,
    handleAssistantMessageStreamDelayChange: onAssistantMessageStreamDelayChange,
    handleWaitForUserInputMessageChange: onWaitForUserInputMessageChange,
    handleUserMessageChange: onUserMessageChange,
  } = nodeHandlers;
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
  const startTelephonySipAccountId = kind === "start" ? getStartTelephonySipAccountId(parameters) : null;
  const startTelephonyRingTimeout = kind === "start" ? getStartTelephonyRingTimeout(parameters) : 0;
  const startTelephonySpeakFirst = kind === "start" ? getStartTelephonySpeakFirst(parameters) : false;

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

      {kind === "start" ? (
        <StartInspectorSection
          nodeId={node.id}
          startAutoRun={startAutoRun}
          startAutoRunMessage={startAutoRunMessage}
          startAutoRunAssistantMessage={startAutoRunAssistantMessage}
          startTelephonySipAccountId={startTelephonySipAccountId}
          startTelephonyRingTimeout={startTelephonyRingTimeout}
          startTelephonySpeakFirst={startTelephonySpeakFirst}
          onStartAutoRunChange={onStartAutoRunChange}
          onStartAutoRunMessageChange={onStartAutoRunMessageChange}
          onStartAutoRunAssistantMessageChange={onStartAutoRunAssistantMessageChange}
          onStartTelephonySipAccountIdChange={onStartTelephonySipAccountIdChange}
          onStartTelephonyRingTimeoutChange={onStartTelephonyRingTimeoutChange}
          onStartTelephonySpeakFirstChange={onStartTelephonySpeakFirstChange}
          workflowId={currentWorkflowId}
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
          hostedWorkflows={hostedWorkflows}
          hostedWorkflowsLoading={hostedWorkflowsLoading}
          hostedWorkflowsError={hostedWorkflowsError}
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
          onAgentMcpServersChange={onAgentMcpServersChange}
        />
      ) : null}

      {kind === "voice_agent" ? (
        <VoiceAgentInspectorSection
          nodeId={node.id}
          parameters={parameters}
          token={token}
          onAgentModelChange={onAgentModelChange}
          onAgentProviderChange={onAgentProviderChange}
          onAgentMessageChange={onAgentMessageChange}
          onVoiceAgentVoiceChange={onVoiceAgentVoiceChange}
          onVoiceAgentStartBehaviorChange={onVoiceAgentStartBehaviorChange}
          onVoiceAgentStopBehaviorChange={onVoiceAgentStopBehaviorChange}
          onVoiceAgentToolChange={onVoiceAgentToolChange}
          onTranscriptionModelChange={onTranscriptionModelChange}
          onTranscriptionLanguageChange={onTranscriptionLanguageChange}
          onTranscriptionPromptChange={onTranscriptionPromptChange}
          workflows={workflows}
          currentWorkflowId={currentWorkflowId}
          availableModels={availableModels}
          availableModelsLoading={availableModelsLoading}
          onAgentWeatherToolChange={onAgentWeatherToolChange}
          onAgentWidgetValidationToolChange={onAgentWidgetValidationToolChange}
          onAgentWorkflowValidationToolChange={onAgentWorkflowValidationToolChange}
          onAgentWorkflowToolToggle={onAgentWorkflowToolToggle}
          onAgentMcpServersChange={onAgentMcpServersChange}
        />
      ) : null}

      {kind === "outbound_call" ? (
        <OutboundCallInspectorSection
          nodeId={node.id}
          parameters={parameters}
          onParametersChange={onParametersChange}
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
