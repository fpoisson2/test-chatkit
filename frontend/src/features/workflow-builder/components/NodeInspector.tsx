import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";

import { useAuth } from "../../../auth";
import {
  widgetLibraryApi,
  type AvailableModel,
  type VectorStoreSummary,
  type WidgetTemplateSummary,
} from "../../../utils/backend";
import { WidgetPreview } from "../../../components/WidgetPreview";
import {
  applyWidgetInputValues,
  buildWidgetInputSample,
  collectWidgetBindings,
} from "../../../utils/widgetPreview";
import {
  getAgentContinueOnError,
  getAgentDisplayResponseInChat,
  getAgentFileSearchConfig,
  getAgentIncludeChatHistory,
  getAgentMaxOutputTokens,
  getAgentMessage,
  getAgentModel,
  getAssistantMessage,
  getUserMessage,
  getAgentReasoningEffort,
  getAgentReasoningSummary,
  getAgentReasoningVerbosity,
  getAgentResponseFormat,
  getAgentImageGenerationConfig,
  getAgentShowSearchSources,
  getAgentStorePreference,
  getAgentTemperature,
  getAgentTopP,
  getAgentWeatherToolEnabled,
  getAgentWebSearchConfig,
  getVectorStoreNodeConfig,
  getStateAssignments,
  getEndMessage,
  getWidgetNodeConfig,
  getStartAutoRun,
  getStartAutoRunMessage,
  getStartAutoRunAssistantMessage,
  getConditionMode,
  getConditionPath,
  getConditionValue,
} from "../../../utils/workflows";
import type {
  FileSearchConfig,
  FlowNode,
  ImageGenerationToolConfig,
  StateAssignment,
  StateAssignmentScope,
  VectorStoreNodeConfig,
  WebSearchConfig,
  WidgetVariableAssignment,
} from "../types";
import { labelForKind } from "../utils";

const reasoningEffortOptions = [
  { value: "", label: "Comportement par défaut" },
  { value: "minimal", label: "Effort minimal" },
  { value: "medium", label: "Effort moyen" },
  { value: "high", label: "Effort élevé" },
];

const reasoningVerbosityOptions = [
  { value: "", label: "Verbosité par défaut" },
  { value: "low", label: "Verbosité faible" },
  { value: "medium", label: "Verbosité moyenne" },
  { value: "high", label: "Verbosité élevée" },
];

const reasoningSummaryOptions = [
  { value: "none", label: "Pas de résumé" },
  { value: "auto", label: "Résumé automatique" },
  { value: "detailed", label: "Résumé détaillé" },
];

const conditionModeOptions = [
  {
    value: "truthy",
    label: "Comparer la valeur en tant que booléen (branches true/false)",
  },
  {
    value: "falsy",
    label: "Branche true si la valeur est vide ou fausse",
  },
  {
    value: "equals",
    label: "Branche true si la valeur est égale à la valeur ci-dessous",
  },
  {
    value: "not_equals",
    label: "Branche true si la valeur est différente de la valeur ci-dessous",
  },
  {
    value: "value",
    label: "Utiliser directement la valeur observée (plusieurs branches)",
  },
];

const DEFAULT_JSON_SCHEMA_OBJECT = { type: "object", properties: {} } as const;
const DEFAULT_JSON_SCHEMA_TEXT = JSON.stringify(DEFAULT_JSON_SCHEMA_OBJECT, null, 2);
const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = { search_context_size: "medium" };
const DEFAULT_IMAGE_TOOL_CONFIG: ImageGenerationToolConfig = {
  model: "gpt-image-1-mini",
  size: "1024x1024",
  quality: "high",
  background: "auto",
  output_format: "auto",
};
const WEB_SEARCH_LOCATION_LABELS = {
  city: "Ville",
  region: "Région",
  country: "Pays",
  type: "Type de précision",
} as const;

const IMAGE_TOOL_MODELS = [
  { value: "gpt-image-1-mini", label: "gpt-image-1-mini" },
  { value: "gpt-image-1", label: "gpt-image-1" },
] as const;

const IMAGE_TOOL_SIZES = [
  { value: "1024x1024", label: "1024 × 1024" },
  { value: "1024x1536", label: "1024 × 1536" },
  { value: "1536x1024", label: "1536 × 1024" },
  { value: "auto", label: "Automatique" },
] as const;

const IMAGE_TOOL_QUALITIES = [
  { value: "high", label: "Haute" },
  { value: "medium", label: "Moyenne" },
  { value: "low", label: "Basse" },
  { value: "auto", label: "Automatique" },
] as const;

const IMAGE_TOOL_BACKGROUNDS = [
  { value: "auto", label: "Automatique" },
  { value: "transparent", label: "Transparent" },
  { value: "opaque", label: "Opaque" },
] as const;

