/**
 * AgentInspectorSectionV2 - Refactored Agent Inspector with Progressive Disclosure
 *
 * This component keeps parity with the original inspector while introducing a
 * tabbed layout, collapsible tool panels and reusable form components with i18n
 * support.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  Settings,
  Cpu,
  Wrench,
  Sliders,
  Globe,
  FileSearch,
  Monitor,
  Image as ImageIcon,
  Maximize2,
} from 'lucide-react';

import {
  startMcpOAuthNegotiation,
  pollMcpOAuthSession,
  cancelMcpOAuthSession,
  type McpOAuthStartResponse,
  type McpOAuthSessionStatus,
} from '../../../../../utils/backend';
import { collectWidgetBindings } from '../../../../../utils/widgetPreview';
import { useI18n } from '../../../../../i18n';
import {
  TabSection,
  AccordionSection,
  Field,
  InlineHelp,
} from '../ui-components';
import { HelpTooltip } from '../components/HelpTooltip';
import { ToggleRow } from '../components/ToggleRow';
import { SchemaBuilder, type SchemaProperty } from '../components/SchemaBuilder';
import { jsonToVisualSchema, visualToJsonSchema } from '../utils/schemaUtils';
import { useAgentInspectorState } from '../hooks/useAgentInspectorState';
import type {
  AgentNestedWorkflowSelection,
  ComputerUseConfig,
  FileSearchConfig,
  FlowNode,
  ImageGenerationToolConfig,
  WebSearchConfig,
  WorkflowSummary,
  McpSseToolConfig,
} from '../../../types';
import type {
  AvailableModel,
  HostedWorkflowMetadata,
  VectorStoreSummary,
  WidgetTemplateSummary,
} from '../../../../../utils/backend';
import {
  reasoningEffortOptions,
  reasoningSummaryOptions,
  textVerbosityOptions,
  DEFAULT_WEB_SEARCH_CONFIG,
  WEB_SEARCH_LOCATION_LABELS,
  DEFAULT_COMPUTER_USE_CONFIG,
  COMPUTER_USE_ENVIRONMENTS,
  IMAGE_TOOL_MODELS,
  IMAGE_TOOL_SIZES,
  IMAGE_TOOL_QUALITIES,
  IMAGE_TOOL_BACKGROUNDS,
  IMAGE_TOOL_OUTPUT_FORMATS,
  DEFAULT_IMAGE_TOOL_CONFIG,
  DEFAULT_JSON_SCHEMA_TEXT,
} from '../constants';
import {
  buildComputerUseConfig,
  type ComputerUseFieldUpdates,
} from '../utils/computerUse';
import type { ModelSelectionMode, UserModelOption } from '../../../../../utils/workflows';
import { ToolSettingsPanel } from './ToolSettingsPanel';
import { AgentPromptModal } from '../components/AgentPromptModal';
import { JsonSchemaModal } from '../components/JsonSchemaModal';
import styles from './AgentInspectorSectionV2.module.css';

 // Filtered environments for agent blocks (only browser, ssh, vnc)
 const AGENT_COMPUTER_USE_ENVIRONMENTS = ["browser", "ssh", "vnc"] as const;

const DEFAULT_TAB = 'basic';

type SchemaContainer = {
  path: 'schema' | 'json_schema';
  wrapper: Record<string, unknown>;
  schema: Record<string, unknown>;
  name?: string;
  strict?: boolean;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const extractSchemaContainer = (value: unknown): SchemaContainer | null => {
  if (!isPlainObject(value)) return null;

  if (isPlainObject(value.json_schema) && isPlainObject(value.json_schema.schema)) {
    const jsonSchema = value.json_schema as Record<string, unknown>;
    return {
      path: 'json_schema',
      wrapper: value,
      schema: jsonSchema.schema as Record<string, unknown>,
      name: typeof jsonSchema.name === 'string' ? jsonSchema.name : undefined,
      strict: typeof jsonSchema.strict === 'boolean' ? jsonSchema.strict : undefined,
    };
  }

  if (isPlainObject(value.schema)) {
    return {
      path: 'schema',
      wrapper: value,
      schema: value.schema as Record<string, unknown>,
      name: typeof value.name === 'string' ? value.name : undefined,
      strict: typeof value.strict === 'boolean' ? value.strict : undefined,
    };
  }

  return null;
};

const applySchemaToContainer = (
  container: SchemaContainer,
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  if (container.path === 'json_schema') {
    const original = container.wrapper.json_schema as Record<string, unknown>;
    return {
      ...container.wrapper,
      json_schema: {
        ...original,
        schema,
      },
    };
  }

  return {
    ...container.wrapper,
    schema,
  };
};

type AgentInspectorStateSnapshot = ReturnType<typeof useAgentInspectorState>;
type AgentResponseFormat = AgentInspectorStateSnapshot['responseFormat'];

type AgentInspectorSectionV2Props = {
  nodeId: string;
  parameters: FlowNode['data']['parameters'];
  token: string | null;
  workflows: WorkflowSummary[];
  currentWorkflowId: number | null;
  hostedWorkflows: HostedWorkflowMetadata[];
  hostedWorkflowsLoading: boolean;
  hostedWorkflowsError: string | null;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  isReasoningModel: (model: string) => boolean;
  widgets: WidgetTemplateSummary[];
  widgetsLoading: boolean;
  widgetsError: string | null;
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
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
  onAgentIncludeChatHistoryChange: (nodeId: string, value: boolean) => void;
  onAgentDisplayResponseInChatChange: (nodeId: string, value: boolean) => void;
  onAgentShowSearchSourcesChange: (nodeId: string, value: boolean) => void;
  onAgentContinueOnErrorChange: (nodeId: string, value: boolean) => void;
  onAgentStorePreferenceChange: (nodeId: string, value: boolean) => void;
  onAgentResponseFormatKindChange: (
    nodeId: string,
    kind: 'text' | 'json_schema' | 'widget',
  ) => void;
  onAgentResponseFormatNameChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatSchemaChange: (nodeId: string, schema: unknown) => void;
  onAgentResponseWidgetSlugChange: (nodeId: string, slug: string) => void;
  onAgentResponseWidgetSourceChange: (
    nodeId: string,
    source: 'library' | 'variable',
  ) => void;
  onAgentResponseWidgetDefinitionChange: (
    nodeId: string,
    expression: string,
  ) => void;
  onAgentWebSearchChange: (
    nodeId: string,
    config: WebSearchConfig | null,
  ) => void;
  onAgentFileSearchChange: (
    nodeId: string,
    config: FileSearchConfig | null,
  ) => void;
  onAgentImageGenerationChange: (
    nodeId: string,
    config: ImageGenerationToolConfig | null,
  ) => void;
  onAgentComputerUseChange: (
    nodeId: string,
    config: ComputerUseConfig | null,
  ) => void;
  onAgentMcpServersChange?: (
    nodeId: string,
    configs: McpSseToolConfig[],
  ) => void;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWidgetValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowValidationToolChange: (
    nodeId: string,
    enabled: boolean,
  ) => void;
  onAgentWorkflowToolToggle: (
    nodeId: string,
    slug: string,
    enabled: boolean,
  ) => void;
  onAgentModelSelectionModeChange: (nodeId: string, mode: ModelSelectionMode) => void;
  onAgentUserModelOptionsChange: (nodeId: string, options: UserModelOption[]) => void;
};
export const AgentInspectorSectionV2: React.FC<AgentInspectorSectionV2Props> = ({
  nodeId,
  parameters,
  token,
  workflows,
  currentWorkflowId,
  hostedWorkflows,
  hostedWorkflowsLoading,
  hostedWorkflowsError,
  availableModels,
  availableModelsLoading,
  availableModelsError,
  isReasoningModel,
  widgets,
  widgetsLoading,
  widgetsError,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
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
  onAgentIncludeChatHistoryChange,
  onAgentDisplayResponseInChatChange,
  onAgentShowSearchSourcesChange,
  onAgentContinueOnErrorChange,
  onAgentStorePreferenceChange,
  onAgentResponseFormatKindChange,
  onAgentResponseFormatNameChange,
  onAgentResponseFormatSchemaChange,
  onAgentResponseWidgetSlugChange,
  onAgentResponseWidgetSourceChange,
  onAgentResponseWidgetDefinitionChange,
  onAgentWebSearchChange,
  onAgentFileSearchChange,
  onAgentImageGenerationChange,
  onAgentComputerUseChange,
  onAgentMcpServersChange,
  onAgentWeatherToolChange,
  onAgentWidgetValidationToolChange,
  onAgentWorkflowValidationToolChange,
  onAgentWorkflowToolToggle,
  onAgentModelSelectionModeChange,
  onAgentUserModelOptionsChange,
}) => {
  const { t } = useI18n();

  const {
    agentMessage,
    agentModel,
    agentProviderId,
    agentProviderSlug,
    modelSelectionMode,
    userModelOptions,
    nestedWorkflowId,
    nestedWorkflowSlug,
    nestedWorkflowMode,
    reasoningEffort,
    reasoningSummaryValue,
    textVerbosityValue,
    responseFormat,
    temperatureValue,
    topPValue,
    maxOutputTokensValue,
    includeChatHistory,
    displayResponseInChat,
    showSearchSources,
    continueOnError,
    storeResponses,
    webSearchConfig,
    webSearchEnabled,
    fileSearchConfig,
    fileSearchEnabled,
    fileSearchValidationMessage: fileSearchValidationMessageFromHook,
    fileSearchValidationReason,
    computerUseConfig,
    computerUseEnabled,
    computerUseDisplayWidthValue,
    computerUseDisplayHeightValue,
    computerUseEnvironmentValue,
    computerUseStartUrlValue,
    imageGenerationConfig,
    imageGenerationEnabled,
    imageModelValue,
    imageSizeValue,
    imageQualityValue,
    imageBackgroundValue,
    imageOutputFormatValue,
    updateImageTool,
    workflowToolSlugs,
    selectedVectorStoreSlug,
    matchedModel,
    selectedModelOption,
    selectedProviderValue,
    providerOptions,
    modelsForProvider,
    supportsReasoning,
    schemaText,
    setSchemaText,
    schemaError,
    setSchemaError,
    responseWidgetSource,
    responseWidgetSlug,
    trimmedWidgetSlug,
    responseWidgetDefinitionExpression,
    widgetSelectValue,
    widgetValidationMessage: widgetValidationMessageFromHook,
    widgetValidationReason,
    responseWidgetDefinition,
    responseWidgetDefinitionLoading,
    responseWidgetDefinitionError,
  } = useAgentInspectorState({
    nodeId,
    parameters,
    token,
    widgets,
    widgetsLoading,
    widgetsError,
    vectorStores,
    vectorStoresLoading,
    vectorStoresError,
    workflows,
    currentWorkflowId,
    availableModels,
    isReasoningModel,
    onAgentImageGenerationChange,
  });

  const handleStartMcpOAuth = useCallback(
    (payload: { url: string; clientId: string | null; scope: string | null }) =>
      startMcpOAuthNegotiation({
        token: token ?? null,
        url: payload.url,
        clientId: payload.clientId,
        scope: payload.scope,
      }),
    [token],
  );

  const handlePollMcpOAuth = useCallback(
    (state: string) => pollMcpOAuthSession({ token: token ?? null, state }),
    [token],
  );

  const handleCancelMcpOAuth = useCallback(
    (state: string) => cancelMcpOAuthSession({ token: token ?? null, state }),
    [token],
  );
  const tabs = useMemo(
    () => [
      {
        id: 'basic',
        label: t('workflowBuilder.agentInspector.tab.basic'),
        icon: Settings,
        content: (
          <BasicSettingsTab
            nodeId={nodeId}
            agentMessage={agentMessage}
            nestedWorkflowId={nestedWorkflowId}
            nestedWorkflowMode={nestedWorkflowMode}
            nestedWorkflowSlug={nestedWorkflowSlug}
            workflows={workflows}
            currentWorkflowId={currentWorkflowId}
            hostedWorkflows={hostedWorkflows}
            hostedWorkflowsLoading={hostedWorkflowsLoading}
            hostedWorkflowsError={hostedWorkflowsError}
            onAgentMessageChange={onAgentMessageChange}
            onAgentNestedWorkflowChange={onAgentNestedWorkflowChange}
            t={t}
          />
        ),
      },
      {
        id: 'model',
        label: t('workflowBuilder.agentInspector.tab.model'),
        icon: Cpu,
        content: (
          <ModelSettingsTab
            nodeId={nodeId}
            agentModel={agentModel}
            agentProviderId={agentProviderId}
            agentProviderSlug={agentProviderSlug}
            modelSelectionMode={modelSelectionMode}
            userModelOptions={userModelOptions}
            selectedProviderValue={selectedProviderValue}
            selectedModelOption={selectedModelOption}
            providerOptions={providerOptions}
            modelsForProvider={modelsForProvider}
            matchedModel={matchedModel}
            availableModels={availableModels}
            availableModelsLoading={availableModelsLoading}
            availableModelsError={availableModelsError}
            supportsReasoning={supportsReasoning}
            reasoningEffort={reasoningEffort}
            reasoningSummaryValue={reasoningSummaryValue}
            textVerbosityValue={textVerbosityValue}
            temperatureValue={temperatureValue}
            topPValue={topPValue}
            maxOutputTokensValue={maxOutputTokensValue}
            onAgentProviderChange={onAgentProviderChange}
            onAgentModelChange={onAgentModelChange}
            onAgentReasoningChange={onAgentReasoningChange}
            onAgentReasoningSummaryChange={onAgentReasoningSummaryChange}
            onAgentTextVerbosityChange={onAgentTextVerbosityChange}
            onAgentTemperatureChange={onAgentTemperatureChange}
            onAgentTopPChange={onAgentTopPChange}
            onAgentMaxOutputTokensChange={onAgentMaxOutputTokensChange}
            onAgentModelSelectionModeChange={onAgentModelSelectionModeChange}
            onAgentUserModelOptionsChange={onAgentUserModelOptionsChange}
            t={t}
          />
        ),
      },
      {
        id: 'tools',
        label: t('workflowBuilder.agentInspector.tab.tools'),
        icon: Wrench,
        content: (
          <ToolsTab
            nodeId={nodeId}
            webSearchEnabled={webSearchEnabled}
            webSearchConfig={webSearchConfig}
            fileSearchEnabled={fileSearchEnabled}
            fileSearchConfig={fileSearchConfig}
            fileSearchValidationMessageFromHook={fileSearchValidationMessageFromHook}
            fileSearchValidationReason={fileSearchValidationReason}
            vectorStores={vectorStores}
            vectorStoresLoading={vectorStoresLoading}
            vectorStoresError={vectorStoresError}
            selectedVectorStoreSlug={selectedVectorStoreSlug}
            computerUseEnabled={computerUseEnabled}
            computerUseConfig={computerUseConfig}
            computerUseDisplayWidthValue={computerUseDisplayWidthValue}
            computerUseDisplayHeightValue={computerUseDisplayHeightValue}
            computerUseEnvironmentValue={computerUseEnvironmentValue}
            computerUseStartUrlValue={computerUseStartUrlValue}
            imageGenerationEnabled={imageGenerationEnabled}
            imageGenerationConfig={imageGenerationConfig}
            imageModelValue={imageModelValue}
            imageSizeValue={imageSizeValue}
            imageQualityValue={imageQualityValue}
            imageBackgroundValue={imageBackgroundValue}
            imageOutputFormatValue={imageOutputFormatValue}
            updateImageTool={updateImageTool}
            onAgentWebSearchChange={onAgentWebSearchChange}
            onAgentFileSearchChange={onAgentFileSearchChange}
            onAgentComputerUseChange={onAgentComputerUseChange}
            onAgentImageGenerationChange={onAgentImageGenerationChange}
            onAgentWeatherToolChange={onAgentWeatherToolChange}
            onAgentWidgetValidationToolChange={onAgentWidgetValidationToolChange}
            onAgentWorkflowValidationToolChange={onAgentWorkflowValidationToolChange}
            onAgentWorkflowToolToggle={onAgentWorkflowToolToggle}
            onAgentMcpServersChange={onAgentMcpServersChange}
            onStartMcpOAuth={handleStartMcpOAuth}
            onPollMcpOAuth={handlePollMcpOAuth}
            onCancelMcpOAuth={handleCancelMcpOAuth}
            parameters={parameters}
            workflows={workflows}
            currentWorkflowId={currentWorkflowId}
            t={t}
          />
        ),
      },
      {
        id: 'advanced',
        label: t('workflowBuilder.agentInspector.tab.advanced'),
        icon: Sliders,
        content: (
          <AdvancedSettingsTab
            nodeId={nodeId}
            responseFormat={responseFormat}
            includeChatHistory={includeChatHistory}
            displayResponseInChat={displayResponseInChat}
            showSearchSources={showSearchSources}
            continueOnError={continueOnError}
            storeResponses={storeResponses}
            schemaText={schemaText}
            schemaError={schemaError}
            setSchemaText={setSchemaText}
            setSchemaError={setSchemaError}
            responseWidgetSource={responseWidgetSource}
            responseWidgetSlug={responseWidgetSlug}
            trimmedWidgetSlug={trimmedWidgetSlug}
            responseWidgetDefinitionExpression={responseWidgetDefinitionExpression}
            widgetSelectValue={widgetSelectValue}
            widgetValidationMessageFromHook={widgetValidationMessageFromHook}
            widgetValidationReason={widgetValidationReason}
            widgets={widgets}
            widgetsLoading={widgetsLoading}
            widgetsError={widgetsError}
            responseWidgetDefinition={responseWidgetDefinition}
            responseWidgetDefinitionLoading={responseWidgetDefinitionLoading}
            responseWidgetDefinitionError={responseWidgetDefinitionError}
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
            t={t}
          />
        ),
      },
    ],
    [
      agentMessage,
      agentModel,
      agentProviderId,
      agentProviderSlug,
      availableModelsError,
      availableModelsLoading,
      computerUseConfig,
      computerUseDisplayHeightValue,
      computerUseDisplayWidthValue,
      computerUseEnabled,
      computerUseEnvironmentValue,
      computerUseStartUrlValue,
      continueOnError,
      currentWorkflowId,
      displayResponseInChat,
      fileSearchConfig,
      fileSearchEnabled,
      fileSearchValidationReason,
      hostedWorkflows,
      hostedWorkflowsError,
      hostedWorkflowsLoading,
      imageBackgroundValue,
      imageGenerationConfig,
      imageGenerationEnabled,
      imageModelValue,
      imageOutputFormatValue,
      imageQualityValue,
      imageSizeValue,
      includeChatHistory,
      matchedModel,
      maxOutputTokensValue,
      nestedWorkflowId,
      nestedWorkflowMode,
      nestedWorkflowSlug,
      nodeId,
      onAgentComputerUseChange,
      onAgentFileSearchChange,
      onAgentImageGenerationChange,
      onAgentIncludeChatHistoryChange,
      onAgentNestedWorkflowChange,
      onAgentResponseFormatKindChange,
      onAgentResponseFormatNameChange,
      onAgentResponseFormatSchemaChange,
      onAgentResponseWidgetDefinitionChange,
      onAgentResponseWidgetSlugChange,
      onAgentResponseWidgetSourceChange,
      onAgentShowSearchSourcesChange,
      onAgentStorePreferenceChange,
      onAgentTemperatureChange,
      onAgentTopPChange,
      onAgentWebSearchChange,
      onAgentWorkflowToolToggle,
      onAgentWorkflowValidationToolChange,
      onAgentWidgetValidationToolChange,
      onAgentWeatherToolChange,
      onAgentMessageChange,
      onAgentModelChange,
      onAgentProviderChange,
      onAgentReasoningChange,
      onAgentReasoningSummaryChange,
      onAgentTextVerbosityChange,
      onAgentContinueOnErrorChange,
      onAgentDisplayResponseInChatChange,
      parameters,
      providerOptions,
      reasoningEffort,
      reasoningSummaryValue,
      responseFormat,
      responseWidgetDefinition,
      responseWidgetDefinitionError,
      responseWidgetDefinitionExpression,
      responseWidgetDefinitionLoading,
      responseWidgetSlug,
      responseWidgetSource,
      schemaError,
      schemaText,
      selectedModelOption,
      selectedProviderValue,
      selectedVectorStoreSlug,
      showSearchSources,
      storeResponses,
      supportsReasoning,
      t,
      temperatureValue,
      textVerbosityValue,
      topPValue,
      updateImageTool,
      vectorStores,
      vectorStoresError,
      vectorStoresLoading,
      webSearchConfig,
      webSearchEnabled,
      widgetSelectValue,
      widgetValidationMessageFromHook,
      widgetValidationReason,
      widgets,
      widgetsError,
      widgetsLoading,
      workflowToolSlugs,
      workflows,
    ],
    [
      agentMessage,
      agentModel,
      agentProviderId,
      agentProviderSlug,
      availableModelsError,
      availableModelsLoading,
      computerUseConfig,
      computerUseDisplayHeightValue,
      computerUseDisplayWidthValue,
      computerUseEnabled,
      computerUseEnvironmentValue,
      computerUseStartUrlValue,
      continueOnError,
      currentWorkflowId,
      displayResponseInChat,
      fileSearchConfig,
      fileSearchEnabled,
      fileSearchValidationReason,
      hostedWorkflows,
      hostedWorkflowsError,
      hostedWorkflowsLoading,
      imageBackgroundValue,
      imageGenerationConfig,
      imageGenerationEnabled,
      imageModelValue,
      imageOutputFormatValue,
      imageQualityValue,
      imageSizeValue,
      includeChatHistory,
      matchedModel,
      maxOutputTokensValue,
      nestedWorkflowId,
      nestedWorkflowMode,
      nestedWorkflowSlug,
      nodeId,
      onAgentComputerUseChange,
      onAgentFileSearchChange,
      onAgentImageGenerationChange,
      onAgentIncludeChatHistoryChange,
      onAgentNestedWorkflowChange,
      onAgentResponseFormatKindChange,
      onAgentResponseFormatNameChange,
      onAgentResponseFormatSchemaChange,
      onAgentResponseWidgetDefinitionChange,
      onAgentResponseWidgetSlugChange,
      onAgentResponseWidgetSourceChange,
      onAgentShowSearchSourcesChange,
      onAgentStorePreferenceChange,
      onAgentTemperatureChange,
      onAgentTopPChange,
      onAgentWebSearchChange,
      onAgentWorkflowToolToggle,
      onAgentWorkflowValidationToolChange,
      onAgentWidgetValidationToolChange,
      onAgentWeatherToolChange,
      onAgentMessageChange,
      onAgentModelChange,
      onAgentProviderChange,
      onAgentReasoningChange,
      onAgentReasoningSummaryChange,
      onAgentTextVerbosityChange,
      onAgentContinueOnErrorChange,
      onAgentDisplayResponseInChatChange,
      parameters,
      providerOptions,
      reasoningEffort,
      reasoningSummaryValue,
      responseFormat,
      responseWidgetDefinition,
      responseWidgetDefinitionError,
      responseWidgetDefinitionExpression,
      responseWidgetDefinitionLoading,
      responseWidgetSlug,
      responseWidgetSource,
      schemaError,
      schemaText,
      selectedModelOption,
      selectedProviderValue,
      selectedVectorStoreSlug,
      showSearchSources,
      storeResponses,
      supportsReasoning,
      t,
      temperatureValue,
      textVerbosityValue,
      topPValue,
      updateImageTool,
      vectorStores,
      vectorStoresError,
      vectorStoresLoading,
      webSearchConfig,
      webSearchEnabled,
      widgetSelectValue,
      widgetValidationMessageFromHook,
      widgetValidationReason,
      widgets,
      widgetsError,
      widgetsLoading,
      workflows,
      handleStartMcpOAuth,
      handlePollMcpOAuth,
      handleCancelMcpOAuth,
    ],
  );

  return (
    <TabSection
      tabs={tabs}
      defaultTab={DEFAULT_TAB}
      tabsLabel={t('workflowBuilder.agentInspector.tabsLabel')}
    />
  );
};
interface BasicSettingsTabProps {
  nodeId: string;
  agentMessage: string;
  nestedWorkflowId: number | null;
  nestedWorkflowMode: 'local' | 'hosted' | 'custom';
  nestedWorkflowSlug: string;
  workflows: WorkflowSummary[];
  currentWorkflowId: number | null;
  hostedWorkflows: HostedWorkflowMetadata[];
  hostedWorkflowsLoading: boolean;
  hostedWorkflowsError: string | null;
  onAgentMessageChange: (nodeId: string, value: string) => void;
  onAgentNestedWorkflowChange: (
    nodeId: string,
    selection: AgentNestedWorkflowSelection,
  ) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const BasicSettingsTab: React.FC<BasicSettingsTabProps> = ({
  nodeId,
  agentMessage,
  nestedWorkflowId,
  nestedWorkflowMode,
  nestedWorkflowSlug,
  workflows,
  currentWorkflowId,
  hostedWorkflows,
  hostedWorkflowsLoading,
  hostedWorkflowsError,
  onAgentMessageChange,
  onAgentNestedWorkflowChange,
  t,
}) => {
  const availableNestedWorkflows = useMemo(
    () => workflows.filter((workflow) => workflow.id !== currentWorkflowId),
    [workflows, currentWorkflowId],
  );

  const [workflowMode, setWorkflowMode] = useState<typeof nestedWorkflowMode>(
    nestedWorkflowMode,
  );
  const [localWorkflowIdValue, setLocalWorkflowIdValue] = useState(() =>
    nestedWorkflowMode === 'local' && nestedWorkflowId != null
      ? String(nestedWorkflowId)
      : '',
  );
  const [hostedWorkflowIdInput, setHostedWorkflowIdInput] = useState(() =>
    nestedWorkflowMode === 'hosted' && nestedWorkflowId != null
      ? String(nestedWorkflowId)
      : '',
  );
  const [hostedWorkflowSlugValue, setHostedWorkflowSlugValue] = useState(
    nestedWorkflowSlug,
  );
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const hostedWorkflowSelectId = useId();

  const findHostedWorkflow = useCallback(
    (value: string): HostedWorkflowMetadata | null => {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const normalized = trimmed.toLowerCase();
      return (
        hostedWorkflows.find((workflow) => {
          if (String(workflow.id) === normalized) {
            return true;
          }
          return workflow.slug.trim().toLowerCase() === normalized;
        }) ?? null
      );
    },
    [hostedWorkflows],
  );

  useEffect(() => {
    setWorkflowMode(nestedWorkflowMode);
  }, [nestedWorkflowMode]);

  useEffect(() => {
    if (nestedWorkflowMode === 'local') {
      setLocalWorkflowIdValue(
        nestedWorkflowId != null ? String(nestedWorkflowId) : '',
      );
    }
    if (nestedWorkflowMode === 'hosted') {
      const matched =
        nestedWorkflowId != null
          ? findHostedWorkflow(String(nestedWorkflowId))
          : findHostedWorkflow(nestedWorkflowSlug);
      setHostedWorkflowIdInput(
        matched?.id != null
          ? String(matched.id)
          : nestedWorkflowId != null
            ? String(nestedWorkflowId)
            : '',
      );
      setHostedWorkflowSlugValue(matched?.slug ?? nestedWorkflowSlug);
    }
    if (nestedWorkflowMode === 'custom') {
      setHostedWorkflowIdInput('');
      setHostedWorkflowSlugValue('');
    }
  }, [
    findHostedWorkflow,
    nestedWorkflowId,
    nestedWorkflowMode,
    nestedWorkflowSlug,
  ]);

  const parseWorkflowId = useCallback((value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return null;
  }, []);

  const emitNestedWorkflowChange = useCallback(
    (
      mode: 'local' | 'hosted' | 'custom',
      idValue: string,
      slugValue: string,
    ) => {
      if (mode === 'custom') {
        onAgentNestedWorkflowChange(nodeId, {
          mode: 'custom',
          workflowId: null,
          workflowSlug: '',
        });
        return;
      }

      const parsedId = parseWorkflowId(idValue);
      let slug = slugValue.trim();

      if (mode === 'local') {
        const workflow =
          parsedId != null
            ? availableNestedWorkflows.find((candidate) => candidate.id === parsedId)
            : null;
        slug = workflow?.slug ?? '';
      }

      onAgentNestedWorkflowChange(nodeId, {
        mode,
        workflowId: parsedId,
        workflowSlug: slug,
      });
    },
    [
      availableNestedWorkflows,
      nodeId,
      onAgentNestedWorkflowChange,
      parseWorkflowId,
    ],
  );

  const handleWorkflowModeChange = useCallback(
    (mode: 'local' | 'hosted' | 'custom') => {
      setWorkflowMode(mode);
      if (mode === 'custom') {
        emitNestedWorkflowChange('custom', '', '');
        return;
      }
      if (mode === 'local') {
        emitNestedWorkflowChange('local', localWorkflowIdValue, '');
        return;
      }

      const trimmedHostedId = hostedWorkflowIdInput.trim();
      const trimmedHostedSlug = hostedWorkflowSlugValue.trim();
      const matched =
        findHostedWorkflow(trimmedHostedId) ??
        findHostedWorkflow(trimmedHostedSlug) ??
        null;

      const nextIdValue =
        matched?.id != null
          ? String(matched.id)
          : trimmedHostedId || (nestedWorkflowId != null ? String(nestedWorkflowId) : '');
      const nextSlugValue = matched?.slug ?? trimmedHostedSlug ?? nestedWorkflowSlug;

      setHostedWorkflowIdInput(nextIdValue);
      setHostedWorkflowSlugValue(nextSlugValue);
      emitNestedWorkflowChange('hosted', nextIdValue, nextSlugValue);
    },
    [
      emitNestedWorkflowChange,
      findHostedWorkflow,
      hostedWorkflowIdInput,
      hostedWorkflowSlugValue,
      localWorkflowIdValue,
      nestedWorkflowId,
      nestedWorkflowSlug,
    ],
  );

  const handleLocalWorkflowChange = useCallback(
    (value: string) => {
      setLocalWorkflowIdValue(value);
      if (workflowMode === 'local') {
        emitNestedWorkflowChange('local', value, '');
      }
    },
    [emitNestedWorkflowChange, workflowMode],
  );

  const handleHostedWorkflowSelect = useCallback(
    (value: string) => {
      if (!value || value === '__loading__' || value === '__empty__') {
        return;
      }
      setHostedWorkflowIdInput(value);
      const matched = findHostedWorkflow(value);
      const slug = matched?.slug ?? value;
      setHostedWorkflowSlugValue(slug);
      if (workflowMode === 'hosted') {
        emitNestedWorkflowChange('hosted', value, slug);
      }
    },
    [emitNestedWorkflowChange, findHostedWorkflow, workflowMode],
  );

  const selectedNestedWorkflow = useMemo(() => {
    if (workflowMode !== 'local') {
      return null;
    }
    const parsed = parseWorkflowId(localWorkflowIdValue);
    if (parsed == null) {
      return null;
    }
    return availableNestedWorkflows.find((workflow) => workflow.id === parsed) ?? null;
  }, [availableNestedWorkflows, localWorkflowIdValue, parseWorkflowId, workflowMode]);

  const selectedHostedWorkflow = useMemo(() => {
    if (workflowMode !== 'hosted') {
      return null;
    }
    return (
      findHostedWorkflow(hostedWorkflowIdInput) ??
      findHostedWorkflow(hostedWorkflowSlugValue) ??
      null
    );
  }, [
    findHostedWorkflow,
    hostedWorkflowIdInput,
    hostedWorkflowSlugValue,
    workflowMode,
  ]);

  const hasNestedWorkflowSelection =
    workflowMode === 'local'
      ? Boolean(selectedNestedWorkflow)
      : workflowMode === 'hosted'
        ? Boolean(selectedHostedWorkflow)
        : false;

  const nestedWorkflowSummary = useMemo(() => {
    if (!hasNestedWorkflowSelection) {
      return null;
    }

    if (workflowMode === 'local' && selectedNestedWorkflow) {
      return t('workflowBuilder.agentInspector.nestedWorkflowSelectedInfo', {
        name: selectedNestedWorkflow.display_name?.trim() || selectedNestedWorkflow.slug,
      });
    }

    if (workflowMode === 'hosted' && selectedHostedWorkflow) {
      return t('workflowBuilder.agentInspector.nestedWorkflowSelectedInfo', {
        name: selectedHostedWorkflow.label || selectedHostedWorkflow.slug,
      });
    }

    return t('workflowBuilder.agentInspector.nestedWorkflowSelectedInfoUnknown');
  }, [
    hasNestedWorkflowSelection,
    hostedWorkflowIdInput,
    hostedWorkflowSlugValue,
    selectedHostedWorkflow,
    selectedNestedWorkflow,
    t,
    workflowMode,
  ]);

  const systemPromptExamples = useMemo(
    () => [
      {
        label: t('workflowBuilder.agentInspector.systemPrompt.examples.support.label'),
        value: t('workflowBuilder.agentInspector.systemPrompt.examples.support.value'),
      },
      {
        label: t('workflowBuilder.agentInspector.systemPrompt.examples.analytics.label'),
        value: t('workflowBuilder.agentInspector.systemPrompt.examples.analytics.value'),
      },
    ],
    [t],
  );

  return (
    <div className={styles.tabContent}>
      <div className={styles.sectionCard}>
        <Field
          label={t('workflowBuilder.agentInspector.messageLabel')}
          required
          hint={t('workflowBuilder.agentInspector.messageHint')}
        >
          <div className={styles.textareaWithAction}>
            <textarea
              value={agentMessage}
              onChange={(event) => onAgentMessageChange(nodeId, event.target.value)}
              rows={8}
              placeholder={t('workflowBuilder.agentInspector.messagePlaceholder')}
            />
            <button
              type="button"
              className={styles.expandButton}
              onClick={() => setIsPromptModalOpen(true)}
              title={t('workflowBuilder.agentInspector.promptModal.expand')}
              aria-label={t('workflowBuilder.agentInspector.promptModal.expand')}
            >
              <Maximize2 size={16} />
            </button>
          </div>
        </Field>

        <AgentPromptModal
          isOpen={isPromptModalOpen}
          onClose={() => setIsPromptModalOpen(false)}
          value={agentMessage}
          onChange={(value) => onAgentMessageChange(nodeId, value)}
        />

        <InlineHelp
          title={t('workflowBuilder.agentInspector.systemPrompt.helpTitle')}
          examples={systemPromptExamples}
        >
          {t('workflowBuilder.agentInspector.systemPrompt.helpDescription')}
          <ul className={styles.hintList}>
            <li>{t('workflowBuilder.agentInspector.systemPrompt.helpHintSpecific')}</li>
            <li>{t('workflowBuilder.agentInspector.systemPrompt.helpHintTone')}</li>
          </ul>
        </InlineHelp>
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>
            {t('workflowBuilder.agentInspector.nestedWorkflowSectionTitle')}
          </h4>
          <p className={styles.sectionDescription}>
            {t('workflowBuilder.agentInspector.nestedWorkflowHelp')}
          </p>
        </div>

        <div className={styles.radioGroup}>
          {(['custom', 'local', 'hosted'] as const).map((mode) => (
            <label
              key={mode}
              className={[
                styles.radioOption,
                workflowMode === mode ? styles.radioOptionSelected : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <input
                type="radio"
                name="nested-workflow-mode"
                value={mode}
                checked={workflowMode === mode}
                onChange={() => handleWorkflowModeChange(mode)}
              />
              <span>
                {t(
                  `workflowBuilder.agentInspector.nestedWorkflowMode.${mode}`,
                )}
              </span>
            </label>
          ))}
        </div>

        {workflowMode === 'local' ? (
          <Field
            label={t('workflowBuilder.agentInspector.nestedWorkflowLocalSelectLabel')}
            hint={t('workflowBuilder.agentInspector.nestedWorkflowLocalHint')}
          >
            <select
              value={localWorkflowIdValue}
              onChange={(event) => handleLocalWorkflowChange(event.target.value)}
            >
              <option value="">
                {t('workflowBuilder.agentInspector.nestedWorkflowNoneOption')}
              </option>
              {availableNestedWorkflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.display_name?.trim() || workflow.slug}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {workflowMode === 'hosted' ? (
          <>
            <Field
              label={t('workflowBuilder.agentInspector.nestedWorkflowHostedSelectLabel')}
              hint={t('workflowBuilder.agentInspector.nestedWorkflowHostedHint')}
            >
              <select
                id={hostedWorkflowSelectId}
                value={hostedWorkflowIdInput}
                onChange={(event) => handleHostedWorkflowSelect(event.target.value)}
                disabled={hostedWorkflowsLoading}
              >
                <option value="">
                  {hostedWorkflowsLoading
                    ? t('workflowBuilder.agentInspector.nestedWorkflowHostedLoading')
                    : t('workflowBuilder.agentInspector.nestedWorkflowNoneOption')}
                </option>
                {hostedWorkflows.map((workflow) => (
                  <option key={workflow.slug} value={workflow.slug}>
                    {workflow.label || workflow.slug}
                  </option>
                ))}
              </select>
            </Field>

            {hostedWorkflowsError ? (
              <p className={styles.errorMessage}>{hostedWorkflowsError}</p>
            ) : null}

            {hostedWorkflowsLoading && !hostedWorkflowsError ? (
              <p className={styles.mutedMessage}>
                {t('workflowBuilder.agentInspector.nestedWorkflowHostedLoading')}
              </p>
            ) : null}
          </>
        ) : null}

        {hasNestedWorkflowSelection && nestedWorkflowSummary ? (
          <p className={styles.statusMessage}>{nestedWorkflowSummary}</p>
        ) : workflowMode !== 'custom' ? (
          <p className={styles.statusMessage}>
            {t('workflowBuilder.agentInspector.nestedWorkflowMissing')}
          </p>
        ) : null}

      </div>
    </div>
  );
};
interface ModelSettingsTabProps {
  nodeId: string;
  agentModel: string;
  agentProviderId: string;
  agentProviderSlug: string;
  modelSelectionMode: ModelSelectionMode;
  userModelOptions: UserModelOption[];
  selectedProviderValue: string;
  selectedModelOption: string;
  providerOptions: Array<{ value: string; label: string; id: string | null; slug: string | null }>;
  modelsForProvider: AvailableModel[];
  matchedModel: AvailableModel | undefined;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  supportsReasoning: boolean;
  reasoningEffort: string;
  reasoningSummaryValue: string;
  textVerbosityValue: string;
  temperatureValue: string;
  topPValue: string;
  maxOutputTokensValue: string;
  onAgentProviderChange: (
    nodeId: string,
    selection: { providerId?: string | null; providerSlug?: string | null },
  ) => void;
  onAgentModelChange: (
    nodeId: string,
    selection: {
      model: string;
      providerId?: string | null;
      providerSlug?: string | null;
      store?: boolean | null;
    },
  ) => void;
  onAgentReasoningChange: (nodeId: string, value: string) => void;
  onAgentReasoningSummaryChange: (nodeId: string, value: string) => void;
  onAgentTextVerbosityChange: (nodeId: string, value: string) => void;
  onAgentTemperatureChange: (nodeId: string, value: string) => void;
  onAgentTopPChange: (nodeId: string, value: string) => void;
  onAgentMaxOutputTokensChange: (nodeId: string, value: string) => void;
  onAgentModelSelectionModeChange: (nodeId: string, mode: ModelSelectionMode) => void;
  onAgentUserModelOptionsChange: (nodeId: string, options: UserModelOption[]) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const ModelSettingsTab: React.FC<ModelSettingsTabProps> = ({
  nodeId,
  agentModel,
  agentProviderId,
  agentProviderSlug,
  modelSelectionMode,
  userModelOptions,
  selectedProviderValue,
  selectedModelOption,
  providerOptions,
  modelsForProvider,
  matchedModel,
  availableModels,
  availableModelsLoading,
  availableModelsError,
  supportsReasoning,
  reasoningEffort,
  reasoningSummaryValue,
  textVerbosityValue,
  temperatureValue,
  topPValue,
  maxOutputTokensValue,
  onAgentProviderChange,
  onAgentModelChange,
  onAgentReasoningChange,
  onAgentReasoningSummaryChange,
  onAgentTextVerbosityChange,
  onAgentTemperatureChange,
  onAgentTopPChange,
  onAgentMaxOutputTokensChange,
  onAgentModelSelectionModeChange,
  onAgentUserModelOptionsChange,
  t,
}) => {
  const handleProviderChange = useCallback(
    (value: string) => {
      if (!value) {
        onAgentProviderChange(nodeId, { providerId: null, providerSlug: null });
        return;
      }
      const option = providerOptions.find((candidate) => candidate.value === value);
      onAgentProviderChange(nodeId, {
        providerId: option?.id ?? null,
        providerSlug: option?.slug ?? null,
      });
    },
    [nodeId, onAgentProviderChange, providerOptions],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (!value) {
        onAgentModelChange(nodeId, {
          model: '',
          providerId: agentProviderId || null,
          providerSlug: agentProviderSlug || null,
          store: null,
        });
        return;
      }
      try {
        const parsed = JSON.parse(value) as {
          name: string;
          providerId: string | null;
          providerSlug: string | null;
          store: boolean | null;
        };
        onAgentModelChange(nodeId, {
          model: parsed.name,
          providerId: parsed.providerId,
          providerSlug: parsed.providerSlug,
          store: parsed.store,
        });
      } catch (error) {
        console.error('Unable to parse model selection', error);
      }
    },
    [agentProviderId, agentProviderSlug, nodeId, onAgentModelChange],
  );

  const reasoningEffortLocalized = useMemo(
    () =>
      reasoningEffortOptions.map((option) => ({
        value: option.value,
        label: t(
          `workflowBuilder.agentInspector.reasoningEffort.${option.value || 'default'}`,
        ),
      })),
    [t],
  );

  const reasoningSummaryLocalized = useMemo(
    () =>
      reasoningSummaryOptions.map((option) => ({
        value: option.value,
        label: t(`workflowBuilder.agentInspector.reasoningSummary.${option.value}`),
      })),
    [t],
  );

  const textVerbosityLocalized = useMemo(
    () =>
      textVerbosityOptions.map((option) => ({
        value: option.value,
        label: t(
          `workflowBuilder.agentInspector.textVerbosity.${option.value || 'default'}`,
        ),
      })),
    [t],
  );

  const handleModeChange = useCallback(
    (mode: ModelSelectionMode) => {
      onAgentModelSelectionModeChange(nodeId, mode);
    },
    [nodeId, onAgentModelSelectionModeChange],
  );

  const handleAddUserModelOption = useCallback(() => {
    // Construire les model_settings à partir des valeurs actuelles
    const modelSettings: UserModelOption['model_settings'] = {};

    // Température (string -> number, ignorer si vide)
    if (temperatureValue && temperatureValue !== '') {
      const tempNum = parseFloat(temperatureValue);
      if (!isNaN(tempNum)) {
        modelSettings.temperature = tempNum;
      }
    }

    // Top P (string -> number, ignorer si vide)
    if (topPValue && topPValue !== '') {
      const topPNum = parseFloat(topPValue);
      if (!isNaN(topPNum)) {
        modelSettings.top_p = topPNum;
      }
    }

    // Max output tokens (string -> number, ignorer si vide)
    if (maxOutputTokensValue && maxOutputTokensValue !== '') {
      const maxTokensNum = parseInt(maxOutputTokensValue, 10);
      if (!isNaN(maxTokensNum)) {
        modelSettings.max_output_tokens = maxTokensNum;
      }
    }

    // Reasoning (effort et summary)
    if (reasoningEffort && reasoningEffort !== '') {
      modelSettings.reasoning = { effort: reasoningEffort };
    }
    if (reasoningSummaryValue && reasoningSummaryValue !== '') {
      modelSettings.reasoning = {
        ...modelSettings.reasoning,
        summary: reasoningSummaryValue,
      };
    }

    // Text verbosity
    if (textVerbosityValue && textVerbosityValue !== '') {
      modelSettings.text_verbosity = textVerbosityValue;
    }

    const newOption: UserModelOption = {
      id: `model-${Date.now()}`,
      label: agentModel || 'Nouveau modèle',
      description: matchedModel?.description || '',
      model: agentModel,
      provider_id: agentProviderId || undefined,
      provider_slug: agentProviderSlug || undefined,
      default: userModelOptions.length === 0,
      model_settings: Object.keys(modelSettings).length > 0 ? modelSettings : undefined,
    };
    onAgentUserModelOptionsChange(nodeId, [...userModelOptions, newOption]);
  }, [nodeId, agentModel, agentProviderId, agentProviderSlug, matchedModel, userModelOptions, onAgentUserModelOptionsChange, temperatureValue, topPValue, maxOutputTokensValue, reasoningEffort, reasoningSummaryValue, textVerbosityValue]);

  const handleRemoveUserModelOption = useCallback(
    (optionId: string) => {
      const newOptions = userModelOptions.filter((opt) => opt.id !== optionId);
      // Si on supprime le défaut, mettre le premier comme défaut
      if (newOptions.length > 0 && !newOptions.some((opt) => opt.default)) {
        newOptions[0].default = true;
      }
      onAgentUserModelOptionsChange(nodeId, newOptions);
    },
    [nodeId, userModelOptions, onAgentUserModelOptionsChange],
  );

  const handleSetDefaultUserModelOption = useCallback(
    (optionId: string) => {
      const newOptions = userModelOptions.map((opt) => ({
        ...opt,
        default: opt.id === optionId,
      }));
      onAgentUserModelOptionsChange(nodeId, newOptions);
    },
    [nodeId, userModelOptions, onAgentUserModelOptionsChange],
  );

  return (
    <div className={styles.tabContent}>
      {/* Mode de sélection du modèle */}
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>
            {t('workflowBuilder.agentInspector.modelSelectionModeTitle') || 'Mode de sélection'}
          </h4>
        </div>
        <div className={styles.radioGroup}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="modelSelectionMode"
              value="specific"
              checked={modelSelectionMode === 'specific'}
              onChange={() => handleModeChange('specific')}
            />
            <span>{t('workflowBuilder.agentInspector.modelSelectionModeSpecific') || 'Modèle spécifique'}</span>
          </label>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="modelSelectionMode"
              value="user_choice"
              checked={modelSelectionMode === 'user_choice'}
              onChange={() => handleModeChange('user_choice')}
            />
            <span>{t('workflowBuilder.agentInspector.modelSelectionModeUserChoice') || 'Donner le choix à l\'utilisateur'}</span>
          </label>
        </div>
      </div>

      {/* Configuration du modèle spécifique ou liste des modèles pour l'utilisateur */}
      <div className={styles.sectionCard}>
        <Field
          label={t('workflowBuilder.agentInspector.providerLabel')}
          hint={t('workflowBuilder.agentInspector.providerHint')}
        >
          <select
            value={selectedProviderValue}
            onChange={(event) => handleProviderChange(event.target.value)}
            disabled={availableModelsLoading}
          >
            <option value="">
              {t('workflowBuilder.agentInspector.providerPlaceholder')}
            </option>
            {providerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t('workflowBuilder.agentInspector.modelLabel')}
          hint={t('workflowBuilder.agentInspector.modelHelp')}
        >
          <select
            value={selectedModelOption}
            onChange={(event) => handleModelChange(event.target.value)}
            disabled={availableModelsLoading}
          >
            <option value="">
              {t('workflowBuilder.agentInspector.modelPlaceholder')}
            </option>
            {modelsForProvider.map((model) => {
              const displayLabel = model.display_name?.trim()
                ? `${model.display_name.trim()} (${model.name})`
                : model.name;
              const reasoningSuffix = model.supports_reasoning
                ? t('workflowBuilder.agentInspector.reasoningSuffix')
                : '';
              const providerSuffix = model.provider_slug?.trim()
                ? ` – ${model.provider_slug.trim()}`
                : model.provider_id?.trim()
                  ? ` – ${model.provider_id.trim()}`
                  : '';
              return (
                <option
                  key={`${model.id}:${model.name}`}
                  value={JSON.stringify({
                    name: model.name,
                    providerId: model.provider_id ?? null,
                    providerSlug: model.provider_slug ?? null,
                    store: model.store ?? null,
                  })}
                >
                  {`${displayLabel}${reasoningSuffix}${providerSuffix}`}
                </option>
              );
            })}
          </select>
        </Field>

        {agentModel.trim() && !matchedModel && !availableModelsLoading ? (
          <p className={styles.noticeCard}>
            {t('workflowBuilder.agentInspector.unlistedModelWarning', {
              model: agentModel.trim(),
            })}
          </p>
        ) : null}

        {availableModelsLoading ? (
          <p className={styles.mutedMessage}>
            {t('workflowBuilder.agentInspector.modelsLoading')}
          </p>
        ) : availableModelsError ? (
          <p className={styles.errorMessage}>{availableModelsError}</p>
        ) : matchedModel?.description ? (
          <p className={styles.mutedMessage}>{matchedModel.description}</p>
        ) : null}

        {/* Bouton pour ajouter le modèle à la liste (mode user_choice) */}
        {modelSelectionMode === 'user_choice' && agentModel.trim() && (
          <button
            type="button"
            className={styles.addButton}
            onClick={handleAddUserModelOption}
          >
            {t('workflowBuilder.agentInspector.addModelToList') || 'Ajouter à la liste'}
          </button>
        )}
      </div>

      {/* Liste des modèles configurés pour l'utilisateur */}
      {modelSelectionMode === 'user_choice' && (
        <div className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <h4 className={styles.sectionTitle}>
              {t('workflowBuilder.agentInspector.userModelOptionsTitle') || 'Modèles disponibles pour l\'utilisateur'}
            </h4>
            <p className={styles.sectionDescription}>
              {t('workflowBuilder.agentInspector.userModelOptionsDescription') || 'Ces modèles seront disponibles dans le sélecteur du chat.'}
            </p>
          </div>
          {userModelOptions.length === 0 ? (
            <p className={styles.mutedMessage}>
              {t('workflowBuilder.agentInspector.noUserModelOptions') || 'Aucun modèle configuré. Sélectionnez un modèle ci-dessus et cliquez sur "Ajouter à la liste".'}
            </p>
          ) : (
            <div className={styles.userModelOptionsList}>
              {userModelOptions.map((option) => {
                // Construire les badges de paramètres
                const settingsBadges: string[] = [];
                if (option.model_settings?.temperature !== undefined) {
                  settingsBadges.push(`T=${option.model_settings.temperature}`);
                }
                if (option.model_settings?.top_p !== undefined) {
                  settingsBadges.push(`P=${option.model_settings.top_p}`);
                }
                if (option.model_settings?.max_output_tokens !== undefined) {
                  settingsBadges.push(`max=${option.model_settings.max_output_tokens}`);
                }
                if (option.model_settings?.reasoning?.effort) {
                  settingsBadges.push(`R=${option.model_settings.reasoning.effort}`);
                }
                if (option.model_settings?.reasoning?.summary) {
                  settingsBadges.push(`S=${option.model_settings.reasoning.summary}`);
                }
                if (option.model_settings?.text_verbosity) {
                  settingsBadges.push(`V=${option.model_settings.text_verbosity}`);
                }
                return (
                  <div key={option.id} className={styles.userModelOption}>
                    <div className={styles.userModelOptionInfo}>
                      <span className={styles.userModelOptionLabel}>{option.label}</span>
                      {option.description && (
                        <span className={styles.userModelOptionDescription}>{option.description}</span>
                      )}
                      <span className={styles.userModelOptionModel}>{option.model}</span>
                      {settingsBadges.length > 0 && (
                        <span className={styles.userModelOptionSettings}>
                          {settingsBadges.join(' | ')}
                        </span>
                      )}
                    </div>
                    <div className={styles.userModelOptionActions}>
                      <label className={styles.defaultCheckbox}>
                        <input
                          type="radio"
                          name="defaultModel"
                          checked={option.default === true}
                          onChange={() => handleSetDefaultUserModelOption(option.id)}
                        />
                        <span>{t('workflowBuilder.agentInspector.defaultModel') || 'Par défaut'}</span>
                      </label>
                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={() => handleRemoveUserModelOption(option.id)}
                        aria-label={t('workflowBuilder.agentInspector.removeModel') || 'Supprimer'}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>
            {t('workflowBuilder.agentInspector.modelParametersTitle')}
          </h4>
          <p className={styles.sectionDescription}>
            {t('workflowBuilder.agentInspector.modelParametersDescription')}
          </p>
        </div>

        {supportsReasoning ? (
          <div className={styles.inlineFields}>
            <Field label={t('workflowBuilder.agentInspector.reasoningEffortLabel')}>
              <select
                value={reasoningEffort}
                onChange={(event) =>
                  onAgentReasoningChange(nodeId, event.target.value)
                }
              >
                {reasoningEffortLocalized.map((option) => (
                  <option key={option.value || 'default'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('workflowBuilder.agentInspector.textVerbosityLabel')}>
              <select
                value={textVerbosityValue}
                onChange={(event) =>
                  onAgentTextVerbosityChange(nodeId, event.target.value)
                }
              >
                {textVerbosityLocalized.map((option) => (
                  <option key={option.value || 'default'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('workflowBuilder.agentInspector.reasoningSummaryLabel')}>
              <select
                value={reasoningSummaryValue}
                onChange={(event) =>
                  onAgentReasoningSummaryChange(nodeId, event.target.value)
                }
              >
                {reasoningSummaryLocalized.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          <div className={styles.inlineFields}>
            <Field
              label={t('workflowBuilder.agentInspector.temperatureLabel')}
              hint={t('workflowBuilder.agentInspector.temperatureHelp')}
            >
              <input
                type="number"
                min="0"
                max="2"
                step="0.01"
                value={temperatureValue}
                onChange={(event) =>
                  onAgentTemperatureChange(nodeId, event.target.value)
                }
                placeholder={t('workflowBuilder.agentInspector.temperaturePlaceholder')}
              />
            </Field>

            <Field
              label={t('workflowBuilder.agentInspector.topPLabel')}
              hint={t('workflowBuilder.agentInspector.topPHint')}
            >
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={topPValue}
                onChange={(event) => onAgentTopPChange(nodeId, event.target.value)}
                placeholder={t('workflowBuilder.agentInspector.topPPlaceholder')}
              />
            </Field>
          </div>
        )}

        <Field
          label={t('workflowBuilder.agentInspector.maxTokensLabel')}
          hint={t('workflowBuilder.agentInspector.maxTokensHint')}
        >
          <input
            type="number"
            min="1"
            step="1"
            value={maxOutputTokensValue}
            onChange={(event) =>
              onAgentMaxOutputTokensChange(nodeId, event.target.value)
            }
            placeholder={t(
              'workflowBuilder.agentInspector.maxTokensPlaceholder',
            )}
             />
            </Field>
       </div>
    </div>
  );
};
interface ToolsTabProps {
  nodeId: string;
  webSearchEnabled: boolean;
  webSearchConfig: WebSearchConfig | null;
  fileSearchEnabled: boolean;
  fileSearchConfig: FileSearchConfig | null;
  fileSearchValidationMessageFromHook: string | null;
  fileSearchValidationReason:
    | 'no_vector_stores'
    | 'missing_selection'
    | 'selection_unavailable'
    | null;
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  selectedVectorStoreSlug: string;
  computerUseEnabled: boolean;
  computerUseConfig: ComputerUseConfig | null;
  computerUseDisplayWidthValue: string;
  computerUseDisplayHeightValue: string;
  computerUseEnvironmentValue: string;
  computerUseStartUrlValue: string;
  imageGenerationEnabled: boolean;
  imageGenerationConfig: ImageGenerationToolConfig | null;
  imageModelValue: string;
  imageSizeValue: string;
  imageQualityValue: string;
  imageBackgroundValue: string;
  imageOutputFormatValue: string;
  updateImageTool: (updates: Partial<ImageGenerationToolConfig>) => void;
  onAgentWebSearchChange: (
    nodeId: string,
    config: WebSearchConfig | null,
  ) => void;
  onAgentFileSearchChange: (
    nodeId: string,
    config: FileSearchConfig | null,
  ) => void;
  onAgentComputerUseChange: (
    nodeId: string,
    config: ComputerUseConfig | null,
  ) => void;
  onAgentImageGenerationChange: (
    nodeId: string,
    config: ImageGenerationToolConfig | null,
  ) => void;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWidgetValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowValidationToolChange: (nodeId: string, enabled: boolean) => void;
  onAgentWorkflowToolToggle: (nodeId: string, slug: string, enabled: boolean) => void;
  onAgentMcpServersChange?: (
    nodeId: string,
    configs: McpSseToolConfig[],
  ) => void;
  onStartMcpOAuth: (
    payload: { url: string; clientId: string | null; scope: string | null },
  ) => Promise<McpOAuthStartResponse>;
  onPollMcpOAuth: (state: string) => Promise<McpOAuthSessionStatus>;
  onCancelMcpOAuth?: (state: string) => Promise<unknown>;
  parameters: FlowNode['data']['parameters'];
  workflows: WorkflowSummary[];
  currentWorkflowId: number | null;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const ToolsTab: React.FC<ToolsTabProps> = ({
  nodeId,
  webSearchEnabled,
  webSearchConfig,
  fileSearchEnabled,
  fileSearchConfig,
  fileSearchValidationMessageFromHook,
  fileSearchValidationReason,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
  selectedVectorStoreSlug,
  computerUseEnabled,
  computerUseConfig,
  computerUseDisplayWidthValue,
  computerUseDisplayHeightValue,
  computerUseEnvironmentValue,
  computerUseStartUrlValue,
  imageGenerationEnabled,
  imageGenerationConfig,
  imageModelValue,
  imageSizeValue,
  imageQualityValue,
  imageBackgroundValue,
  imageOutputFormatValue,
  updateImageTool,
  onAgentWebSearchChange,
  onAgentFileSearchChange,
  onAgentComputerUseChange,
  onAgentImageGenerationChange,
  onAgentWeatherToolChange,
  onAgentWidgetValidationToolChange,
  onAgentWorkflowValidationToolChange,
  onAgentWorkflowToolToggle,
  onAgentMcpServersChange,
  onStartMcpOAuth,
  onPollMcpOAuth,
  onCancelMcpOAuth,
  parameters,
  workflows,
  currentWorkflowId,
  t,
}) => {
  const handleWebSearchToggle = useCallback(
    (enabled: boolean) => {
      onAgentWebSearchChange(
        nodeId,
        enabled ? webSearchConfig ?? { ...DEFAULT_WEB_SEARCH_CONFIG } : null,
      );
    },
    [nodeId, onAgentWebSearchChange, webSearchConfig],
  );

  const handleFileSearchToggle = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        const preferredSlug =
          (fileSearchConfig?.vector_store_slug?.trim() ?? '') ||
          vectorStores[0]?.slug ||
          '';
        onAgentFileSearchChange(nodeId, {
          vector_store_slug: preferredSlug,
        });
      } else {
        onAgentFileSearchChange(nodeId, null);
      }
    },
    [
      fileSearchConfig,
      nodeId,
      onAgentFileSearchChange,
      vectorStores,
    ],
  );

  const webSearchContextOptions = useMemo(
    () => [
      { value: '', label: t('workflowBuilder.agentInspector.webSearch.context.default') },
      { value: 'low', label: t('workflowBuilder.agentInspector.webSearch.context.low') },
      { value: 'medium', label: t('workflowBuilder.agentInspector.webSearch.context.medium') },
      { value: 'high', label: t('workflowBuilder.agentInspector.webSearch.context.high') },
    ],
    [t],
  );

  const fileSearchValidationMessage = useMemo(() => {
    if (!fileSearchValidationReason) {
      return fileSearchValidationMessageFromHook;
    }
    switch (fileSearchValidationReason) {
      case 'no_vector_stores':
        return t('workflowBuilder.agentInspector.fileSearch.validation.noStores');
      case 'selection_unavailable':
        return t('workflowBuilder.agentInspector.fileSearch.validation.unavailable');
      case 'missing_selection':
      default:
        return t('workflowBuilder.agentInspector.fileSearch.validation.missing');
    }
  }, [fileSearchValidationMessageFromHook, fileSearchValidationReason, t]);

  const imageModelOptions = useMemo(
    () =>
      IMAGE_TOOL_MODELS.map((option) => ({
        value: option.value,
        label: t(`workflowBuilder.agentInspector.image.model.${option.value}`),
      })),
    [t],
  );

  const imageSizeOptions = useMemo(
    () =>
      IMAGE_TOOL_SIZES.map((option) => ({
        value: option.value,
        label: t(`workflowBuilder.agentInspector.image.size.${option.value}`),
      })),
    [t],
  );

  const imageQualityOptions = useMemo(
    () =>
      IMAGE_TOOL_QUALITIES.map((option) => ({
        value: option.value,
        label: t(`workflowBuilder.agentInspector.image.quality.${option.value}`),
      })),
    [t],
  );

  const imageBackgroundOptions = useMemo(
    () =>
      IMAGE_TOOL_BACKGROUNDS.map((option) => ({
        value: option.value,
        label: t(`workflowBuilder.agentInspector.image.background.${option.value}`),
      })),
    [t],
  );

  const imageOutputOptions = useMemo(
    () =>
      IMAGE_TOOL_OUTPUT_FORMATS.map((option) => ({
        value: option.value,
        label: t(`workflowBuilder.agentInspector.image.output.${option.value}`),
      })),
    [t],
  );

  const computerUseModeValue =
    computerUseConfig?.mode ?? DEFAULT_COMPUTER_USE_CONFIG.mode;
  const computerUseSshHostValue = computerUseConfig?.ssh_host ?? '';
  const computerUseSshPortValue =
    computerUseConfig?.ssh_port != null ? String(computerUseConfig.ssh_port) : '';
  const computerUseSshUsernameValue = computerUseConfig?.ssh_username ?? '';
  const computerUseSshPasswordValue = computerUseConfig?.ssh_password ?? '';
  const computerUseSshPrivateKeyValue = computerUseConfig?.ssh_private_key ?? '';
  const computerUseVncHostValue = computerUseConfig?.vnc_host ?? '';
  const computerUseVncPortValue =
    computerUseConfig?.vnc_port != null ? String(computerUseConfig.vnc_port) : '';
  const computerUseVncPasswordValue = computerUseConfig?.vnc_password ?? '';
  const computerUseNoVncPortValue =
    computerUseConfig?.novnc_port != null ? String(computerUseConfig.novnc_port) : '';
  const computerUseEnvironmentIsSsh = computerUseEnvironmentValue === 'ssh';
  const computerUseEnvironmentIsVnc = computerUseEnvironmentValue === 'vnc';

  const handleComputerUseFieldChange = useCallback(
    (updates: ComputerUseFieldUpdates) => {
      const payload = buildComputerUseConfig(computerUseConfig, updates);
      onAgentComputerUseChange(nodeId, payload);
    },
    [computerUseConfig, nodeId, onAgentComputerUseChange],
  );

  return (
    <div className={styles.tabContent}>
      <div className={styles.sectionCard}>
        <AccordionSection
          id="web-search"
          title={t('workflowBuilder.agentInspector.webSearch.title')}
          icon={Globe}
          enabled={webSearchEnabled}
          onToggle={handleWebSearchToggle}
          expandedByDefault={webSearchEnabled}
        >
          <Field
            label={t('workflowBuilder.agentInspector.webSearch.contextLabel')}
            hint={t('workflowBuilder.agentInspector.webSearch.contextHint')}
          >
            <select
              value={webSearchConfig?.search_context_size ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                const nextConfig: WebSearchConfig = {
                  ...(webSearchConfig ?? {}),
                };
                if (value) {
                  nextConfig.search_context_size = value as WebSearchConfig['search_context_size'];
                } else {
                  delete nextConfig.search_context_size;
                }
                onAgentWebSearchChange(nodeId, nextConfig);
              }}
            >
              {webSearchContextOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={t('workflowBuilder.agentInspector.webSearch.maxResultsLabel')}
            hint={t('workflowBuilder.agentInspector.webSearch.maxResultsHint')}
          >
            <input
              type="number"
              min={1}
              max={10}
              value={webSearchConfig?.max_results ?? 5}
              onChange={(event) => {
                if (!webSearchConfig) {
                  return;
                }
                onAgentWebSearchChange(nodeId, {
                  ...webSearchConfig,
                  max_results: Number.parseInt(event.target.value, 10) || 5,
                });
              }}
            />
          </Field>

          <InlineHelp title={t('workflowBuilder.agentInspector.webSearch.helpTitle')}>
            {t('workflowBuilder.agentInspector.webSearch.helpDescription')}
          </InlineHelp>

          <div className={styles.divider} />

          <div className={styles.inlineFieldRow}>
            {Object.keys(WEB_SEARCH_LOCATION_LABELS).map((key) => {
              const typedKey = key as keyof typeof WEB_SEARCH_LOCATION_LABELS;
              const currentValue =
                (webSearchConfig?.user_location?.[typedKey] as string | undefined) ?? '';
              return (
                <Field
                  key={typedKey}
                  label={t(`workflowBuilder.agentInspector.webSearch.location.${typedKey}`)}
                >
                  <input
                    type="text"
                    value={currentValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      const nextLocation = {
                        ...(webSearchConfig?.user_location ?? {}),
                      } as Record<string, string>;
                      if (value.trim()) {
                        nextLocation[typedKey] = value;
                      } else {
                        delete nextLocation[typedKey];
                      }
                      const nextConfig: WebSearchConfig = {
                        ...(webSearchConfig ?? {}),
                      };
                      if (Object.keys(nextLocation).length > 0) {
                        nextConfig.user_location = nextLocation;
                      } else {
                        delete nextConfig.user_location;
                      }
                      onAgentWebSearchChange(nodeId, nextConfig);
                    }}
                  />
                </Field>
              );
            })}
          </div>
        </AccordionSection>

        <AccordionSection
          id="file-search"
          title={t('workflowBuilder.agentInspector.fileSearch.title')}
          icon={FileSearch}
          enabled={fileSearchEnabled}
          onToggle={handleFileSearchToggle}
          expandedByDefault={fileSearchEnabled}
        >
          <Field
            label={t('workflowBuilder.agentInspector.fileSearch.vectorStoreLabel')}
            required
            error={fileSearchValidationMessage ?? undefined}
          >
            <select
              value={selectedVectorStoreSlug}
              onChange={(event) =>
                onAgentFileSearchChange(nodeId, {
                  ...(fileSearchConfig ?? {}),
                  vector_store_slug: event.target.value,
                })
              }
              disabled={vectorStoresLoading}
            >
              <option value="">
                {vectorStoresLoading
                  ? t('workflowBuilder.agentInspector.fileSearch.loading')
                  : t('workflowBuilder.agentInspector.fileSearch.placeholder')}
              </option>
              {vectorStores.map((store) => (
                <option key={store.slug} value={store.slug}>
                  {store.title?.trim()
                    ? `${store.title} (${store.slug})`
                    : store.slug}
                </option>
              ))}
            </select>
          </Field>

          {vectorStoresError ? (
            <p className={styles.errorMessage}>{vectorStoresError}</p>
          ) : null}

          <InlineHelp title={t('workflowBuilder.agentInspector.fileSearch.helpTitle')}>
            {t('workflowBuilder.agentInspector.fileSearch.helpDescription')}
          </InlineHelp>
        </AccordionSection>

        <AccordionSection
          id="computer-use"
          title={t('workflowBuilder.agentInspector.computerUse.title')}
          icon={Monitor}
          enabled={computerUseEnabled}
          onToggle={(enabled) =>
            onAgentComputerUseChange(
              nodeId,
              enabled ? computerUseConfig ?? { ...DEFAULT_COMPUTER_USE_CONFIG } : null,
            )
          }
          expandedByDefault={computerUseEnabled}
        >
          <Field label={t('workflowBuilder.agentInspector.computerUseEnvironmentLabel')}>
            <select
              value={computerUseEnvironmentValue}
              onChange={(event) =>
                handleComputerUseFieldChange({ environment: event.target.value })
              }
            >
              {AGENT_COMPUTER_USE_ENVIRONMENTS.map((environment) => (
                <option key={environment} value={environment}>
                  {t(
                    `workflowBuilder.agentInspector.computerUseEnvironment.${environment}`,
                  )}
                </option>
              ))}
            </select>
          </Field>

          {computerUseEnvironmentValue === 'browser' && (
            <div className={styles.inlineFields}>
              <Field label={t('workflowBuilder.agentInspector.computerUseWidthLabel')}>
                <input
                  type="number"
                  min={1}
                  value={computerUseDisplayWidthValue}
                  onChange={(event) =>
                    handleComputerUseFieldChange({
                      display_width: event.target.value,
                    })
                  }
                />
              </Field>

              <Field label={t('workflowBuilder.agentInspector.computerUseHeightLabel')}>
                <input
                  type="number"
                  min={1}
                  value={computerUseDisplayHeightValue}
                  onChange={(event) =>
                    handleComputerUseFieldChange({
                      display_height: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
           )}

           {computerUseEnvironmentValue === 'browser' && (
             <Field
               label={t('workflowBuilder.agentInspector.computerUseStartUrlLabel')}
               hint={t('workflowBuilder.agentInspector.computerUseStartUrlHelp')}
             >
               <input
                 type="text"
                 value={computerUseStartUrlValue}
                 onChange={(event) =>
                   handleComputerUseFieldChange({ start_url: event.target.value })
                 }
                 placeholder={t(
                   'workflowBuilder.agentInspector.computerUseStartUrlPlaceholder',
                 )}
               />
             </Field>
           )}

           {computerUseEnvironmentIsSsh ? (
            <>
              <Field
                label={t('workflowBuilder.agentInspector.computerUseSshHostLabel')}
                hint={t('workflowBuilder.agentInspector.computerUseSshHostHelp')}
              >
                <input
                  type="text"
                  value={computerUseSshHostValue}
                  onChange={(event) =>
                    handleComputerUseFieldChange({ ssh_host: event.target.value })
                  }
                  placeholder="192.168.1.100"
                />
              </Field>

              <Field
                label={t('workflowBuilder.agentInspector.computerUseSshPortLabel')}
                hint={t('workflowBuilder.agentInspector.computerUseSshPortHelp')}
              >
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={computerUseSshPortValue}
                  onChange={(event) =>
                    handleComputerUseFieldChange({ ssh_port: event.target.value })
                  }
                  placeholder="22"
                />
              </Field>

              <Field
                label={t('workflowBuilder.agentInspector.computerUseSshUsernameLabel')}
                hint={t('workflowBuilder.agentInspector.computerUseSshUsernameHelp')}
              >
                <input
                  type="text"
                  value={computerUseSshUsernameValue}
                  onChange={(event) =>
                    handleComputerUseFieldChange({
                      ssh_username: event.target.value,
                    })
                  }
                  placeholder="root"
                />
              </Field>

              <Field
                label={t('workflowBuilder.agentInspector.computerUseSshPasswordLabel')}
                hint={t('workflowBuilder.agentInspector.computerUseSshPasswordHelp')}
              >
                <input
                  type="password"
                  value={computerUseSshPasswordValue}
                  onChange={(event) =>
                    handleComputerUseFieldChange({
                      ssh_password: event.target.value,
                    })
                  }
                  placeholder="••••••••"
                />
              </Field>

              <Field
                label={t('workflowBuilder.agentInspector.computerUseSshPrivateKeyLabel')}
                hint={t('workflowBuilder.agentInspector.computerUseSshPrivateKeyHelp')}
              >
                <textarea
                  value={computerUseSshPrivateKeyValue}
                  onChange={(event) =>
                    handleComputerUseFieldChange({
                      ssh_private_key: event.target.value,
                    })
                  }
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"
                  rows={4}
                  style={{ fontFamily: 'monospace', fontSize: '12px' }}
                />
              </Field>
            </>
          ) : null}

          {computerUseEnvironmentIsVnc ? (
            <>
              <Field
                label={t('workflowBuilder.agentInspector.computerUseVncHostLabel')}
                hint={t('workflowBuilder.agentInspector.computerUseVncHostHelp')}
              >
                <input
                  type="text"
                  value={computerUseVncHostValue}
                  onChange={(event) =>
                    handleComputerUseFieldChange({ vnc_host: event.target.value })
                  }
                  placeholder="192.168.1.100"
                />
              </Field>

              <Field
                label={t('workflowBuilder.agentInspector.computerUseVncPortLabel')}
                hint={t('workflowBuilder.agentInspector.computerUseVncPortHelp')}
              >
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={computerUseVncPortValue}
                  onChange={(event) =>
                    handleComputerUseFieldChange({ vnc_port: event.target.value })
                  }
                  placeholder="5900"
                />
              </Field>

              <Field
                label={t('workflowBuilder.agentInspector.computerUseVncPasswordLabel')}
                hint={t('workflowBuilder.agentInspector.computerUseVncPasswordHelp')}
              >
                <input
                  type="password"
                  value={computerUseVncPasswordValue}
                  onChange={(event) =>
                    handleComputerUseFieldChange({ vnc_password: event.target.value })
                  }
                  placeholder="••••••••"
                />
              </Field>

              <Field
                label={t('workflowBuilder.agentInspector.computerUseNoVncPortLabel')}
                hint={t('workflowBuilder.agentInspector.computerUseNoVncPortHelp')}
              >
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={computerUseNoVncPortValue}
                  onChange={(event) =>
                    handleComputerUseFieldChange({ novnc_port: event.target.value })
                  }
                  placeholder="6080"
                />
              </Field>
            </>
          ) : null}
        </AccordionSection>

        <AccordionSection
          id="image-generation"
          title={t('workflowBuilder.agentInspector.image.title')}
          icon={ImageIcon}
          enabled={imageGenerationEnabled}
          onToggle={(enabled) =>
            onAgentImageGenerationChange(
              nodeId,
              enabled ? imageGenerationConfig ?? { ...DEFAULT_IMAGE_TOOL_CONFIG } : null,
            )
          }
          expandedByDefault={imageGenerationEnabled}
        >
          <Field label={t('workflowBuilder.agentInspector.image.modelLabel')}>
            <select
              value={imageModelValue}
              onChange={(event) =>
                updateImageTool({
                  model:
                    (event.target.value as ImageGenerationToolConfig['model']) ||
                    DEFAULT_IMAGE_TOOL_CONFIG.model,
                })
              }
            >
              {imageModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <div className={styles.inlineFields}>
            <Field label={t('workflowBuilder.agentInspector.image.sizeLabel')}>
              <select
                value={imageSizeValue}
                onChange={(event) =>
                  updateImageTool({
                    size: event.target.value as ImageGenerationToolConfig['size'],
                  })
                }
              >
                {imageSizeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('workflowBuilder.agentInspector.image.qualityLabel')}>
              <select
                value={imageQualityValue}
                onChange={(event) =>
                  updateImageTool({
                    quality: event.target.value as ImageGenerationToolConfig['quality'],
                  })
                }
              >
                {imageQualityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className={styles.inlineFields}>
            <Field label={t('workflowBuilder.agentInspector.image.backgroundLabel')}>
              <select
                value={imageBackgroundValue}
                onChange={(event) =>
                  updateImageTool({
                    background: event.target.value as ImageGenerationToolConfig['background'],
                  })
                }
              >
                {imageBackgroundOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('workflowBuilder.agentInspector.image.outputLabel')}>
              <select
                value={imageOutputFormatValue}
                onChange={(event) =>
                  updateImageTool({
                    output_format: event.target.value as ImageGenerationToolConfig['output_format'],
                  })
                }
              >
                {imageOutputOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('workflowBuilder.agentInspector.image.partialImagesLabel')} help={t('workflowBuilder.agentInspector.image.partialImagesHelp')}>
              <input
                type="number"
                min="0"
                max="3"
                value={imageGenerationConfig?.partial_images ?? 3}
                onChange={(event) =>
                  updateImageTool({
                    partial_images: parseInt(event.target.value, 10) || 0,
                  })
                }
              />
            </Field>
          </div>

          <InlineHelp title={t('workflowBuilder.agentInspector.image.helpTitle')}>
            {t('workflowBuilder.agentInspector.image.helpDescription')}
          </InlineHelp>
        </AccordionSection>

        <ToolSettingsPanel
          variant="v2"
          nodeId={nodeId}
          parameters={parameters}
          workflows={workflows}
          currentWorkflowId={currentWorkflowId}
          onAgentWeatherToolChange={onAgentWeatherToolChange}
          onAgentWidgetValidationToolChange={onAgentWidgetValidationToolChange}
          onAgentWorkflowValidationToolChange={onAgentWorkflowValidationToolChange}
          onAgentWorkflowToolToggle={onAgentWorkflowToolToggle}
          onAgentMcpServersChange={onAgentMcpServersChange}
          onStartMcpOAuth={onStartMcpOAuth}
          onPollMcpOAuth={onPollMcpOAuth}
          onCancelMcpOAuth={onCancelMcpOAuth}
        />
      </div>
    </div>
  );
};
interface AdvancedSettingsTabProps {
  nodeId: string;
  responseFormat: AgentResponseFormat;
  includeChatHistory: boolean;
  displayResponseInChat: boolean;
  showSearchSources: boolean;
  continueOnError: boolean;
  storeResponses: boolean;
  schemaText: string;
  schemaError: string | null;
  setSchemaText: (value: string) => void;
  setSchemaError: (value: string | null) => void;
  responseWidgetSource: 'library' | 'variable';
  responseWidgetSlug: string;
  trimmedWidgetSlug: string;
  responseWidgetDefinitionExpression: string;
  widgetSelectValue: string;
  widgetValidationMessageFromHook: string | null;
  widgetValidationReason:
    | 'library_empty'
    | 'library_missing_selection'
    | 'library_selection_unavailable'
    | 'variable_missing_expression'
    | null;
  widgets: WidgetTemplateSummary[];
  widgetsLoading: boolean;
  widgetsError: string | null;
  responseWidgetDefinition: Record<string, unknown> | null;
  responseWidgetDefinitionLoading: boolean;
  responseWidgetDefinitionError: string | null;
  onAgentIncludeChatHistoryChange: (nodeId: string, value: boolean) => void;
  onAgentDisplayResponseInChatChange: (nodeId: string, value: boolean) => void;
  onAgentShowSearchSourcesChange: (nodeId: string, value: boolean) => void;
  onAgentContinueOnErrorChange: (nodeId: string, value: boolean) => void;
  onAgentStorePreferenceChange: (nodeId: string, value: boolean) => void;
  onAgentResponseFormatKindChange: (
    nodeId: string,
    kind: 'text' | 'json_schema' | 'widget',
  ) => void;
  onAgentResponseFormatNameChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatSchemaChange: (nodeId: string, schema: unknown) => void;
  onAgentResponseWidgetSlugChange: (nodeId: string, slug: string) => void;
  onAgentResponseWidgetSourceChange: (
    nodeId: string,
    source: 'library' | 'variable',
  ) => void;
  onAgentResponseWidgetDefinitionChange: (nodeId: string, expression: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const AdvancedSettingsTab: React.FC<AdvancedSettingsTabProps> = ({
  nodeId,
  responseFormat,
  includeChatHistory,
  displayResponseInChat,
  showSearchSources,
  continueOnError,
  storeResponses,
  schemaText,
  schemaError,
  setSchemaText,
  setSchemaError,
  responseWidgetSource,
  responseWidgetSlug,
  trimmedWidgetSlug,
  responseWidgetDefinitionExpression,
  widgetSelectValue,
  widgetValidationMessageFromHook,
  widgetValidationReason,
  widgets,
  widgetsLoading,
  widgetsError,
  responseWidgetDefinition,
  responseWidgetDefinitionLoading,
  responseWidgetDefinitionError,
  onAgentIncludeChatHistoryChange,
  onAgentDisplayResponseInChatChange,
  onAgentShowSearchSourcesChange,
  onAgentContinueOnErrorChange,
  onAgentStorePreferenceChange,
  onAgentResponseFormatKindChange,
  onAgentResponseFormatNameChange,
  onAgentResponseFormatSchemaChange,
  onAgentResponseWidgetSlugChange,
  onAgentResponseWidgetSourceChange,
  onAgentResponseWidgetDefinitionChange,
  t,
}) => {
  const [schemaEditorMode, setSchemaEditorMode] = useState<'text' | 'visual'>('text');
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [schemaModalDraft, setSchemaModalDraft] = useState(schemaText);
  const widgetValidationMessage = useMemo(() => {
    switch (widgetValidationReason) {
      case 'library_empty':
        return t('workflowBuilder.agentInspector.widgetValidation.libraryEmpty');
      case 'library_missing_selection':
        return t('workflowBuilder.agentInspector.widgetValidation.libraryMissing');
      case 'library_selection_unavailable':
        return t('workflowBuilder.agentInspector.widgetValidation.libraryUnavailable');
      case 'variable_missing_expression':
        return t('workflowBuilder.agentInspector.widgetValidation.variableMissing');
      default:
        return widgetValidationMessageFromHook;
    }
  }, [t, widgetValidationMessageFromHook, widgetValidationReason]);

  const visualSchema = useMemo(() => {
    try {
      const parsed = JSON.parse(schemaText);
      return jsonToVisualSchema(parsed);
    } catch {
      return [] as SchemaProperty[];
    }
  }, [schemaText]);

  useEffect(() => {
    if (!isSchemaModalOpen) {
      setSchemaModalDraft(schemaText);
    }
  }, [isSchemaModalOpen, schemaText]);

  const handleSchemaChange = useCallback(
    (value: string, options?: { applyNameFromSchema?: boolean }) => {
      setSchemaText(value);
      if (responseFormat.kind !== 'json_schema') {
        setSchemaError(null);
        return true;
      }
      try {
        const parsed = JSON.parse(value);
        const container = extractSchemaContainer(parsed);
        const schemaPayload = container?.schema ?? parsed;
        if (options?.applyNameFromSchema && container?.name) {
          onAgentResponseFormatNameChange(nodeId, container.name);
        }
        setSchemaError(null);
        onAgentResponseFormatSchemaChange(nodeId, schemaPayload);
        return true;
      } catch (error) {
        setSchemaError(
          error instanceof Error
            ? error.message
            : t('workflowBuilder.agentInspector.jsonSchemaInvalid'),
        );
        return false;
      }
    },
    [
      nodeId,
      onAgentResponseFormatNameChange,
      onAgentResponseFormatSchemaChange,
      responseFormat.kind,
      setSchemaError,
      setSchemaText,
      t,
    ],
  );

  const handleWidgetSourceChange = useCallback(
    (value: 'library' | 'variable') => {
      onAgentResponseWidgetSourceChange(nodeId, value);
    },
    [nodeId, onAgentResponseWidgetSourceChange],
  );

  const handleWidgetSelectChange = useCallback(
    (value: string) => {
      onAgentResponseWidgetSlugChange(nodeId, value);
    },
    [nodeId, onAgentResponseWidgetSlugChange],
  );

  const handleWidgetExpressionChange = useCallback(
    (value: string) => {
      onAgentResponseWidgetDefinitionChange(nodeId, value);
    },
    [nodeId, onAgentResponseWidgetDefinitionChange],
  );

  const handleVisualSchemaChange = useCallback(
    (newSchema: SchemaProperty[]) => {
      try {
        const jsonSchema = visualToJsonSchema(newSchema);
        let jsonString = JSON.stringify(jsonSchema, null, 2);
        let containerName: string | undefined;

        try {
          const parsed = JSON.parse(schemaText);
          const container = extractSchemaContainer(parsed);
          if (container) {
            jsonString = JSON.stringify(applySchemaToContainer(container, jsonSchema), null, 2);
            containerName = container.name;
          }
        } catch {
          // Ignore parsing errors when rebuilding visual schema
        }

        setSchemaText(jsonString);
        setSchemaError(null);
        if (containerName) {
          onAgentResponseFormatNameChange(nodeId, containerName);
        }
        onAgentResponseFormatSchemaChange(nodeId, jsonSchema);
      } catch (error) {
        setSchemaError(
          error instanceof Error
            ? error.message
            : t('workflowBuilder.agentInspector.jsonSchemaInvalid'),
        );
      }
    },
    [
      nodeId,
      onAgentResponseFormatNameChange,
      onAgentResponseFormatSchemaChange,
      schemaText,
      setSchemaError,
      setSchemaText,
      t,
    ],
  );

  const formatKindOptions = useMemo(
    () => [
      { value: 'text', label: t('workflowBuilder.agentInspector.responseFormat.text') },
      { value: 'json_schema', label: t('workflowBuilder.agentInspector.responseFormat.jsonSchema') },
      { value: 'widget', label: t('workflowBuilder.agentInspector.responseFormat.widget') },
    ],
    [t],
  );

  return (
    <div className={styles.tabContent}>
      <div className={styles.sectionCard}>
        <Field label={t('workflowBuilder.agentInspector.responseFormatLabel')}>
          <select
            value={responseFormat.kind}
            onChange={(event) =>
              onAgentResponseFormatKindChange(
                nodeId,
                event.target.value as 'text' | 'json_schema' | 'widget',
              )
            }
          >
            {formatKindOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {responseFormat.kind === 'json_schema' ? (
          <>
            <Field
              label={t('workflowBuilder.agentInspector.jsonSchemaNameLabel')}
              hint={t('workflowBuilder.agentInspector.jsonSchemaNameHint')}
            >
              <input
                type="text"
                value={responseFormat.name}
                onChange={(event) =>
                  onAgentResponseFormatNameChange(nodeId, event.target.value)
                }
              />
            </Field>

            <Field
              label={t('workflowBuilder.agentInspector.jsonSchemaEditorModeLabel')}
              hint={t('workflowBuilder.agentInspector.jsonSchemaEditorModeHint')}
            >
              <select
                value={schemaEditorMode}
                onChange={(event) =>
                  setSchemaEditorMode(event.target.value as 'text' | 'visual')
                }
              >
                <option value="text">
                  {t('workflowBuilder.agentInspector.jsonSchemaEditorMode.text')}
                </option>
                <option value="visual">
                  {t('workflowBuilder.agentInspector.jsonSchemaEditorMode.visual')}
                </option>
              </select>
            </Field>

            {schemaEditorMode === 'text' ? (
              <Field
                label={t('workflowBuilder.agentInspector.jsonSchemaDefinitionLabel')}
                hint={t('workflowBuilder.agentInspector.jsonSchemaDefinitionHint')}
                error={schemaError ?? undefined}
              >
                <div className={styles.textareaWithAction}>
                  <textarea
                    data-schema-editor="true"
                    value={schemaText}
                    onChange={(event) =>
                      handleSchemaChange(event.target.value, { applyNameFromSchema: true })
                    }
                    placeholder={DEFAULT_JSON_SCHEMA_TEXT}
                  />
                  <button
                    type="button"
                    className={styles.expandButton}
                    onClick={() => {
                      setSchemaModalDraft(schemaText);
                      setIsSchemaModalOpen(true);
                    }}
                    title={t('workflowBuilder.agentInspector.jsonSchemaModal.openButton')}
                    aria-label={t('workflowBuilder.agentInspector.jsonSchemaModal.openButton')}
                  >
                    <Maximize2 size={16} />
                  </button>
                </div>
                <JsonSchemaModal
                  isOpen={isSchemaModalOpen}
                  value={schemaModalDraft}
                  schemaError={schemaError}
                  onClose={() => setIsSchemaModalOpen(false)}
                  onSave={(nextValue) =>
                    handleSchemaChange(nextValue, { applyNameFromSchema: true })
                  }
                />
              </Field>
            ) : (
              <Field
                label={t('workflowBuilder.agentInspector.jsonSchemaVisualBuilderLabel')}
                hint={t('workflowBuilder.agentInspector.jsonSchemaVisualBuilderHint')}
                error={schemaError ?? undefined}
              >
                <SchemaBuilder schema={visualSchema} onChange={handleVisualSchemaChange} />
              </Field>
            )}
          </>
        ) : null}

        {responseFormat.kind === 'widget' ? (
          <>
            <Field
              label={t('workflowBuilder.agentInspector.widgetSourceLabel')}
              hint={t('workflowBuilder.agentInspector.widgetSourceHint')}
            >
              <select
                value={responseWidgetSource}
                onChange={(event) =>
                  handleWidgetSourceChange(event.target.value as 'library' | 'variable')
                }
              >
                <option value="library">
                  {t('workflowBuilder.agentInspector.widgetSource.library')}
                </option>
                <option value="variable">
                  {t('workflowBuilder.agentInspector.widgetSource.variable')}
                </option>
              </select>
            </Field>

            {responseWidgetSource === 'library' ? (
              <>
                <Field
                  label={t('workflowBuilder.agentInspector.widgetLibraryLabel')}
                  error={widgetValidationMessage ?? undefined}
                >
                  <select
                    value={widgetSelectValue}
                    onChange={(event) => handleWidgetSelectChange(event.target.value)}
                    disabled={widgetsLoading}
                  >
                    <option value="">
                      {widgetsLoading
                        ? t('workflowBuilder.agentInspector.widgetLibraryLoading')
                        : t('workflowBuilder.agentInspector.widgetLibraryPlaceholder')}
                    </option>
                    {widgets.map((widget) => (
                      <option key={widget.slug} value={widget.slug}>
                        {widget.title?.trim()
                          ? `${widget.title} (${widget.slug})`
                          : widget.slug}
                      </option>
                    ))}
                  </select>
                </Field>

                {widgetsError ? (
                  <p className={styles.errorMessage}>{widgetsError}</p>
                ) : widgets.length === 0 && !widgetsLoading ? (
                  <p className={styles.mutedMessage}>
                    {t('workflowBuilder.agentInspector.widgetLibraryEmpty')}
                  </p>
                ) : null}

                {trimmedWidgetSlug && !widgetsLoading && !widgetsError ? (
                  <WidgetJsonFormatInfo
                    definition={responseWidgetDefinition}
                    loading={responseWidgetDefinitionLoading}
                    error={responseWidgetDefinitionError}
                    t={t}
                  />
                ) : null}
              </>
            ) : (
              <Field
                label={t('workflowBuilder.agentInspector.widgetExpressionLabel')}
                hint={t('workflowBuilder.agentInspector.widgetExpressionHint')}
                error={widgetValidationMessage ?? undefined}
              >
                <input
                  type="text"
                  value={responseWidgetDefinitionExpression}
                  onChange={(event) => handleWidgetExpressionChange(event.target.value)}
                  placeholder={t('workflowBuilder.agentInspector.widgetExpressionPlaceholder')}
                />
              </Field>
            )}
          </>
        ) : null}
      </div>

      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>
            {t('workflowBuilder.agentInspector.behaviorTitle')}
          </h4>
          <p className={styles.sectionDescription}>
            {t('workflowBuilder.agentInspector.behaviorDescription')}
          </p>
        </div>

        <div className={styles.toggleGroup}>
          <ToggleRow
            label={t('workflowBuilder.agentInspector.includeChatHistoryLabel')}
            checked={includeChatHistory}
            onChange={(enabled) => onAgentIncludeChatHistoryChange(nodeId, enabled)}
            helpText={t('workflowBuilder.agentInspector.includeChatHistoryHelp')}
          />

          <ToggleRow
            label={t('workflowBuilder.agentInspector.displayResponseInChatLabel')}
            checked={displayResponseInChat}
            onChange={(enabled) => onAgentDisplayResponseInChatChange(nodeId, enabled)}
            helpText={t('workflowBuilder.agentInspector.displayResponseInChatHelp')}
          />

          <ToggleRow
            label={t('workflowBuilder.agentInspector.showSearchSourcesLabel')}
            checked={showSearchSources}
            onChange={(enabled) => onAgentShowSearchSourcesChange(nodeId, enabled)}
            helpText={t('workflowBuilder.agentInspector.showSearchSourcesHelp')}
          />

          <ToggleRow
            label={t('workflowBuilder.agentInspector.continueOnErrorLabel')}
            checked={continueOnError}
            onChange={(enabled) => onAgentContinueOnErrorChange(nodeId, enabled)}
            helpText={t('workflowBuilder.agentInspector.continueOnErrorHelp')}
          />

          <ToggleRow
            label={t('workflowBuilder.agentInspector.storeResponsesLabel')}
            checked={storeResponses}
            onChange={(enabled) => onAgentStorePreferenceChange(nodeId, enabled)}
            helpText={t('workflowBuilder.agentInspector.storeResponsesHelp')}
          />
        </div>
      </div>
    </div>
  );
};
interface WidgetJsonFormatInfoProps {
  definition: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const WidgetJsonFormatInfo: React.FC<WidgetJsonFormatInfoProps> = ({
  definition,
  loading,
  error,
  t,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return <p className={styles.mutedMessage}>{t('workflowBuilder.agentInspector.widgetDefinitionLoading')}</p>;
  }

  if (error) {
    return <p className={styles.errorMessage}>{error}</p>;
  }

  if (!definition) {
    return null;
  }

  const bindings = collectWidgetBindings(definition);
  const bindingKeys = Object.keys(bindings);

  if (bindingKeys.length === 0) {
    return (
      <div className={styles.widgetInfo}>
        <p className={styles.mutedMessage}>
          {t('workflowBuilder.agentInspector.widgetDefinitionNoBindings')}
        </p>
      </div>
    );
  }

  const jsonExample: Record<string, string> = {};
  bindingKeys.forEach((key) => {
    const sanitized = key.replace(/[^0-9a-zA-Z_]+/g, '_').replace(/^_+|_+$/g, '');
    if (sanitized) {
      jsonExample[sanitized] = `"${t('workflowBuilder.agentInspector.widgetDefinitionPlaceholder', { field: key })}"`;
    }
  });

  const preview = JSON.stringify(jsonExample, null, 2);

  return (
    <div className={styles.widgetInfo}>
      <div className={styles.widgetInfoHeader}>
        <h5 className={styles.widgetInfoTitle}>
          {t('workflowBuilder.agentInspector.widgetDefinitionTitle')}
        </h5>
        <button
          type="button"
          className={styles.widgetToggleButton}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className={styles.badge}>{bindingKeys.length}</span>
          <span
            className={[
              styles.widgetToggleIcon,
              expanded ? styles.widgetToggleIconExpanded : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden
          >
            ▶
          </span>
          <span>{expanded ? t('workflowBuilder.agentInspector.widgetDefinitionHide') : t('workflowBuilder.agentInspector.widgetDefinitionShow')}</span>
        </button>
      </div>

      {expanded ? (
        <>
          <p className={styles.mutedMessage}>
            {t('workflowBuilder.agentInspector.widgetDefinitionDescription')}
          </p>
          <pre className={styles.widgetJsonPreview}>{preview}</pre>
          <p className={styles.mutedMessage}>
            {t('workflowBuilder.agentInspector.widgetDefinitionBindingsLabel')}
          </p>
          <ul className={styles.widgetBindingsList}>
            {bindingKeys.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
};
