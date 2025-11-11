/**
 * AgentInspectorSectionV2 - Refactored Agent Inspector with Progressive Disclosure
 *
 * This is a refactored version of AgentInspectorSection that uses:
 * - Tabs for organizing settings (Basic, Model, Tools, Advanced)
 * - Accordion sections for collapsible tool configurations
 * - Field component for consistent form inputs with validation
 * - InlineHelp for contextual documentation
 *
 * This component maintains the same props interface as the original for easy migration.
 */

import React, { useCallback } from 'react';
import { Settings, Cpu, Wrench, Sliders, Globe, FileSearch, Monitor, Image as ImageIcon, Cloud, Sparkles } from 'lucide-react';
import { TabSection, AccordionSection, Field, InlineHelp } from '../ui-components';
import { HelpTooltip } from '../components/HelpTooltip';
import { ToggleRow } from '../components/ToggleRow';
import { useAgentInspectorState } from '../hooks/useAgentInspectorState';
import { useI18n } from '../../../../../i18n';
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
} from '../constants';
import styles from '../NodeInspector.module.css';

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
}) => {
  const { t } = useI18n();

  // Use the existing hook for state management
  const {
    agentMessage,
    agentModel,
    agentProviderId,
    agentProviderSlug,
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
    fileSearchValidationMessage,
    computerUseConfig,
    computerUseEnabled,
    imageGenerationConfig,
    imageGenerationEnabled,
    selectedVectorStoreSlug,
    matchedModel,
    selectedModelOption,
    selectedProviderValue,
    providerOptions,
    modelsForProvider,
    supportsReasoning,
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

  // Tab definitions
  const tabs = [
    {
      id: 'basic',
      label: t('workflowBuilder.agentInspector.tab.basic') || 'Basique',
      icon: Settings,
      content: (
        <BasicSettingsTab
          nodeId={nodeId}
          agentMessage={agentMessage}
          nestedWorkflowMode={nestedWorkflowMode}
          nestedWorkflowId={nestedWorkflowId}
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
      label: t('workflowBuilder.agentInspector.tab.model') || 'Modèle',
      icon: Cpu,
      content: (
        <ModelSettingsTab
          nodeId={nodeId}
          agentModel={agentModel}
          selectedProviderValue={selectedProviderValue}
          selectedModelOption={selectedModelOption}
          providerOptions={providerOptions}
          modelsForProvider={modelsForProvider}
          availableModelsLoading={availableModelsLoading}
          availableModelsError={availableModelsError}
          temperatureValue={temperatureValue}
          maxOutputTokensValue={maxOutputTokensValue}
          topPValue={topPValue}
          supportsReasoning={supportsReasoning}
          reasoningEffort={reasoningEffort}
          reasoningSummaryValue={reasoningSummaryValue}
          textVerbosityValue={textVerbosityValue}
          onAgentProviderChange={onAgentProviderChange}
          onAgentModelChange={onAgentModelChange}
          onAgentTemperatureChange={onAgentTemperatureChange}
          onAgentMaxOutputTokensChange={onAgentMaxOutputTokensChange}
          onAgentTopPChange={onAgentTopPChange}
          onAgentReasoningChange={onAgentReasoningChange}
          onAgentReasoningSummaryChange={onAgentReasoningSummaryChange}
          onAgentTextVerbosityChange={onAgentTextVerbosityChange}
          t={t}
        />
      ),
    },
    {
      id: 'tools',
      label: t('workflowBuilder.agentInspector.tab.tools') || 'Outils',
      icon: Wrench,
      content: (
        <ToolsTab
          nodeId={nodeId}
          webSearchEnabled={webSearchEnabled}
          webSearchConfig={webSearchConfig}
          fileSearchEnabled={fileSearchEnabled}
          fileSearchConfig={fileSearchConfig}
          fileSearchValidationMessage={fileSearchValidationMessage}
          vectorStores={vectorStores}
          vectorStoresLoading={vectorStoresLoading}
          selectedVectorStoreSlug={selectedVectorStoreSlug}
          computerUseEnabled={computerUseEnabled}
          computerUseConfig={computerUseConfig}
          imageGenerationEnabled={imageGenerationEnabled}
          imageGenerationConfig={imageGenerationConfig}
          onAgentWebSearchChange={onAgentWebSearchChange}
          onAgentFileSearchChange={onAgentFileSearchChange}
          onAgentComputerUseChange={onAgentComputerUseChange}
          onAgentImageGenerationChange={onAgentImageGenerationChange}
          t={t}
        />
      ),
    },
    {
      id: 'advanced',
      label: t('workflowBuilder.agentInspector.tab.advanced') || 'Avancé',
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
          onAgentIncludeChatHistoryChange={onAgentIncludeChatHistoryChange}
          onAgentDisplayResponseInChatChange={onAgentDisplayResponseInChatChange}
          onAgentShowSearchSourcesChange={onAgentShowSearchSourcesChange}
          onAgentContinueOnErrorChange={onAgentContinueOnErrorChange}
          onAgentStorePreferenceChange={onAgentStorePreferenceChange}
          onAgentResponseFormatKindChange={onAgentResponseFormatKindChange}
          t={t}
        />
      ),
    },
  ];

  return <TabSection tabs={tabs} defaultTab="basic" />;
};

/**
 * Basic Settings Tab Component
 */
interface BasicSettingsTabProps {
  nodeId: string;
  agentMessage: string;
  nestedWorkflowMode: string;
  nestedWorkflowId: number | null;
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
  t: (key: string) => string;
}

const BasicSettingsTab: React.FC<BasicSettingsTabProps> = ({
  nodeId,
  agentMessage,
  onAgentMessageChange,
  t,
}) => {
  return (
    <div>
      <Field
        label={t('workflowBuilder.agentInspector.messageLabel') || 'System Prompt'}
        required
        hint={t('workflowBuilder.agentInspector.messageHint') || 'Définit le rôle et le comportement de l\'agent'}
      >
        <textarea
          value={agentMessage}
          onChange={(e) => onAgentMessageChange(nodeId, e.target.value)}
          rows={8}
          placeholder="Tu es un assistant IA utile..."
          style={{ fontFamily: 'inherit' }}
        />
      </Field>

      <InlineHelp
        title="Comment écrire un bon system prompt ?"
        examples={[
          {
            label: 'Support client',
            value: 'Tu es un assistant de support client professionnel et empathique. Réponds de manière claire et concise aux questions des clients. Si tu ne connais pas la réponse, oriente-les vers le bon service.',
          },
          {
            label: 'Analyste de données',
            value: 'Tu es un expert en analyse de données. Examine les données fournies, identifie les patterns et insights clés, et produis des analyses claires et actionnables.',
          },
        ]}
      >
        Le system prompt définit le rôle, le ton et le comportement de votre agent.
        Soyez spécifique sur ce que l'agent doit faire et comment il doit répondre.
      </InlineHelp>

      {/* TODO: Add nested workflow configuration */}
      {/* This would include the radio buttons for custom/local/hosted and the selects */}
    </div>
  );
};

/**
 * Model Settings Tab Component
 */
interface ModelSettingsTabProps {
  nodeId: string;
  agentModel: string;
  selectedProviderValue: string;
  selectedModelOption: string;
  providerOptions: Array<{ value: string; label: string; id: string | null; slug: string | null }>;
  modelsForProvider: Array<{ value: string; label: string }>;
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  temperatureValue: string;
  maxOutputTokensValue: string;
  topPValue: string;
  supportsReasoning: boolean;
  reasoningEffort: string;
  reasoningSummaryValue: string;
  textVerbosityValue: string;
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
  onAgentTemperatureChange: (nodeId: string, value: string) => void;
  onAgentMaxOutputTokensChange: (nodeId: string, value: string) => void;
  onAgentTopPChange: (nodeId: string, value: string) => void;
  onAgentReasoningChange: (nodeId: string, value: string) => void;
  onAgentReasoningSummaryChange: (nodeId: string, value: string) => void;
  onAgentTextVerbosityChange: (nodeId: string, value: string) => void;
  t: (key: string) => string;
}

const ModelSettingsTab: React.FC<ModelSettingsTabProps> = ({
  nodeId,
  selectedProviderValue,
  selectedModelOption,
  providerOptions,
  modelsForProvider,
  availableModelsLoading,
  availableModelsError,
  temperatureValue,
  maxOutputTokensValue,
  topPValue,
  supportsReasoning,
  reasoningEffort,
  onAgentProviderChange,
  onAgentModelChange,
  onAgentTemperatureChange,
  onAgentMaxOutputTokensChange,
  onAgentTopPChange,
  t,
}) => {
  const handleProviderChange = (value: string) => {
    if (!value) {
      onAgentProviderChange(nodeId, {
        providerId: null,
        providerSlug: null,
      });
      return;
    }
    const option = providerOptions.find((candidate) => candidate.value === value);
    onAgentProviderChange(nodeId, {
      providerId: option?.id ?? null,
      providerSlug: option?.slug ?? null,
    });
  };

  const handleModelChange = (value: string) => {
    if (!value) {
      onAgentModelChange(nodeId, {
        model: '',
        providerId: null,
        providerSlug: null,
        store: undefined,
      });
      return;
    }
    try {
      const payload = JSON.parse(value) as {
        name: string;
        providerId: string | null;
        providerSlug: string | null;
        store?: boolean | null;
      };
      onAgentModelChange(nodeId, {
        model: payload.name,
        providerId: payload.providerId,
        providerSlug: payload.providerSlug,
        store: payload.store,
      });
    } catch {
      onAgentModelChange(nodeId, {
        model: value,
        providerId: null,
        providerSlug: null,
        store: undefined,
      });
    }
  };

  return (
    <div>
      <Field
        label={t('workflowBuilder.agentInspector.providerLabel') || 'Provider'}
        required
      >
        <select
          value={selectedProviderValue}
          onChange={(e) => handleProviderChange(e.target.value)}
          disabled={availableModelsLoading}
        >
          <option value="">
            {availableModelsLoading
              ? 'Loading...'
              : availableModelsError
                ? 'Error loading providers'
                : 'Select a provider'}
          </option>
          {providerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={t('workflowBuilder.agentInspector.modelLabel') || 'Model'}
        required
        hint="Choisissez le modèle IA qui exécutera les tâches"
      >
        <select
          value={selectedModelOption}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={!selectedProviderValue || availableModelsLoading}
        >
          <option value="">Select a model</option>
          {modelsForProvider.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <InlineHelp
        title="Quel modèle choisir ?"
        examples={[
          {
            label: 'Usage général',
            value: 'Claude 3.5 Sonnet - Meilleur rapport qualité/rapidité/prix',
          },
          {
            label: 'Tâches complexes',
            value: 'Claude 3 Opus - Plus puissant, pour les tâches les plus exigeantes',
          },
        ]}
      >
        Claude 3.5 Sonnet est recommandé pour la plupart des cas d'usage. Il offre
        d'excellentes performances à un coût raisonnable.
      </InlineHelp>

      <Field
        label={t('workflowBuilder.agentInspector.temperatureLabel') || 'Temperature'}
        hint="Contrôle la créativité (0 = déterministe, 1 = créatif)"
      >
        <input
          type="number"
          value={temperatureValue}
          onChange={(e) => onAgentTemperatureChange(nodeId, e.target.value)}
          min="0"
          max="1"
          step="0.1"
          placeholder="0.7"
        />
      </Field>

      <Field
        label={t('workflowBuilder.agentInspector.maxTokensLabel') || 'Max Output Tokens'}
        hint="Nombre maximum de tokens générés"
      >
        <input
          type="number"
          value={maxOutputTokensValue}
          onChange={(e) => onAgentMaxOutputTokensChange(nodeId, e.target.value)}
          min="1"
          max="200000"
          step="1"
          placeholder="4096"
        />
      </Field>

      {/* TODO: Add reasoning settings when supported */}
      {supportsReasoning && (
        <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#eff6ff', borderRadius: '0.5rem' }}>
          <p style={{ fontSize: '0.875rem', color: '#1f2937' }}>
            ⚡ Ce modèle supporte le raisonnement étendu
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Tools Tab Component
 */
interface ToolsTabProps {
  nodeId: string;
  webSearchEnabled: boolean;
  webSearchConfig: WebSearchConfig | null;
  fileSearchEnabled: boolean;
  fileSearchConfig: FileSearchConfig | null;
  fileSearchValidationMessage: string;
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  selectedVectorStoreSlug: string;
  computerUseEnabled: boolean;
  computerUseConfig: ComputerUseConfig | null;
  imageGenerationEnabled: boolean;
  imageGenerationConfig: ImageGenerationToolConfig | null;
  onAgentWebSearchChange: (nodeId: string, config: WebSearchConfig | null) => void;
  onAgentFileSearchChange: (nodeId: string, config: FileSearchConfig | null) => void;
  onAgentComputerUseChange: (nodeId: string, config: ComputerUseConfig | null) => void;
  onAgentImageGenerationChange: (nodeId: string, config: ImageGenerationToolConfig | null) => void;
  t: (key: string) => string;
}

const ToolsTab: React.FC<ToolsTabProps> = ({
  nodeId,
  webSearchEnabled,
  webSearchConfig,
  fileSearchEnabled,
  fileSearchConfig,
  fileSearchValidationMessage,
  vectorStores,
  vectorStoresLoading,
  selectedVectorStoreSlug,
  computerUseEnabled,
  computerUseConfig,
  imageGenerationEnabled,
  imageGenerationConfig,
  onAgentWebSearchChange,
  onAgentFileSearchChange,
  onAgentComputerUseChange,
  onAgentImageGenerationChange,
  t,
}) => {
  return (
    <div>
      {/* Web Search Tool */}
      <AccordionSection
        id="web-search"
        title="Web Search"
        icon={Globe}
        enabled={webSearchEnabled}
        onToggle={(enabled) => {
          onAgentWebSearchChange(
            nodeId,
            enabled ? DEFAULT_WEB_SEARCH_CONFIG : null
          );
        }}
        expandedByDefault={webSearchEnabled}
      >
        <Field
          label="Max Results"
          hint="Nombre maximum de résultats de recherche"
        >
          <input
            type="number"
            value={webSearchConfig?.max_results ?? 5}
            onChange={(e) => {
              if (webSearchConfig) {
                onAgentWebSearchChange(nodeId, {
                  ...webSearchConfig,
                  max_results: parseInt(e.target.value, 10) || 5,
                });
              }
            }}
            min="1"
            max="10"
          />
        </Field>

        <InlineHelp title="Utilisation de Web Search">
          L'agent peut effectuer des recherches web pour trouver des informations
          à jour. Utile pour les questions nécessitant des données récentes.
        </InlineHelp>
      </AccordionSection>

      {/* File Search Tool */}
      <AccordionSection
        id="file-search"
        title="File Search"
        icon={FileSearch}
        enabled={fileSearchEnabled}
        onToggle={(enabled) => {
          if (enabled && vectorStores.length > 0) {
            onAgentFileSearchChange(nodeId, {
              vector_store_slug: vectorStores[0].slug,
            });
          } else {
            onAgentFileSearchChange(nodeId, null);
          }
        }}
        expandedByDefault={fileSearchEnabled}
      >
        <Field
          label="Vector Store"
          required
          error={fileSearchValidationMessage}
        >
          <select
            value={selectedVectorStoreSlug}
            onChange={(e) => {
              if (fileSearchConfig) {
                onAgentFileSearchChange(nodeId, {
                  ...fileSearchConfig,
                  vector_store_slug: e.target.value,
                });
              }
            }}
            disabled={vectorStoresLoading}
          >
            <option value="" disabled>
              {vectorStoresLoading
                ? 'Chargement...'
                : 'Sélectionnez un vector store'}
            </option>
            {vectorStores.map((store) => (
              <option key={store.slug} value={store.slug}>
                {store.slug}
              </option>
            ))}
          </select>
        </Field>

        <InlineHelp title="Utilisation de File Search">
          Permet à l'agent de rechercher dans vos documents indexés dans un vector
          store. Idéal pour répondre à partir de votre base de connaissances.
        </InlineHelp>
      </AccordionSection>

      {/* Computer Use Tool */}
      <AccordionSection
        id="computer-use"
        title="Computer Use"
        icon={Monitor}
        enabled={computerUseEnabled}
        onToggle={(enabled) => {
          onAgentComputerUseChange(
            nodeId,
            enabled ? DEFAULT_COMPUTER_USE_CONFIG : null
          );
        }}
        expandedByDefault={computerUseEnabled}
      >
        <Field label="Display Width (px)" hint="Largeur de l'écran virtuel">
          <input
            type="number"
            value={computerUseConfig?.display_width_px ?? 1024}
            onChange={(e) => {
              if (computerUseConfig) {
                onAgentComputerUseChange(nodeId, {
                  ...computerUseConfig,
                  display_width_px: parseInt(e.target.value, 10) || 1024,
                });
              }
            }}
            min="800"
            max="1920"
          />
        </Field>

        <Field label="Display Height (px)" hint="Hauteur de l'écran virtuel">
          <input
            type="number"
            value={computerUseConfig?.display_height_px ?? 768}
            onChange={(e) => {
              if (computerUseConfig) {
                onAgentComputerUseChange(nodeId, {
                  ...computerUseConfig,
                  display_height_px: parseInt(e.target.value, 10) || 768,
                });
              }
            }}
            min="600"
            max="1080"
          />
        </Field>

        <InlineHelp title="Qu'est-ce que Computer Use ?">
          Computer Use permet à l'agent de contrôler un navigateur virtuel pour
          interagir avec des sites web, remplir des formulaires, etc.
        </InlineHelp>
      </AccordionSection>

      {/* Image Generation Tool */}
      <AccordionSection
        id="image-generation"
        title="Image Generation"
        icon={ImageIcon}
        enabled={imageGenerationEnabled}
        onToggle={(enabled) => {
          onAgentImageGenerationChange(
            nodeId,
            enabled ? DEFAULT_IMAGE_TOOL_CONFIG : null
          );
        }}
        expandedByDefault={imageGenerationEnabled}
      >
        <Field label="Model">
          <select
            value={imageGenerationConfig?.model ?? 'dall-e-3'}
            onChange={(e) => {
              if (imageGenerationConfig) {
                onAgentImageGenerationChange(nodeId, {
                  ...imageGenerationConfig,
                  model: e.target.value as 'dall-e-2' | 'dall-e-3',
                });
              }
            }}
          >
            {IMAGE_TOOL_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Size">
          <select
            value={imageGenerationConfig?.size ?? '1024x1024'}
            onChange={(e) => {
              if (imageGenerationConfig) {
                onAgentImageGenerationChange(nodeId, {
                  ...imageGenerationConfig,
                  size: e.target.value as '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792',
                });
              }
            }}
          >
            {IMAGE_TOOL_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </Field>

        <InlineHelp title="Génération d'images">
          L'agent peut générer des images basées sur des descriptions textuelles.
          Utile pour créer du contenu visuel personnalisé.
        </InlineHelp>
      </AccordionSection>

      {/* TODO: Add MCP Servers, Weather, Widget Validation, etc. */}
    </div>
  );
};

/**
 * Advanced Settings Tab Component
 */
interface AdvancedSettingsTabProps {
  nodeId: string;
  responseFormat: { type: 'text' | 'json_schema' | 'widget' };
  includeChatHistory: boolean;
  displayResponseInChat: boolean;
  showSearchSources: boolean;
  continueOnError: boolean;
  storeResponses: boolean;
  onAgentIncludeChatHistoryChange: (nodeId: string, value: boolean) => void;
  onAgentDisplayResponseInChatChange: (nodeId: string, value: boolean) => void;
  onAgentShowSearchSourcesChange: (nodeId: string, value: boolean) => void;
  onAgentContinueOnErrorChange: (nodeId: string, value: boolean) => void;
  onAgentStorePreferenceChange: (nodeId: string, value: boolean) => void;
  onAgentResponseFormatKindChange: (
    nodeId: string,
    kind: 'text' | 'json_schema' | 'widget',
  ) => void;
  t: (key: string) => string;
}

const AdvancedSettingsTab: React.FC<AdvancedSettingsTabProps> = ({
  nodeId,
  responseFormat,
  includeChatHistory,
  displayResponseInChat,
  showSearchSources,
  continueOnError,
  storeResponses,
  onAgentIncludeChatHistoryChange,
  onAgentDisplayResponseInChatChange,
  onAgentShowSearchSourcesChange,
  onAgentContinueOnErrorChange,
  onAgentStorePreferenceChange,
  onAgentResponseFormatKindChange,
  t,
}) => {
  return (
    <div>
      <Field label="Response Format">
        <select
          value={responseFormat.type}
          onChange={(e) =>
            onAgentResponseFormatKindChange(
              nodeId,
              e.target.value as 'text' | 'json_schema' | 'widget'
            )
          }
        >
          <option value="text">Text</option>
          <option value="json_schema">JSON Schema</option>
          <option value="widget">Widget</option>
        </select>
      </Field>

      <div style={{ marginTop: '1.5rem' }}>
        <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: '#374151' }}>
          Comportement
        </h4>

        <ToggleRow
          label="Include Chat History"
          checked={includeChatHistory}
          onChange={(checked) => onAgentIncludeChatHistoryChange(nodeId, checked)}
          helpText="Inclure l'historique de conversation dans le contexte"
        />

        <ToggleRow
          label="Display Response in Chat"
          checked={displayResponseInChat}
          onChange={(checked) => onAgentDisplayResponseInChatChange(nodeId, checked)}
          helpText="Afficher la réponse dans l'interface de chat"
        />

        <ToggleRow
          label="Show Search Sources"
          checked={showSearchSources}
          onChange={(checked) => onAgentShowSearchSourcesChange(nodeId, checked)}
          helpText="Afficher les sources des recherches web"
        />

        <ToggleRow
          label="Continue on Error"
          checked={continueOnError}
          onChange={(checked) => onAgentContinueOnErrorChange(nodeId, checked)}
          helpText="Continuer l'exécution même en cas d'erreur"
        />

        <ToggleRow
          label="Store Responses"
          checked={storeResponses}
          onChange={(checked) => onAgentStorePreferenceChange(nodeId, checked)}
          helpText="Sauvegarder les réponses dans la base de données"
        />
      </div>

      <InlineHelp title="Paramètres avancés">
        Ces options contrôlent le comportement détaillé de l'agent. Les valeurs par
        défaut conviennent à la plupart des cas d'usage.
      </InlineHelp>
    </div>
  );
};