const IMAGE_TOOL_OUTPUT_FORMATS = [
  { value: "auto", label: "Automatique" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
  { value: "jpeg", label: "JPEG" },
] as const;

const isTestEnvironment =
  typeof process !== "undefined" && process.env && process.env.NODE_ENV === "test";

export type NodeInspectorProps = {
  node: FlowNode;
  onDisplayNameChange: (nodeId: string, value: string) => void;
  onAgentMessageChange: (nodeId: string, value: string) => void;
  onAgentModelChange: (nodeId: string, value: string) => void;
  onAgentReasoningChange: (nodeId: string, value: string) => void;
  onAgentReasoningVerbosityChange: (nodeId: string, value: string) => void;
  onAgentReasoningSummaryChange: (nodeId: string, value: string) => void;
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
  onWidgetNodeVariablesChange: (
    nodeId: string,
    assignments: WidgetVariableAssignment[],
  ) => void;
  onWidgetNodeAwaitActionChange: (nodeId: string, value: boolean) => void;
  onAgentIncludeChatHistoryChange: (nodeId: string, value: boolean) => void;
  onAgentDisplayResponseInChatChange: (nodeId: string, value: boolean) => void;
  onAgentShowSearchSourcesChange: (nodeId: string, value: boolean) => void;
  onAgentContinueOnErrorChange: (nodeId: string, value: boolean) => void;
  onAgentStorePreferenceChange: (nodeId: string, value: boolean) => void;
  onAgentWebSearchChange: (nodeId: string, config: WebSearchConfig | null) => void;
  onAgentFileSearchChange: (nodeId: string, config: FileSearchConfig | null) => void;
  onAgentImageGenerationChange: (
    nodeId: string,
    config: ImageGenerationToolConfig | null,
  ) => void;
  onVectorStoreNodeConfigChange: (
    nodeId: string,
    updates: Partial<VectorStoreNodeConfig>,
  ) => void;
  onStartAutoRunChange: (nodeId: string, value: boolean) => void;
  onStartAutoRunMessageChange: (nodeId: string, value: string) => void;
  onStartAutoRunAssistantMessageChange: (nodeId: string, value: string) => void;
  onConditionPathChange: (nodeId: string, value: string) => void;
  onConditionModeChange: (nodeId: string, value: string) => void;
  onConditionValueChange: (nodeId: string, value: string) => void;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  isReasoningModel: (model: string) => boolean;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
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
  onUserMessageChange: (nodeId: string, value: string) => void;
  onRemove: (nodeId: string) => void;
};

const NodeInspector = ({
  node,
  onDisplayNameChange,
  onAgentMessageChange,
  onAgentModelChange,
  onAgentReasoningChange,
  onAgentReasoningVerbosityChange,
  onAgentReasoningSummaryChange,
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
  onVectorStoreNodeConfigChange,
  onStartAutoRunChange,
  onStartAutoRunMessageChange,
  onStartAutoRunAssistantMessageChange,
  onConditionPathChange,
  onConditionModeChange,
  onConditionValueChange,
  availableModels,
  availableModelsLoading,
  availableModelsError,
  isReasoningModel,
  onAgentWeatherToolChange,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
  widgets,
  widgetsLoading,
  widgetsError,
  onStateAssignmentsChange,
  onEndMessageChange,
  onAssistantMessageChange,
  onUserMessageChange,
  onRemove,
}: NodeInspectorProps) => {
  const { token } = useAuth();
  const { kind, displayName, parameters } = node.data;
  const isFixed = kind === "start";
  const endMessage = kind === "end" ? getEndMessage(parameters) : "";
  const assistantMessage =
    kind === "assistant_message" ? getAssistantMessage(parameters) : "";
  const userMessage = kind === "user_message" ? getUserMessage(parameters) : "";
  const [userMessageDraft, setUserMessageDraft] = useState(userMessage);
  const agentMessage = getAgentMessage(parameters);
  const agentModel = getAgentModel(parameters);
  const reasoningEffort = getAgentReasoningEffort(parameters);
  const responseFormat = getAgentResponseFormat(parameters);
  const temperature = getAgentTemperature(parameters);
  const topP = getAgentTopP(parameters);
  const reasoningVerbosity = getAgentReasoningVerbosity(parameters);
  const rawReasoningSummary = getAgentReasoningSummary(parameters);
  const reasoningSummaryValue = rawReasoningSummary.trim() ? rawReasoningSummary : "none";
  const maxOutputTokens = getAgentMaxOutputTokens(parameters);
  const maxOutputTokensValue =
    typeof maxOutputTokens === "number" ? String(maxOutputTokens) : "";
  const includeChatHistory = getAgentIncludeChatHistory(parameters);
  const displayResponseInChat = getAgentDisplayResponseInChat(parameters);
  const showSearchSources = getAgentShowSearchSources(parameters);
  const continueOnError = getAgentContinueOnError(parameters);
  const storeResponses = getAgentStorePreference(parameters);
  const startAutoRun = kind === "start" ? getStartAutoRun(parameters) : false;
  const startAutoRunMessage =
    kind === "start" ? getStartAutoRunMessage(parameters) : "";
  const startAutoRunAssistantMessage =
    kind === "start" ? getStartAutoRunAssistantMessage(parameters) : "";
  const conditionPath = kind === "condition" ? getConditionPath(parameters) : "";
  const conditionMode = kind === "condition" ? getConditionMode(parameters) : "truthy";
  const conditionValue = kind === "condition" ? getConditionValue(parameters) : "";
  const hasStartAutoRunUserMessage = startAutoRunMessage.trim().length > 0;
  const hasStartAutoRunAssistantMessage =
    startAutoRunAssistantMessage.trim().length > 0;
  const webSearchConfig = getAgentWebSearchConfig(parameters);
  const webSearchEnabled = Boolean(webSearchConfig);
  const fileSearchConfig = getAgentFileSearchConfig(parameters);
  const fileSearchEnabled = Boolean(fileSearchConfig);
  const imageGenerationConfig = getAgentImageGenerationConfig(parameters);
  const imageGenerationEnabled = Boolean(imageGenerationConfig);
  const imageModelValue = imageGenerationConfig?.model ?? DEFAULT_IMAGE_TOOL_CONFIG.model;
  const imageSizeValue = imageGenerationConfig?.size ?? "";
  const imageQualityValue = imageGenerationConfig?.quality ?? "";
  const imageBackgroundValue = imageGenerationConfig?.background ?? "";
  const imageOutputFormatValue = imageGenerationConfig?.output_format ?? "";
  const updateImageTool = (updates: Partial<ImageGenerationToolConfig>) => {
    const base = imageGenerationConfig ?? DEFAULT_IMAGE_TOOL_CONFIG;
    const draft: Partial<ImageGenerationToolConfig> = { ...base, ...updates };
    const normalized: ImageGenerationToolConfig = {
      model: draft.model?.trim() || DEFAULT_IMAGE_TOOL_CONFIG.model,
    };

    const normalizedSize = draft.size?.trim();
    if (normalizedSize) {
      normalized.size = normalizedSize;
    }

    const normalizedQuality = draft.quality?.trim();
    if (normalizedQuality) {
      normalized.quality = normalizedQuality;
    }

    const normalizedBackground = draft.background?.trim();
    if (normalizedBackground) {
      normalized.background = normalizedBackground;
    }

    const normalizedOutput = draft.output_format?.trim();
    if (normalizedOutput) {
      normalized.output_format = normalizedOutput;
    }

    onAgentImageGenerationChange(node.id, normalized);
  };
  const weatherFunctionEnabled = getAgentWeatherToolEnabled(parameters);
  const selectedVectorStoreSlug = fileSearchConfig?.vector_store_slug ?? "";
  const trimmedVectorStoreSlug = selectedVectorStoreSlug.trim();
  const selectedVectorStoreExists =
    trimmedVectorStoreSlug.length > 0 && vectorStores.some((store) => store.slug === trimmedVectorStoreSlug);
  const fileSearchMissingVectorStore =
    fileSearchEnabled &&
    (!trimmedVectorStoreSlug || (!vectorStoresError && vectorStores.length > 0 && !selectedVectorStoreExists));
  const vectorStoreNodeConfig = getVectorStoreNodeConfig(parameters);
  const vectorStoreNodeSlug = vectorStoreNodeConfig.vector_store_slug.trim();
  const vectorStoreNodeDocIdExpression = vectorStoreNodeConfig.doc_id_expression.trim();
  const vectorStoreNodeDocumentExpression = vectorStoreNodeConfig.document_expression.trim();
  const vectorStoreNodeMetadataExpression = vectorStoreNodeConfig.metadata_expression.trim();
  const responseWidgetSource =
    responseFormat.kind === "widget" ? responseFormat.source : "library";
  const responseWidgetSlug =
    responseFormat.kind === "widget" && responseFormat.source === "library"
      ? responseFormat.slug
      : "";
  const responseWidgetDefinitionExpression =
    responseFormat.kind === "widget" && responseFormat.source === "variable"
      ? responseFormat.definitionExpression
      : "";
  const trimmedWidgetSlug = responseWidgetSlug.trim();
  const selectedWidget = useMemo(() => {
    if (responseFormat.kind !== "widget" || responseFormat.source !== "library") {
      return null;
    }
    if (!trimmedWidgetSlug) {
      return null;
    }
    return widgets.find((widget) => widget.slug === trimmedWidgetSlug) ?? null;
  }, [responseFormat.kind, responseWidgetSource, trimmedWidgetSlug, widgets]);
  const selectedWidgetExists =
    responseFormat.kind === "widget" &&
    responseFormat.source === "library" &&
    trimmedWidgetSlug.length > 0 &&
    Boolean(selectedWidget);
  const widgetNodeConfig = useMemo(() => getWidgetNodeConfig(parameters), [parameters]);
  const widgetNodeSource = widgetNodeConfig.source;
  const widgetNodeSlug = widgetNodeConfig.slug;
  const widgetNodeVariables = widgetNodeConfig.variables;
  const widgetNodeAwaitAction = widgetNodeConfig.awaitAction;
  const widgetNodeDefinitionExpression = widgetNodeConfig.definitionExpression;
  const trimmedWidgetNodeSlug = widgetNodeSlug.trim();
  const [widgetDefinition, setWidgetDefinition] = useState<Record<string, unknown> | null>(null);
  const [widgetDefinitionLoading, setWidgetDefinitionLoading] = useState(false);
  const [widgetDefinitionError, setWidgetDefinitionError] = useState<string | null>(null);
  const widgetNodeSelectedWidget = useMemo(() => {
    if (widgetNodeSource !== "library") {
      return null;
    }
    if (!trimmedWidgetNodeSlug) {
      return null;
    }
    return widgets.find((widget) => widget.slug === trimmedWidgetNodeSlug) ?? null;
  }, [widgetNodeSource, trimmedWidgetNodeSlug, widgets]);
  useEffect(() => {
    if (kind !== "widget" || widgetNodeSource !== "library") {
      setWidgetDefinition(null);
      setWidgetDefinitionError(null);
      setWidgetDefinitionLoading(false);
      return;
    }
    if (!trimmedWidgetNodeSlug || isTestEnvironment) {
      setWidgetDefinition(null);
      setWidgetDefinitionError(null);
      setWidgetDefinitionLoading(false);
      return;
    }
    let isCancelled = false;
    setWidgetDefinitionLoading(true);
    setWidgetDefinitionError(null);
    widgetLibraryApi
      .getWidget(token, trimmedWidgetNodeSlug)
      .then((widget) => {
        if (isCancelled) {
          return;
        }
        setWidgetDefinition(widget.definition);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        setWidgetDefinition(null);
        setWidgetDefinitionError(
          error instanceof Error
            ? error.message
            : "Impossible de charger le widget sélectionné.",
        );
      })
      .finally(() => {
        if (!isCancelled) {
          setWidgetDefinitionLoading(false);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [kind, token, widgetNodeSource, trimmedWidgetNodeSlug]);
  const widgetSelectId = useId();
  const widgetNodeSlugSuggestionsId = useId();
  let fileSearchValidationMessage: string | null = null;
  if (fileSearchMissingVectorStore && !vectorStoresLoading) {
    if (!vectorStoresError && vectorStores.length === 0) {
      fileSearchValidationMessage =
        "Créez un vector store avant d'activer la recherche documentaire.";
    } else if (trimmedVectorStoreSlug && !selectedVectorStoreExists) {
      fileSearchValidationMessage =
        "Le vector store sélectionné n'est plus disponible. Choisissez-en un autre.";
    } else {
      fileSearchValidationMessage =
        "Sélectionnez un vector store pour activer la recherche documentaire.";
    }
  }
  let widgetValidationMessage: string | null = null;
  if (
    responseFormat.kind === "widget" &&
    responseWidgetSource === "library" &&
    !widgetsLoading &&
    !widgetsError
  ) {
    if (widgets.length === 0) {
      widgetValidationMessage = "Aucun widget n'est disponible dans la bibliothèque.";
    } else if (!trimmedWidgetSlug) {
      widgetValidationMessage = "Sélectionnez un widget de sortie.";
    } else if (!selectedWidgetExists) {
      widgetValidationMessage = "Le widget sélectionné n'est plus disponible. Choisissez-en un autre.";
    }
  } else if (responseFormat.kind === "widget" && responseWidgetSource === "variable") {
    if (!responseWidgetDefinitionExpression.trim()) {
      widgetValidationMessage =
        "Renseignez une expression qui retourne le JSON du widget (ex. state.widget_json).";
    }
  }
  let widgetNodeValidationMessage: string | null = null;
  if (
    kind === "widget" &&
    widgetNodeSource === "library" &&
    !widgetsLoading &&
    !widgetsError &&
    widgets.length > 0
  ) {
    if (!trimmedWidgetNodeSlug) {
      widgetNodeValidationMessage = "Sélectionnez un widget à afficher.";
    } else if (!widgetNodeSelectedWidget) {
      widgetNodeValidationMessage = "Le widget sélectionné n'est plus disponible. Choisissez-en un autre.";
    }
  } else if (kind === "widget" && widgetNodeSource === "variable") {
    if (!widgetNodeDefinitionExpression.trim()) {
      widgetNodeValidationMessage =
        "Renseignez une expression qui retourne le JSON du widget à afficher.";
    }
  }
  const widgetNodeSelectValue =
    widgetNodeSource === "library" && widgetNodeSelectedWidget ? trimmedWidgetNodeSlug : "";
  const widgetSelectValue =
    responseWidgetSource === "library" && selectedWidgetExists ? trimmedWidgetSlug : "";
  const vectorStoreNodeExists =
    vectorStoreNodeSlug.length > 0 && vectorStores.some((store) => store.slug === vectorStoreNodeSlug);
  const vectorStoreNodeValidationMessages: string[] = [];
  if (kind === "json_vector_store") {
    if (!vectorStoreNodeSlug) {
      vectorStoreNodeValidationMessages.push(
        "Sélectionnez un vector store pour enregistrer la réponse.",
      );
    } else if (
      !vectorStoresError &&
      vectorStores.length > 0 &&
      !vectorStoreNodeExists
    ) {
      vectorStoreNodeValidationMessages.push(
        "Le vector store sélectionné n'est plus disponible. Choisissez-en un autre.",
      );
    }
  }
  const matchedModel = availableModels.find((model) => model.name === agentModel);
  const selectedModelOption = matchedModel ? matchedModel.name : "";
  const supportsReasoning = isReasoningModel(agentModel);
  const temperatureValue = typeof temperature === "number" ? String(temperature) : "";
  const topPValue = typeof topP === "number" ? String(topP) : "";
  const globalAssignments = useMemo(
    () => getStateAssignments(parameters, "globals"),
    [parameters],
  );
  const stateAssignments = useMemo(
    () => getStateAssignments(parameters, "state"),
    [parameters],
  );
  const [schemaText, setSchemaText] = useState(() =>
    responseFormat.kind === "json_schema"
      ? JSON.stringify(responseFormat.schema ?? {}, null, 2)
      : DEFAULT_JSON_SCHEMA_TEXT,
  );
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const schemaSignature =
    responseFormat.kind === "json_schema"
      ? JSON.stringify(responseFormat.schema ?? {})
      : "";
  useEffect(() => {
    if (responseFormat.kind === "json_schema") {
      setSchemaText(JSON.stringify(responseFormat.schema ?? {}, null, 2));
    } else {
      setSchemaText(DEFAULT_JSON_SCHEMA_TEXT);
    }
    setSchemaError(null);
  }, [node.id, responseFormat.kind, schemaSignature]);

  useEffect(() => {
    if (kind !== "user_message") {
      return;
    }
    setUserMessageDraft(userMessage);
  }, [kind, node.id, userMessage]);

  return (
    <>
      <section aria-label={`Propriétés du nœud ${node.data.slug}`}>
        <div style={inspectorHeaderStyle}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
            <span style={inspectorTitleStyle}>
              {displayName.trim() ? displayName : `Bloc ${labelForKind(kind)}`}
            </span>
            <span style={inspectorSubtitleStyle}>Identifiant : {node.data.slug}</span>
          </div>
          {!isFixed && (
            <button
              type="button"
              onClick={() => onRemove(node.id)}
              style={deleteButtonStyle}
              aria-label={`Supprimer le bloc ${displayName.trim() ? displayName : node.data.slug}`}
              title="Supprimer ce bloc"
            >
              <TrashIcon />
            </button>
          )}
        </div>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 0.75rem" }}>
          <dt>Identifiant</dt>
          <dd>{node.data.slug}</dd>
          <dt>Type</dt>
          <dd>{labelForKind(kind)}</dd>
        </dl>

        <label style={fieldStyle}>
          <span>Nom affiché</span>
        <input
          type="text"
          value={displayName}
          onChange={(event) => onDisplayNameChange(node.id, event.target.value)}
        />
      </label>

      {kind === "start" && (
        <ToggleRow
          label="Démarrer automatiquement"
          checked={startAutoRun}
          onChange={(next) => onStartAutoRunChange(node.id, next)}
          help="Exécute immédiatement le workflow lors de l'ouverture d'un fil, même sans message utilisateur."
        />
      )}

      {kind === "start" && startAutoRun && (
        <label style={fieldStyle}>
          <span style={labelContentStyle}>Message utilisateur initial</span>
          <textarea
            value={startAutoRunMessage}
            onChange={(event) =>
              onStartAutoRunMessageChange(node.id, event.target.value)
            }
            rows={3}
            placeholder="Ex. Bonjour, voici les informations de départ… (facultatif)"
            style={{ resize: "vertical", minHeight: "4.5rem" }}
            disabled={hasStartAutoRunAssistantMessage}
          />
          <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
            Ce message est transmis à l'agent lorsqu'un fil démarre sans saisie
            utilisateur. Saisir un message assistant ci-dessous effacera
            automatiquement ce contenu.
          </p>
        </label>
      )}

      {kind === "start" && startAutoRun && (
        <label style={fieldStyle}>
          <span style={labelContentStyle}>Message assistant initial</span>
          <textarea
            value={startAutoRunAssistantMessage}
            onChange={(event) =>
              onStartAutoRunAssistantMessageChange(node.id, event.target.value)
            }
            rows={3}
            placeholder="Ex. Bonjour, je suis votre assistant… (facultatif)"
            style={{ resize: "vertical", minHeight: "4.5rem" }}
            disabled={hasStartAutoRunUserMessage}
          />
          <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
            Ce message est diffusé en tant que première réponse de l'assistant
            lorsque le démarrage automatique est déclenché. Ajoutez un message
            utilisateur ci-dessus pour désactiver cette réponse.
          </p>
        </label>
      )}

      {kind === "condition" && (
        <>
          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Variable observée
              <HelpTooltip label="Référencez une valeur disponible dans l'état (ex. state.status ou globals.client_type)." />
            </span>
            <input
              type="text"
              value={conditionPath}
              onChange={(event) => onConditionPathChange(node.id, event.target.value)}
              placeholder="Ex. state.statut_demande"
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Mode d'évaluation
              <HelpTooltip label="Choisissez comment interpréter la valeur observée pour déterminer la branche à suivre." />
            </span>
            <select
              value={conditionMode}
              onChange={(event) => onConditionModeChange(node.id, event.target.value)}
            >
              {conditionModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {(conditionMode === "equals" || conditionMode === "not_equals") && (
            <label style={fieldStyle}>
              <span style={labelContentStyle}>
                Valeur de comparaison
                <HelpTooltip label="La valeur (chaîne, nombre…) qui servira de référence pour la comparaison." />
              </span>
              <input
                type="text"
                value={conditionValue}
                onChange={(event) => onConditionValueChange(node.id, event.target.value)}
                placeholder="Ex. approuvée"
              />
            </label>
          )}

          <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
            Définissez les différentes branches dans les propriétés des connexions. Laissez le champ vide pour créer une branche
            par défaut.
          </p>
        </>
      )}

      {kind === "widget" && (
        <>
          <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0" }}>
            Affichez un widget existant ou fournissez une expression qui renvoie sa définition JSON.
          </p>
          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Source du widget
              <HelpTooltip label="Diffusez un widget de la bibliothèque ou un JSON stocké dans les variables du workflow." />
            </span>
            <select
              value={widgetNodeSource}
              onChange={(event) =>
                onWidgetNodeSourceChange(node.id, event.target.value as "library" | "variable")
              }
            >
              <option value="library">Bibliothèque de widgets</option>
              <option value="variable">Expression JSON (variable)</option>
            </select>
          </label>

          {widgetNodeSource === "library" ? (
            <>
              <label style={fieldStyle} htmlFor={`${widgetNodeSlugSuggestionsId}-input`}>
                <span style={labelContentStyle}>
                  Slug du widget
                  <HelpTooltip label="Correspond au slug défini lors de l'enregistrement du widget dans la bibliothèque." />
                </span>
                <input
                  id={`${widgetNodeSlugSuggestionsId}-input`}
                  type="text"
                  value={widgetNodeSlug}
                  onChange={(event) => onWidgetNodeSlugChange(node.id, event.target.value)}
                  placeholder="Ex. mon-widget-personnalise"
                  list={widgets.length > 0 ? `${widgetNodeSlugSuggestionsId}-list` : undefined}
                />
              </label>
              <label style={inlineFieldStyle} htmlFor={`${widgetNodeSlugSuggestionsId}-select`}>
                <span style={labelContentStyle}>
                  Widget enregistré
                  <HelpTooltip label="La liste provient automatiquement de la bibliothèque des widgets partageables. Le widget sélectionné est diffusé immédiatement dans ChatKit lorsqu'on atteint ce bloc." />
                </span>
                <select
                  id={`${widgetNodeSlugSuggestionsId}-select`}
                  value={widgetNodeSelectValue}
                  onChange={(event) => onWidgetNodeSlugChange(node.id, event.target.value)}
                  disabled={widgetsLoading || !!widgetsError || widgets.length === 0}
                >
                  <option value="">Sélectionnez un widget</option>
                  {widgets.map((widget) => (
                    <option key={widget.slug} value={widget.slug}>
                      {widget.title?.trim() ? `${widget.title} (${widget.slug})` : widget.slug}
                    </option>
                  ))}
                </select>
              </label>
              {widgetsLoading ? (
                <p style={{ color: "var(--text-muted)", margin: 0 }}>
                  Chargement de la bibliothèque de widgets…
                </p>
              ) : widgetsError ? (
                <p style={{ color: "#b91c1c", margin: 0 }}>
                  {widgetsError}
                  <br />
                  Vous pouvez saisir le slug du widget manuellement ci-dessus.
                </p>
              ) : widgets.length === 0 ? (
                <p style={{ color: "var(--text-muted)", margin: 0 }}>
                  Créez un widget dans la bibliothèque dédiée ou saisissez son slug manuellement ci-dessus.
                </p>
              ) : null}

              {widgetNodeValidationMessage ? (
                <p style={{ color: "#b91c1c", margin: 0 }}>{widgetNodeValidationMessage}</p>
              ) : null}

              {widgets.length > 0 && (
                <datalist id={`${widgetNodeSlugSuggestionsId}-list`}>
                  {widgets.map((widget) => (
                    <option key={widget.slug} value={widget.slug}>
                      {widget.title?.trim() ? widget.title : widget.slug}
                    </option>
                  ))}
                </datalist>
              )}

              {!isTestEnvironment && (
                <WidgetNodeContentEditor
                  slug={trimmedWidgetNodeSlug}
                  definition={widgetDefinition}
                  loading={widgetDefinitionLoading}
                  error={widgetDefinitionError}
                  assignments={widgetNodeVariables}
                  onChange={(next) => onWidgetNodeVariablesChange(node.id, next)}
                />
              )}

              <div style={{ marginTop: "0.75rem" }}>
                <WidgetVariablesPanel
                  assignments={widgetNodeVariables}
                  onChange={(next) => onWidgetNodeVariablesChange(node.id, next)}
                />
              </div>
            </>
          ) : (
            <>
              <label style={fieldStyle}>
                <span style={labelContentStyle}>
                  Expression JSON du widget
                  <HelpTooltip label="Saisissez une expression (ex. state.widget_output) qui renvoie la définition JSON complète du widget." />
                </span>
                <input
                  type="text"
                  value={widgetNodeDefinitionExpression}
                  onChange={(event) =>
                    onWidgetNodeDefinitionExpressionChange(node.id, event.target.value)
                  }
                  placeholder="Ex. state.widget_output"
                />
              </label>
              <p style={{ color: "var(--text-muted)", margin: "-0.35rem 0 0.35rem" }}>
                Le JSON fourni est transmis tel quel au widget ChatKit. Vérifiez qu'il respecte le schéma attendu.
              </p>
              {widgetNodeValidationMessage ? (
                <p style={{ color: "#b91c1c", margin: 0 }}>{widgetNodeValidationMessage}</p>
              ) : null}
            </>
          )}

          <label style={{ ...fieldStyle, marginTop: "0.75rem" }}>
            <span style={labelContentStyle}>Progression du workflow</span>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
              <input
                type="checkbox"
                checked={widgetNodeAwaitAction}
                onChange={(event) =>
                  onWidgetNodeAwaitActionChange(node.id, event.target.checked)
                }
              />
              <div style={{ lineHeight: 1.4 }}>
                <strong>Attendre une action utilisateur avant de continuer</strong>
                <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
                  Lorsque cette option est activée, le workflow reste sur ce bloc tant que
                  l'utilisateur n'a pas interagi avec le widget. Désactivez-la pour enchaîner
                  automatiquement avec l'étape suivante.
                </p>
              </div>
            </div>
          </label>
        </>
      )}

      {kind === "assistant_message" && (
        <label style={fieldStyle}>
          <span style={labelContentStyle}>Texte du message assistant</span>
          <textarea
            value={assistantMessage}
            onChange={(event) =>
              onAssistantMessageChange(node.id, event.target.value)
            }
            rows={4}
            placeholder="Texte affiché aux utilisateurs lorsque ce bloc est exécuté"
            style={{ resize: "vertical", minHeight: "4.5rem" }}
          />
          <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
            Ce message est diffusé tel quel dans la conversation avant de passer au
            bloc suivant.
          </p>
        </label>
      )}

      {kind === "user_message" && (
        <label style={fieldStyle}>
          <span style={labelContentStyle}>Texte du message utilisateur</span>
          <textarea
            value={userMessageDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              setUserMessageDraft(nextValue);
              onUserMessageChange(node.id, nextValue);
            }}
            rows={4}
            placeholder="Texte injecté dans la conversation comme message utilisateur"
            style={{ resize: "vertical", minHeight: "4.5rem" }}
          />
          <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
            Ce message est transmis à l'agent comme s'il provenait directement de
            l'utilisateur avant de passer au bloc suivant.
          </p>
        </label>
      )}

      {kind === "end" && (
        <label style={fieldStyle}>
          <span style={labelContentStyle}>
            Message de fin
            <HelpTooltip label="Ce message est utilisé comme raison de clôture lorsque ce bloc termine le fil." />
          </span>
          <textarea
            value={endMessage}
            rows={4}
            placeholder="Texte affiché lorsque le workflow se termine sur ce bloc"
            onChange={(event) => onEndMessageChange(node.id, event.target.value)}
          />
        </label>
      )}

      {kind === "agent" && (
        <>
          <label style={fieldStyle}>
            <span>Message système</span>
            <textarea
              value={agentMessage}
              rows={5}
              placeholder="Texte transmis à l'agent pour définir son rôle"
              onChange={(event) => onAgentMessageChange(node.id, event.target.value)}
            />
          </label>

          <label style={inlineFieldStyle}>
            <span style={labelContentStyle}>
              Modèle OpenAI
              <HelpTooltip label="Sélectionnez un modèle autorisé pour exécuter ce bloc." />
            </span>
            <select
              value={selectedModelOption}
              onChange={(event) => onAgentModelChange(node.id, event.target.value)}
              disabled={availableModelsLoading}
            >
              <option value="">Sélectionnez un modèle</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.name}>
                  {model.display_name?.trim()
                    ? `${model.display_name} (${model.name})`
                    : model.name}
                  {model.supports_reasoning ? " – raisonnement" : ""}
                </option>
              ))}
            </select>
          </label>
          {agentModel.trim() && !matchedModel && !availableModelsLoading ? (
            <p style={{ color: "#b91c1c", margin: "0.5rem 0 0" }}>
              Ce bloc utilise actuellement un modèle non listé ({agentModel}). Sélectionnez un modèle dans la
              liste ci-dessus.
            </p>
          ) : null}
          {availableModelsLoading ? (
            <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0" }}>Chargement des modèles autorisés…</p>
          ) : availableModelsError ? (
            <p style={{ color: "#b91c1c", margin: "0.5rem 0 0" }}>{availableModelsError}</p>
          ) : matchedModel?.description ? (
            <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0" }}>{matchedModel.description}</p>
          ) : null}

          {supportsReasoning ? (
            <>
              <label style={inlineFieldStyle}>
                <span style={labelContentStyle}>
                  Niveau de raisonnement
                  <HelpTooltip label="Ajuste la profondeur d'analyse du modèle (laisser vide pour utiliser la valeur par défaut)." />
                </span>
                <select
                  value={reasoningEffort}
                  onChange={(event) => onAgentReasoningChange(node.id, event.target.value)}
                >
                  {reasoningEffortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={inlineFieldStyle}>
                <span style={labelContentStyle}>
                  Verbosité du raisonnement
                  <HelpTooltip label="Contrôle la quantité de texte générée pendant les étapes de raisonnement." />
                </span>
                <select
                  value={reasoningVerbosity}
                  onChange={(event) => onAgentReasoningVerbosityChange(node.id, event.target.value)}
                >
                  {reasoningVerbosityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={inlineFieldStyle}>
                <span style={labelContentStyle}>
                  Résumé des étapes
                  <HelpTooltip label="Détermine si l'agent doit générer un résumé automatique de son raisonnement." />
                </span>
                <select
                  value={reasoningSummaryValue}
                  onChange={(event) => onAgentReasoningSummaryChange(node.id, event.target.value)}
                >
                  {reasoningSummaryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label style={fieldStyle}>
                <span style={labelContentStyle}>
                  Température
                  <HelpTooltip label="Ajuste la créativité des réponses pour les modèles sans raisonnement." />
                </span>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.01"
                  value={temperatureValue}
                  placeholder="Ex. 0.7"
                  onChange={(event) => onAgentTemperatureChange(node.id, event.target.value)}
                />
              </label>
              <label style={fieldStyle}>
                <span style={labelContentStyle}>
                  Top-p
                  <HelpTooltip label="Détermine la diversité lexicale en limitant la probabilité cumulée." />
                </span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={topPValue}
                  placeholder="Ex. 0.9"
                  onChange={(event) => onAgentTopPChange(node.id, event.target.value)}
                />
              </label>
            </>
          )}

          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Nombre maximal de tokens générés
              <HelpTooltip label="Limite la longueur maximale des réponses produites par cet agent." />
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={maxOutputTokensValue}
              placeholder="Laisser vide pour la valeur par défaut"
              onChange={(event) => onAgentMaxOutputTokensChange(node.id, event.target.value)}
            />
          </label>

          <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
            <ToggleRow
              label="Inclure l'historique du chat"
              checked={includeChatHistory}
              onChange={(next) => onAgentIncludeChatHistoryChange(node.id, next)}
            />
            <ToggleRow
              label="Afficher la réponse dans le chat"
              checked={displayResponseInChat}
              onChange={(next) => onAgentDisplayResponseInChatChange(node.id, next)}
            />
            <ToggleRow
              label="Afficher les sources de recherche"
              checked={showSearchSources}
              onChange={(next) => onAgentShowSearchSourcesChange(node.id, next)}
            />
            <ToggleRow
              label="Continuer l'exécution en cas d'erreur"
              checked={continueOnError}
              onChange={(next) => onAgentContinueOnErrorChange(node.id, next)}
            />
            <ToggleRow
              label="Enregistrer la réponse dans l'historique de conversation"
              checked={storeResponses}
              onChange={(next) => onAgentStorePreferenceChange(node.id, next)}
            />
          </div>

          <label style={inlineFieldStyle}>
            <span style={labelContentStyle}>
              Type de sortie
              <HelpTooltip label="Choisissez le format attendu pour la réponse de l'agent." />
            </span>
            <select
              value={responseFormat.kind}
              onChange={(event) => {
                const nextKind = event.target.value as "text" | "json_schema" | "widget";
                onAgentResponseFormatKindChange(node.id, nextKind);
              }}
            >
              <option value="text">Texte libre</option>
              <option value="json_schema">Schéma JSON</option>
              <option value="widget">Widget de la bibliothèque</option>
            </select>
          </label>

          {responseFormat.kind === "json_schema" && (
            <>
              <label style={fieldStyle}>
                <span>Nom du schéma JSON</span>
                <input
                  type="text"
                  value={responseFormat.name}
                  onChange={(event) => onAgentResponseFormatNameChange(node.id, event.target.value)}
                />
              </label>

              <label style={fieldStyle}>
                <span style={labelContentStyle}>
                  Définition du schéma JSON
                  <HelpTooltip label="Fournissez un schéma JSON valide (Draft 2020-12) pour contraindre la sortie." />
                </span>
                <textarea
                  value={schemaText}
                  rows={8}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSchemaText(value);
                    try {
                      const parsed = JSON.parse(value);
                      setSchemaError(null);
                      onAgentResponseFormatSchemaChange(node.id, parsed);
                    } catch (error) {
                      setSchemaError(
                        error instanceof Error ? error.message : "Schéma JSON invalide",
                      );
                    }
                  }}
                  style={schemaError ? { borderColor: "#b91c1c" } : undefined}
                />
                {schemaError ? (
                  <span style={{ color: "#b91c1c", fontSize: "0.85rem" }}>{schemaError}</span>
                ) : null}
              </label>
            </>
          )}

          {responseFormat.kind === "widget" && (
            <>
              <label style={fieldStyle}>
                <span style={labelContentStyle}>
                  Source du widget
                  <HelpTooltip label="Choisissez entre un widget enregistré ou un JSON fourni par une variable du workflow." />
                </span>
                <select
                  value={responseWidgetSource}
                  onChange={(event) =>
                    onAgentResponseWidgetSourceChange(
                      node.id,
                      event.target.value as "library" | "variable",
                    )
                  }
                >
                  <option value="library">Bibliothèque de widgets</option>
                  <option value="variable">Expression JSON (variable)</option>
                </select>
              </label>

              {responseWidgetSource === "library" ? (
                <>
                  <label style={inlineFieldStyle} htmlFor={`${widgetSelectId}-select`}>
                    <span style={labelContentStyle}>
                      Widget de sortie
                      <HelpTooltip label="Sélectionnez un widget existant pour afficher la réponse dans ChatKit." />
                    </span>
                    <select
                      id={`${widgetSelectId}-select`}
                      value={widgetSelectValue}
                      onChange={(event) =>
                        onAgentResponseWidgetSlugChange(node.id, event.target.value)
                      }
                      disabled={widgetsLoading || !!widgetsError || widgets.length === 0}
                      aria-describedby={
                        widgetValidationMessage ? `${widgetSelectId}-message` : undefined
                      }
                    >
                      <option value="">
                        {widgets.length === 0
                          ? "Aucun widget disponible"
                          : "Sélectionnez un widget"}
                      </option>
                      {widgets.map((widget) => (
                        <option key={widget.slug} value={widget.slug}>
                          {widget.title?.trim() ? `${widget.title} (${widget.slug})` : widget.slug}
                        </option>
                      ))}
                    </select>
                  </label>
                  {widgetsLoading ? (
                    <p style={{ color: "var(--text-muted)", margin: 0 }}>
                      Chargement de la bibliothèque de widgets…
                    </p>
                  ) : widgetsError ? (
                    <p style={{ color: "#b91c1c", margin: 0 }}>{widgetsError}</p>
                  ) : widgets.length === 0 ? (
                    <p style={{ color: "var(--text-muted)", margin: 0 }}>
                      Créez un widget dans la bibliothèque dédiée pour l'utiliser ici.
                    </p>
                  ) : null}
                  {widgetValidationMessage ? (
                    <p
                      id={`${widgetSelectId}-message`}
                      style={{ color: "#b91c1c", margin: "0.25rem 0 0" }}
                    >
                      {widgetValidationMessage}
                    </p>
                  ) : null}
                  {responseWidgetSlug && !widgetsLoading && widgetsError && (
                    <p style={{ color: "var(--text-muted)", margin: "0.25rem 0 0" }}>
                      Le widget sélectionné ({responseWidgetSlug}) sera conservé tant que la bibliothèque n'est
                      pas disponible.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <label style={fieldStyle}>
                    <span style={labelContentStyle}>
                      Expression JSON du widget
                      <HelpTooltip label="Saisissez une expression (ex. state.widget_json) qui renvoie la définition JSON complète du widget." />
                    </span>
                    <input
                      type="text"
                      value={responseWidgetDefinitionExpression}
                      onChange={(event) =>
                        onAgentResponseWidgetDefinitionChange(node.id, event.target.value)
                      }
                      placeholder="Ex. state.widget_json"
                    />
                  </label>
                  <p style={{ color: "var(--text-muted)", margin: "-0.35rem 0 0.35rem" }}>
                    La valeur doit être un objet JSON valide conforme aux spécifications ChatKit Widget.
                  </p>
                  {widgetValidationMessage ? (
                    <p
                      id={`${widgetSelectId}-message`}
                      style={{ color: "#b91c1c", margin: "0.25rem 0 0" }}
                    >
                      {widgetValidationMessage}
                    </p>
                  ) : null}
                </>
              )}
            </>
          )}

      <div
        style={{
          border: "1px solid rgba(15, 23, 42, 0.12)",
          borderRadius: "0.75rem",
          padding: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <strong style={{ fontSize: "0.95rem" }}>Outils</strong>
            <ToggleRow
              label="Activer la recherche web"
              checked={webSearchEnabled}
              onChange={(next) =>
                onAgentWebSearchChange(
                  node.id,
                  next ? webSearchConfig ?? { ...DEFAULT_WEB_SEARCH_CONFIG } : null,
                )
              }
            />
            {webSearchEnabled && (
              <>
                <label style={inlineFieldStyle}>
                  <span style={labelContentStyle}>
                    Portée de la recherche
                    <HelpTooltip label="Définit la quantité de contexte web récupérée pour l'agent." />
                  </span>
                  <select
                    value={webSearchConfig?.search_context_size ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      const nextConfig: WebSearchConfig = { ...(webSearchConfig ?? {}) };
                      if (value) {
                        nextConfig.search_context_size = value;
                      } else {
                        delete nextConfig.search_context_size;
                      }
                      onAgentWebSearchChange(node.id, nextConfig);
                    }}
                  >
                    <option value="">(par défaut)</option>
                    <option value="small">Petit contexte</option>
                    <option value="medium">Contexte moyen</option>
                    <option value="large">Grand contexte</option>
                  </select>
                </label>

                <div style={{ display: "grid", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 600 }}>Localisation utilisateur</span>
                  {Object.entries(WEB_SEARCH_LOCATION_LABELS).map(([key, label]) => {
                    const typedKey = key as keyof typeof WEB_SEARCH_LOCATION_LABELS;
                    const currentValue =
                      (webSearchConfig?.user_location?.[typedKey] as string | undefined) ?? "";
                    return (
                      <label key={key} style={fieldStyle}>
                        <span>{label}</span>
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
                            const nextConfig: WebSearchConfig = { ...(webSearchConfig ?? {}) };
                            if (Object.keys(nextLocation).length > 0) {
                              nextConfig.user_location = nextLocation;
                            } else {
                              delete nextConfig.user_location;
                            }
                            onAgentWebSearchChange(node.id, nextConfig);
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </>
            )}
            <ToggleRow
              label="Activer la recherche documentaire"
              checked={fileSearchEnabled}
              onChange={(next) => {
                if (next) {
                  const preferredSlug =
                    (fileSearchConfig?.vector_store_slug?.trim() ?? "") ||
                    vectorStores[0]?.slug ||
                    "";
                  onAgentFileSearchChange(node.id, {
                    vector_store_slug: preferredSlug,
                  });
                } else {
                  onAgentFileSearchChange(node.id, null);
                }
              }}
            />
            {vectorStoresError ? (
              <p style={{ color: "#b91c1c", margin: 0 }}>{vectorStoresError}</p>
            ) : null}
            {fileSearchEnabled && (
              <>
                {vectorStoresLoading ? (
                  <p style={{ color: "var(--text-muted)", margin: 0 }}>Chargement des vector stores…</p>
                ) : vectorStores.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", margin: 0 }}>
                    Aucun vector store disponible. Créez-en un depuis l'onglet « Vector stores JSON
                    ».
                  </p>
                ) : (
                  <label style={inlineFieldStyle}>
                    <span style={labelContentStyle}>
                      Vector store à interroger
                      <HelpTooltip label="Le document complet du résultat sera transmis à l'agent." />
                    </span>
                    <select
                      value={selectedVectorStoreSlug}
                      onChange={(event) =>
                        onAgentFileSearchChange(node.id, {
                          vector_store_slug: event.target.value,
                        })
                      }
                    >
                      <option value="">Sélectionnez un vector store…</option>
                      {vectorStores.map((store) => (
                        <option key={store.slug} value={store.slug}>
                          {store.title?.trim()
                            ? `${store.title} (${store.slug})`
                            : store.slug}
                        </option>
                      ))}
                    </select>
                    {fileSearchValidationMessage && (
                      <p style={{ color: "#b91c1c", margin: 0 }}>{fileSearchValidationMessage}</p>
                    )}
                  </label>
                )}
              </>
            )}
            <ToggleRow
              label="Activer la génération d'image"
              checked={imageGenerationEnabled}
              onChange={(next) =>
                onAgentImageGenerationChange(
                  node.id,
                  next ? { ...DEFAULT_IMAGE_TOOL_CONFIG } : null,
                )
              }
              help="Ajoute l'outil image_generation pour produire des visuels via l'API OpenAI."
            />
            {imageGenerationEnabled && (
              <div
                style={{
                  display: "grid",
                  gap: "0.75rem",
                  border: "1px solid rgba(148, 163, 184, 0.35)",
                  borderRadius: "0.65rem",
                  padding: "0.75rem",
                  backgroundColor: "rgba(226, 232, 240, 0.25)",
                }}
              >
                <label style={inlineFieldStyle}>
                  <span style={labelContentStyle}>
                    Modèle de génération
                    <HelpTooltip label="Sélectionnez le modèle image supporté par l'API OpenAI." />
                  </span>
                  <select
                    value={imageModelValue}
                    onChange={(event) =>
                      updateImageTool({
                        model: event.target.value || DEFAULT_IMAGE_TOOL_CONFIG.model,
                      })
                    }
                  >
                    {IMAGE_TOOL_MODELS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={inlineFieldStyle}>
                  <span style={labelContentStyle}>
                    Taille de sortie
                    <HelpTooltip label="Définit la résolution retournée par l'API." />
                  </span>
                  <select
                    value={imageSizeValue}
                    onChange={(event) =>
                      updateImageTool({
                        size: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">(par défaut)</option>
                    {IMAGE_TOOL_SIZES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={inlineFieldStyle}>
                  <span style={labelContentStyle}>
                    Qualité de rendu
                    <HelpTooltip label="Ajuste la fidélité des images générées." />
                  </span>
                  <select
                    value={imageQualityValue}
                    onChange={(event) =>
                      updateImageTool({
                        quality: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">(par défaut)</option>
                    {IMAGE_TOOL_QUALITIES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={inlineFieldStyle}>
                  <span style={labelContentStyle}>
                    Arrière-plan
                    <HelpTooltip label="Choisissez la transparence de l'image finale." />
                  </span>
                  <select
                    value={imageBackgroundValue}
                    onChange={(event) =>
                      updateImageTool({
                        background: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">(par défaut)</option>
                    {IMAGE_TOOL_BACKGROUNDS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={inlineFieldStyle}>
                  <span style={labelContentStyle}>
                    Format de sortie
                    <HelpTooltip label="Détermine le format MIME restitué par l'outil." />
                  </span>
                  <select
                    value={imageOutputFormatValue}
                    onChange={(event) =>
                      updateImageTool({
                        output_format: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">(par défaut)</option>
                    {IMAGE_TOOL_OUTPUT_FORMATS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div
              style={{
                border: "1px solid rgba(148, 163, 184, 0.35)",
                borderRadius: "0.65rem",
                padding: "0.75rem",
                display: "grid",
                gap: "0.5rem",
                backgroundColor: "rgba(226, 232, 240, 0.25)",
              }}
            >
              <strong style={{ fontSize: "0.9rem" }}>Function tool</strong>
              <ToggleRow
                label="Autoriser la fonction météo Python"
                checked={weatherFunctionEnabled}
                onChange={(next) => onAgentWeatherToolChange(node.id, next)}
                help="Ajoute l'outil fetch_weather pour récupérer la météo via le backend."
              />
            </div>
          </div>
        </>
      )}

      {kind === "json_vector_store" && (
        <>
          <p style={{ color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
            Ce bloc enregistre le JSON produit par le bloc précédent dans le vector store
            sélectionné.
          </p>
          {vectorStoresError ? (
            <p style={{ color: "#b91c1c", margin: "0 0 0.75rem" }}>{vectorStoresError}</p>
          ) : null}
          {vectorStoresLoading ? (
            <p style={{ color: "var(--text-muted)", margin: "0 0 0.75rem" }}>Chargement des vector stores…</p>
          ) : vectorStores.length === 0 ? (
            <p style={{ color: "var(--text-muted)", margin: "0 0 0.75rem" }}>
              Aucun vector store disponible. Créez-en un depuis l'onglet « Vector stores JSON ».
            </p>
          ) : (
            <label style={inlineFieldStyle}>
              <span style={labelContentStyle}>
                Vector store cible
                <HelpTooltip label="Choisissez le magasin JSON dans lequel indexer la réponse structurée." />
              </span>
              <select
                value={vectorStoreNodeSlug}
                onChange={(event) =>
                  onVectorStoreNodeConfigChange(node.id, {
                    vector_store_slug: event.target.value,
                  })
                }
              >
                <option value="">Sélectionnez un vector store…</option>
                {vectorStores.map((store) => (
                  <option key={store.slug} value={store.slug}>
                    {store.title?.trim() ? `${store.title} (${store.slug})` : store.slug}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Expression de l'identifiant du document (facultatif)
              <HelpTooltip label="Laissez vide pour réutiliser la clé doc_id du JSON structuré ou générer un identifiant automatique." />
            </span>
            <input
              type="text"
              value={vectorStoreNodeDocIdExpression}
              onChange={(event) =>
                onVectorStoreNodeConfigChange(node.id, {
                  doc_id_expression: event.target.value,
                })
              }
              placeholder="Ex. input.output_parsed.doc_id"
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Expression JSON à indexer (facultatif)
              <HelpTooltip label="Laissez vide pour indexer automatiquement la sortie structurée du bloc précédent." />
            </span>
            <input
              type="text"
              value={vectorStoreNodeDocumentExpression}
              onChange={(event) =>
                onVectorStoreNodeConfigChange(node.id, {
                  document_expression: event.target.value,
                })
              }
              placeholder="Ex. input.output_parsed"
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelContentStyle}>
              Expression des métadonnées (facultatif)
              <HelpTooltip label="Retourne un objet JSON fusionné avec les métadonnées automatiques du workflow." />
            </span>
            <input
              type="text"
              value={vectorStoreNodeMetadataExpression}
              onChange={(event) =>
                onVectorStoreNodeConfigChange(node.id, {
                  metadata_expression: event.target.value,
                })
              }
              placeholder='Ex. {"source": "workflow"}'
            />
          </label>
          {vectorStoreNodeValidationMessages.map((message, index) => (
            <p key={`vector-store-node-${index}`} style={{ color: "#b91c1c", margin: 0 }}>
              {message}
            </p>
          ))}
        </>
      )}

      {kind === "state" && (
        <>
          <StateAssignmentsPanel
            title="Variables globales"
            description="Définissez des variables disponibles pour l'ensemble du workflow."
            assignments={globalAssignments}
            onChange={(next) => onStateAssignmentsChange(node.id, "globals", next)}
            expressionPlaceholder="Ex. input.output_parsed"
            targetPlaceholder="global.nom_variable"
            addLabel="Ajouter une variable globale"
            emptyLabel="Aucune variable globale n'est définie pour ce nœud."
          />
          <StateAssignmentsPanel
            title="Variables d'état"
            description="Affectez des valeurs aux variables d'état du workflow."
            assignments={stateAssignments}
            onChange={(next) => onStateAssignmentsChange(node.id, "state", next)}
            expressionPlaceholder="Ex. input.output_text"
            targetPlaceholder="state.nom_variable"
            addLabel="Ajouter une variable d'état"
            emptyLabel="Aucune variable d'état n'est configurée pour ce nœud."
          />
        </>
      )}

      {kind === "watch" && (
        <section
          aria-label="Informations du bloc watch"
          style={{
            marginTop: "1rem",
            border: "1px solid rgba(15, 23, 42, 0.12)",
            borderRadius: "0.75rem",
            padding: "0.9rem",
            display: "grid",
            gap: "0.75rem",
          }}
        >
          <header>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Observation du flux</h3>
            <p style={{ margin: "0.25rem 0 0", color: "#475569", fontSize: "0.95rem" }}>
              Ce bloc diffuse dans ChatKit le payload produit par le bloc précédent sous forme de notice
              informative.
            </p>
          </header>
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
            Aucune configuration n'est requise : reliez-le simplement après le bloc dont vous souhaitez
            inspecter la sortie.
          </p>
        </section>
      )}

      </section>
    </>
  );
};


type StateAssignmentsPanelProps = {
  title: string;
  description: string;
  assignments: StateAssignment[];
  onChange: (assignments: StateAssignment[]) => void;
  expressionPlaceholder?: string;
  targetPlaceholder?: string;
  addLabel: string;
  emptyLabel: string;
};

const StateAssignmentsPanel = ({
  title,
  description,
  assignments,
  onChange,
  expressionPlaceholder,
  targetPlaceholder,
  addLabel,
  emptyLabel,
}: StateAssignmentsPanelProps) => {
  const handleAssignmentChange = (
    index: number,
    field: keyof StateAssignment,
    value: string,
  ) => {
    const next = assignments.map((assignment, currentIndex) =>
      currentIndex === index ? { ...assignment, [field]: value } : assignment,
    );
    onChange(next);
  };

  const handleRemoveAssignment = (index: number) => {
    onChange(assignments.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleAddAssignment = () => {
    onChange([...assignments, { expression: "", target: "" }]);
  };

  return (
    <section
      aria-label={title}
      style={{
        marginTop: "1rem",
        border: "1px solid rgba(15, 23, 42, 0.12)",
        borderRadius: "0.75rem",
        padding: "0.75rem",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <header>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>{title}</h3>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.95rem" }}>{description}</p>
      </header>

      {assignments.length === 0 ? (
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>{emptyLabel}</p>
      ) : (
        assignments.map((assignment, index) => (
          <div
            key={`${title}-${index}`}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.35)",
              borderRadius: "0.65rem",
              padding: "0.75rem",
              display: "grid",
              gap: "0.75rem",
            }}
          >
            <label style={fieldStyle}>
              <span style={labelContentStyle}>
                Affecter la valeur
                <HelpTooltip label="Utilisez le langage Common Expression Language pour créer une expression personnalisée." />
              </span>
              <input
                type="text"
                value={assignment.expression}
                placeholder={expressionPlaceholder}
                onChange={(event) =>
                  handleAssignmentChange(index, "expression", event.target.value)
                }
              />
            </label>

            <label style={fieldStyle}>
              <span style={labelContentStyle}>Vers la variable</span>
              <input
                type="text"
                value={assignment.target}
                placeholder={targetPlaceholder}
                onChange={(event) => handleAssignmentChange(index, "target", event.target.value)}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn danger"
                onClick={() => handleRemoveAssignment(index)}
              >
                Supprimer cette affectation
              </button>
            </div>
          </div>
        ))
      )}

      <div>
        <button type="button" className="btn" onClick={handleAddAssignment}>
          {addLabel}
        </button>
      </div>
    </section>
  );
};

type WidgetVariablesPanelProps = {
  assignments: WidgetVariableAssignment[];
  onChange: (assignments: WidgetVariableAssignment[]) => void;
};

type WidgetNodeContentEditorProps = {
  slug: string;
  definition: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
  assignments: WidgetVariableAssignment[];
  onChange: (assignments: WidgetVariableAssignment[]) => void;
};

const formatSampleValue = (sample: string | string[] | null): string => {
  if (Array.isArray(sample)) {
    return sample.join(", ");
  }
  if (typeof sample === "string") {
    return sample;
  }
  return "";
};

const parsePreviewValue = (expression: string): string | string[] | null => {
  const trimmed = expression.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      return parsed;
    }
    if (typeof parsed === "number" || typeof parsed === "boolean") {
      return String(parsed);
    }
    if (Array.isArray(parsed)) {
      const sanitized = parsed
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (typeof entry === "number" || typeof entry === "boolean") {
            return String(entry);
          }
          return null;
        })
        .filter((entry): entry is string => entry !== null);
      return sanitized;
    }
    return null;
  } catch (error) {
    return trimmed;
  }
};

const WidgetNodeContentEditor = ({
  slug,
  definition,
  loading,
  error,
  assignments,
  onChange,
}: WidgetNodeContentEditorProps) => {
  const trimmedSlug = slug.trim();
  const bindings = useMemo(() => (definition ? collectWidgetBindings(definition) : {}), [definition]);
  const bindingEntries = useMemo(
    () => Object.entries(bindings).sort(([a], [b]) => a.localeCompare(b)),
    [bindings],
  );
  const assignmentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const assignment of assignments) {
      map.set(assignment.identifier, assignment.expression);
    }
    return map;
  }, [assignments]);
  const sampleValues = useMemo(() => {
    if (!definition) {
      return {} as Record<string, string | string[]>;
    }
    return buildWidgetInputSample(definition, bindings);
  }, [bindings, definition]);
  const previewValues = useMemo(() => {
    const values: Record<string, string | string[]> = { ...sampleValues };
    assignmentMap.forEach((expression, identifier) => {
      const parsed = parsePreviewValue(expression);
      if (parsed === null) {
        delete values[identifier];
      } else {
        values[identifier] = parsed;
      }
    });
    return values;
  }, [assignmentMap, sampleValues]);
  const previewDefinition = useMemo(() => {
    if (!definition) {
      return null;
    }
    return applyWidgetInputValues(definition, previewValues, bindings);
  }, [bindings, definition, previewValues]);

  const handleBindingChange = (identifier: string, value: string) => {
    const existingIndex = assignments.findIndex((assignment) => assignment.identifier === identifier);
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      if (existingIndex === -1) {
        return;
      }
      const next = assignments.filter((_, index) => index !== existingIndex);
      onChange(next);
      return;
    }
    if (existingIndex === -1) {
      onChange([...assignments, { identifier, expression: normalizedValue }]);
      return;
    }
    const next = assignments.map((assignment, index) =>
      index === existingIndex ? { ...assignment, expression: normalizedValue } : assignment,
    );
    onChange(next);
  };

  if (!trimmedSlug) {
    return null;
  }

  return (
    <section
      aria-label="Contenu du widget"
      style={{
        marginTop: "0.75rem",
        border: "1px solid rgba(15, 23, 42, 0.12)",
        borderRadius: "0.75rem",
        padding: "0.75rem",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <header>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Contenu du widget</h3>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.95rem" }}>
          Modifiez les textes diffusés par ce bloc. Les valeurs sont enregistrées dans les propriétés du workflow.
        </p>
      </header>
      {loading ? (
        <p style={{ margin: 0, color: "var(--text-muted)" }}>Chargement de la prévisualisation…</p>
      ) : error ? (
        <p style={{ margin: 0, color: "#b91c1c" }}>
          Impossible de récupérer le widget « {trimmedSlug} ». {error}
        </p>
      ) : !definition ? (
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          Sélectionnez un widget dans la bibliothèque pour personnaliser son contenu.
        </p>
      ) : (
        <>
          <div
            style={{
              border: "1px solid rgba(15, 23, 42, 0.12)",
              borderRadius: "0.65rem",
              padding: "0.75rem",
              background: "#f8fafc",
            }}
          >
            <WidgetPreview definition={previewDefinition ?? definition} />
          </div>
          {bindingEntries.length > 0 ? (
            bindingEntries.map(([identifier, binding]) => {
              const label = binding.componentType
                ? `${identifier} (${binding.componentType})`
                : identifier;
              const placeholder = formatSampleValue(binding.sample);
              return (
                <label key={identifier} style={fieldStyle}>
                  <span style={labelContentStyle}>{label}</span>
                  <input
                    type="text"
                    value={assignmentMap.get(identifier) ?? ""}
                    onChange={(event) => handleBindingChange(identifier, event.target.value)}
                    placeholder={placeholder ? `Ex. ${placeholder}` : undefined}
                  />
                </label>
              );
            })
          ) : (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              Ce widget n'expose aucun texte modifiable. Il sera diffusé tel que défini dans la bibliothèque.
            </p>
          )}
        </>
      )}
    </section>
  );
};

const WidgetVariablesPanel = ({ assignments, onChange }: WidgetVariablesPanelProps) => {
  const handleAssignmentChange = (
    index: number,
    field: keyof WidgetVariableAssignment,
    value: string,
  ) => {
    const next = assignments.map((assignment, currentIndex) =>
      currentIndex === index ? { ...assignment, [field]: value } : assignment,
    );
    onChange(next);
  };

  const handleRemoveAssignment = (index: number) => {
    onChange(assignments.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleAddAssignment = () => {
    onChange([...assignments, { identifier: "", expression: "" }]);
  };

  return (
    <section
      aria-label="Variables de widget"
      style={{
        marginTop: "1rem",
        border: "1px solid rgba(15, 23, 42, 0.12)",
        borderRadius: "0.75rem",
        padding: "0.75rem",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <header>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Variables de widget</h3>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.95rem" }}>
          Associez les identifiants du widget aux expressions évaluées lors de l'exécution.
        </p>
      </header>

      {assignments.length === 0 ? (
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
          Aucune variable dynamique n'est configurée pour ce widget.
        </p>
      ) : (
        assignments.map((assignment, index) => (
          <div
            key={`widget-variable-${index}`}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.35)",
              borderRadius: "0.65rem",
              padding: "0.75rem",
              display: "grid",
              gap: "0.75rem",
            }}
          >
            <label style={fieldStyle}>
              <span style={labelContentStyle}>
                Identifiant du widget
                <HelpTooltip label="Correspond aux attributs id, name ou aux zones éditables du widget." />
              </span>
              <input
                type="text"
                value={assignment.identifier}
                placeholder="Ex. title"
                onChange={(event) =>
                  handleAssignmentChange(index, "identifier", event.target.value)
                }
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelContentStyle}>
                Expression associée
                <HelpTooltip label="Utilisez state. ou input. pour référencer les données du workflow." />
              </span>
              <input
                type="text"
                value={assignment.expression}
                placeholder="Ex. input.output_parsed.titre"
                onChange={(event) =>
                  handleAssignmentChange(index, "expression", event.target.value)
                }
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn danger"
                onClick={() => handleRemoveAssignment(index)}
              >
                Supprimer la variable
              </button>
            </div>
          </div>
        ))
      )}

      <div>
        <button type="button" className="btn" onClick={handleAddAssignment}>
          Ajouter une variable
        </button>
      </div>
    </section>
  );
};

const labelContentStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.35rem",
  fontWeight: 600,
  color: "var(--color-text-strong)",
};

const inspectorHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  marginBottom: "1rem",
};

const inspectorTitleStyle: CSSProperties = {
  fontSize: "1rem",
  fontWeight: 700,
  color: "var(--color-text-strong)",
};

const inspectorSubtitleStyle: CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--text-muted)",
};

const deleteButtonStyle: CSSProperties = {
  border: "1px solid rgba(220, 38, 38, 0.25)",
  backgroundColor: "rgba(220, 38, 38, 0.12)",
  color: "#b91c1c",
  borderRadius: "9999px",
  padding: "0.35rem",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxShadow: "0 6px 14px rgba(220, 38, 38, 0.2)",
  transition: "background-color 150ms ease, transform 150ms ease",
};

const deleteButtonIconStyle: CSSProperties = {
  width: "1.1rem",
  height: "1.1rem",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  marginTop: "0.75rem",
};

const inlineFieldStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: "0.75rem",
  marginTop: "0.75rem",
};

const toggleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
};

const helpTooltipContainerStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
};

const helpTooltipButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.35rem",
  height: "1.35rem",
  borderRadius: "9999px",
  border: "1px solid var(--surface-border)",
  backgroundColor: "var(--surface-color)",
  color: "var(--text-color)",
  fontSize: "0.8rem",
  fontWeight: 700,
  cursor: "pointer",
  transition: "background-color 150ms ease, transform 150ms ease",
};

const helpTooltipButtonActiveStyle: CSSProperties = {
  backgroundColor: "#2563eb",
  borderColor: "rgba(37, 99, 235, 0.7)",
  color: "#ffffff",
};

const helpTooltipBubbleStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 0.5rem)",
  right: 0,
  zIndex: 10,
  maxWidth: "18rem",
  padding: "0.65rem 0.75rem",
  borderRadius: "0.75rem",
  backgroundColor: "var(--text-color)",
  color: "var(--main-background)",
  fontSize: "0.8rem",
  lineHeight: 1.4,
  boxShadow: "var(--shadow-card)",
};

const helpTooltipBubbleHiddenStyle: CSSProperties = {
  opacity: 0,
  transform: "translateY(-4px)",
  pointerEvents: "none",
};

const helpTooltipBubbleVisibleStyle: CSSProperties = {
  opacity: 1,
  transform: "translateY(0)",
};

const switchBaseStyle: CSSProperties = {
  position: "relative",
  width: "2.75rem",
  height: "1.5rem",
  borderRadius: "9999px",
  border: "none",
  padding: 0,
  backgroundColor: "rgba(148, 163, 184, 0.45)",
  cursor: "pointer",
  transition: "background-color 150ms ease",
};

const switchCheckedStyle: CSSProperties = {
  backgroundColor: "#2563eb",
};

const switchDisabledStyle: CSSProperties = {
  cursor: "not-allowed",
  opacity: 0.6,
};

const getSwitchThumbStyle = (checked: boolean): CSSProperties => ({
  position: "absolute",
  top: "50%",
  left: "0.25rem",
  width: "1.15rem",
  height: "1.15rem",
  borderRadius: "9999px",
  backgroundColor: "#fff",
  boxShadow: "0 2px 6px rgba(15, 23, 42, 0.25)",
  transform: `translate(${checked ? "1.2rem" : "0"}, -50%)`,
  transition: "transform 150ms ease",
});

const TrashIcon = () => (
  <svg
    style={deleteButtonIconStyle}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M9 3h6a1 1 0 0 1 1 1v1h4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5 5h14l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M10 10v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M14 10v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const HelpTooltip = ({ label }: { label: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleBlur = () => {
    requestAnimationFrame(() => {
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        setIsOpen(false);
      }
    });
  };

  return (
    <span ref={containerRef} style={helpTooltipContainerStyle}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={tooltipId}
        onClick={() => setIsOpen((value) => !value)}
        onBlur={handleBlur}
        style={{
          ...helpTooltipButtonStyle,
          ...(isOpen ? helpTooltipButtonActiveStyle : {}),
        }}
      >
        ?
      </button>
      <span
        role="tooltip"
        id={tooltipId}
        aria-hidden={!isOpen}
        style={{
          ...helpTooltipBubbleStyle,
          ...(isOpen ? helpTooltipBubbleVisibleStyle : helpTooltipBubbleHiddenStyle),
        }}
      >
        {label}
      </span>
    </span>
  );
};

type ToggleSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
};

const ToggleSwitch = ({ checked, onChange, disabled, ariaLabel, ariaDescribedBy }: ToggleSwitchProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    aria-describedby={ariaDescribedBy}
    onClick={() => {
      if (!disabled) {
        onChange(!checked);
      }
    }}
    disabled={disabled}
    style={{
      ...switchBaseStyle,
      ...(checked ? switchCheckedStyle : {}),
      ...(disabled ? switchDisabledStyle : {}),
    }}
  >
    <span style={getSwitchThumbStyle(checked)} />
  </button>
);

type ToggleRowProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  help?: string;
};

const ToggleRow = ({ label, checked, onChange, disabled, help }: ToggleRowProps) => {
  const describedById = help ? `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-help` : undefined;
  return (
    <div style={toggleRowStyle}>
      <span style={labelContentStyle} id={describedById}>
        {label}
        {help ? <HelpTooltip label={help} /> : null}
      </span>
      <ToggleSwitch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={label}
        ariaDescribedBy={describedById}
      />
    </div>
  );
};

export default NodeInspector;
