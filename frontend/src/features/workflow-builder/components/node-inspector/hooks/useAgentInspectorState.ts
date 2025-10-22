import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  widgetLibraryApi,
  type AvailableModel,
  type VectorStoreSummary,
  type WidgetTemplateSummary,
} from "../../../../../utils/backend";
import {
  getAgentContinueOnError,
  getAgentDisplayResponseInChat,
  getAgentFileSearchConfig,
  getAgentImageGenerationConfig,
  getAgentIncludeChatHistory,
  getAgentMaxOutputTokens,
  getAgentMessage,
  getAgentModel,
  getAgentReasoningEffort,
  getAgentReasoningSummary,
  getAgentResponseFormat,
  getAgentShowSearchSources,
  getAgentStorePreference,
  getAgentTemperature,
  getAgentTextVerbosity,
  getAgentTopP,
  getAgentWeatherToolEnabled,
  getAgentWebSearchConfig,
  getAgentWidgetValidationToolEnabled,
} from "../../../../../utils/workflows";
import type {
  FlowNode,
  ImageGenerationToolConfig,
  WebSearchConfig,
} from "../../../types";
import {
  DEFAULT_IMAGE_TOOL_CONFIG,
  DEFAULT_JSON_SCHEMA_TEXT,
  isTestEnvironment,
} from "../constants";

const DEFAULT_SCHEMA_TEXT = DEFAULT_JSON_SCHEMA_TEXT;

type UseAgentInspectorStateParams = {
  nodeId: string;
  parameters: FlowNode["data"]["parameters"];
  token: string | null;
  widgets: WidgetTemplateSummary[];
  widgetsLoading: boolean;
  widgetsError: string | null;
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  availableModels: AvailableModel[];
  isReasoningModel: (model: string) => boolean;
  onAgentImageGenerationChange: (
    nodeId: string,
    config: ImageGenerationToolConfig | null,
  ) => void;
};

type AgentInspectorState = {
  agentMessage: string;
  agentModel: string;
  reasoningEffort: string;
  reasoningSummaryValue: string;
  textVerbosityValue: string;
  responseFormat: ReturnType<typeof getAgentResponseFormat>;
  temperatureValue: string;
  topPValue: string;
  maxOutputTokensValue: string;
  includeChatHistory: boolean;
  displayResponseInChat: boolean;
  showSearchSources: boolean;
  continueOnError: boolean;
  storeResponses: boolean;
  webSearchConfig: WebSearchConfig | null;
  webSearchEnabled: boolean;
  fileSearchConfig: ReturnType<typeof getAgentFileSearchConfig>;
  fileSearchEnabled: boolean;
  fileSearchValidationMessage: string | null;
  imageGenerationConfig: ImageGenerationToolConfig | null;
  imageGenerationEnabled: boolean;
  imageModelValue: string;
  imageSizeValue: string;
  imageQualityValue: string;
  imageBackgroundValue: string;
  imageOutputFormatValue: string;
  updateImageTool: (updates: Partial<ImageGenerationToolConfig>) => void;
  weatherFunctionEnabled: boolean;
  widgetValidationFunctionEnabled: boolean;
  selectedVectorStoreSlug: string;
  matchedModel: AvailableModel | undefined;
  selectedModelOption: string;
  supportsReasoning: boolean;
  schemaText: string;
  setSchemaText: (value: string) => void;
  schemaError: string | null;
  setSchemaError: (value: string | null) => void;
  responseWidgetSource: "library" | "variable";
  responseWidgetSlug: string;
  trimmedWidgetSlug: string;
  responseWidgetDefinitionExpression: string;
  widgetSelectValue: string;
  widgetValidationMessage: string | null;
  responseWidgetDefinition: Record<string, unknown> | null;
  responseWidgetDefinitionLoading: boolean;
  responseWidgetDefinitionError: string | null;
};

export const useAgentInspectorState = ({
  nodeId,
  parameters,
  token,
  widgets,
  widgetsLoading,
  widgetsError,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
  availableModels,
  isReasoningModel,
  onAgentImageGenerationChange,
}: UseAgentInspectorStateParams): AgentInspectorState => {
  const agentMessage = getAgentMessage(parameters);
  const agentModel = getAgentModel(parameters);
  const reasoningEffort = getAgentReasoningEffort(parameters);
  const textVerbosity = getAgentTextVerbosity(parameters).trim();
  const responseFormat = getAgentResponseFormat(parameters);
  const temperature = getAgentTemperature(parameters);
  const topP = getAgentTopP(parameters);
  const rawReasoningSummary = getAgentReasoningSummary(parameters);
  const reasoningSummaryValue = rawReasoningSummary.trim() ? rawReasoningSummary : "none";
  const textVerbosityValue = textVerbosity || "";
  const maxOutputTokens = getAgentMaxOutputTokens(parameters);
  const maxOutputTokensValue = typeof maxOutputTokens === "number" ? String(maxOutputTokens) : "";
  const includeChatHistory = getAgentIncludeChatHistory(parameters);
  const displayResponseInChat = getAgentDisplayResponseInChat(parameters);
  const showSearchSources = getAgentShowSearchSources(parameters);
  const continueOnError = getAgentContinueOnError(parameters);
  const storeResponses = getAgentStorePreference(parameters);
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

  const updateImageTool = useCallback(
    (updates: Partial<ImageGenerationToolConfig>) => {
      const base = imageGenerationConfig ?? DEFAULT_IMAGE_TOOL_CONFIG;
      const draft: Partial<ImageGenerationToolConfig> = { ...base, ...updates };
      const normalized: ImageGenerationToolConfig = {
        model: draft.model?.trim() || DEFAULT_IMAGE_TOOL_CONFIG.model,
      };

      const normalizedSize = draft.size?.toString().trim();
      if (normalizedSize) {
        normalized.size = normalizedSize;
      }

      const normalizedQuality = draft.quality?.toString().trim();
      if (normalizedQuality) {
        normalized.quality = normalizedQuality;
      }

      const normalizedBackground = draft.background?.toString().trim();
      if (normalizedBackground) {
        normalized.background = normalizedBackground;
      }

      const normalizedOutput = draft.output_format?.toString().trim();
      if (normalizedOutput) {
        normalized.output_format = normalizedOutput;
      }

      onAgentImageGenerationChange(nodeId, normalized);
    },
    [imageGenerationConfig, nodeId, onAgentImageGenerationChange],
  );

  const weatherFunctionEnabled = getAgentWeatherToolEnabled(parameters);
  const widgetValidationFunctionEnabled = getAgentWidgetValidationToolEnabled(parameters);

  const selectedVectorStoreSlug = fileSearchConfig?.vector_store_slug ?? "";
  const trimmedVectorStoreSlug = selectedVectorStoreSlug.trim();
  const selectedVectorStoreExists =
    trimmedVectorStoreSlug.length > 0 &&
    vectorStores.some((store) => store.slug === trimmedVectorStoreSlug);

  const fileSearchMissingVectorStore =
    fileSearchEnabled &&
    (!trimmedVectorStoreSlug ||
      (!vectorStoresError && vectorStores.length > 0 && !selectedVectorStoreExists));

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
    if (responseFormat.kind !== "widget" || responseWidgetSource !== "library") {
      return null;
    }

    if (!trimmedWidgetSlug) {
      return null;
    }

    return widgets.find((widget) => widget.slug === trimmedWidgetSlug) ?? null;
  }, [responseFormat.kind, responseWidgetSource, trimmedWidgetSlug, widgets]);

  const selectedWidgetExists =
    responseFormat.kind === "widget" &&
    responseWidgetSource === "library" &&
    trimmedWidgetSlug.length > 0 &&
    Boolean(selectedWidget);

  const [responseWidgetDefinition, setResponseWidgetDefinition] =
    useState<Record<string, unknown> | null>(null);
  const [responseWidgetDefinitionLoading, setResponseWidgetDefinitionLoading] = useState(false);
  const [responseWidgetDefinitionError, setResponseWidgetDefinitionError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (
      responseFormat.kind !== "widget" ||
      responseWidgetSource !== "library" ||
      !trimmedWidgetSlug ||
      !token ||
      isTestEnvironment
    ) {
      setResponseWidgetDefinition(null);
      setResponseWidgetDefinitionError(null);
      setResponseWidgetDefinitionLoading(false);
      return;
    }

    let isCancelled = false;
    setResponseWidgetDefinitionLoading(true);
    setResponseWidgetDefinitionError(null);

    widgetLibraryApi
      .getWidget(token, trimmedWidgetSlug)
      .then((widget) => {
        if (isCancelled) {
          return;
        }
        setResponseWidgetDefinition(widget.definition);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        setResponseWidgetDefinition(null);
        setResponseWidgetDefinitionError(
          error instanceof Error ? error.message : "Impossible de charger le widget sélectionné.",
        );
      })
      .finally(() => {
        if (!isCancelled) {
          setResponseWidgetDefinitionLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    responseFormat.kind,
    responseWidgetSource,
    trimmedWidgetSlug,
    token,
  ]);

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
      widgetValidationMessage =
        "Le widget sélectionné n'est plus disponible. Choisissez-en un autre.";
    }
  } else if (responseFormat.kind === "widget" && responseWidgetSource === "variable") {
    if (!responseWidgetDefinitionExpression.trim()) {
      widgetValidationMessage =
        "Renseignez une expression qui retourne le JSON du widget (ex. state.widget_json).";
    }
  }

  const widgetSelectValue =
    responseWidgetSource === "library" && selectedWidgetExists ? trimmedWidgetSlug : "";

  const matchedModel = availableModels.find((model) => model.name === agentModel);
  const selectedModelOption = matchedModel ? matchedModel.name : "";
  const supportsReasoning = isReasoningModel(agentModel);
  const temperatureValue = typeof temperature === "number" ? String(temperature) : "";
  const topPValue = typeof topP === "number" ? String(topP) : "";

  const [schemaText, setSchemaText] = useState(() => {
    if (responseFormat.kind === "json_schema") {
      return JSON.stringify(responseFormat.schema ?? {}, null, 2);
    }
    return DEFAULT_SCHEMA_TEXT;
  });
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const schemaSignature =
    responseFormat.kind === "json_schema"
      ? JSON.stringify(responseFormat.schema ?? {})
      : "";

  useEffect(() => {
    if (responseFormat.kind === "json_schema") {
      setSchemaText(JSON.stringify(responseFormat.schema ?? {}, null, 2));
    } else {
      setSchemaText(DEFAULT_SCHEMA_TEXT);
    }
    setSchemaError(null);
  }, [nodeId, responseFormat.kind, schemaSignature]);

  return {
    agentMessage,
    agentModel,
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
    imageGenerationConfig,
    imageGenerationEnabled,
    imageModelValue,
    imageSizeValue,
    imageQualityValue,
    imageBackgroundValue,
    imageOutputFormatValue,
    updateImageTool,
    weatherFunctionEnabled,
    widgetValidationFunctionEnabled,
    selectedVectorStoreSlug,
    matchedModel,
    selectedModelOption,
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
    widgetValidationMessage,
    responseWidgetDefinition,
    responseWidgetDefinitionLoading,
    responseWidgetDefinitionError,
  };
};
