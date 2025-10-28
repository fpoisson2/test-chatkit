import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  testMcpToolConnection,
  startMcpOAuthNegotiation,
  pollMcpOAuthSession,
  cancelMcpOAuthSession,
  type AvailableModel,
  type HostedWorkflowMetadata,
  type VectorStoreSummary,
  type WidgetTemplateSummary,
} from "../../../../../utils/backend";
import { collectWidgetBindings } from "../../../../../utils/widgetPreview";
import { useI18n } from "../../../../../i18n";
import type {
  AgentNestedWorkflowSelection,
  ComputerUseConfig,
  FileSearchConfig,
  FlowNode,
  ImageGenerationToolConfig,
  WebSearchConfig,
  WorkflowSummary,
  McpSseToolConfig,
} from "../../../types";
import {
  DEFAULT_IMAGE_TOOL_CONFIG,
  DEFAULT_WEB_SEARCH_CONFIG,
  DEFAULT_COMPUTER_USE_CONFIG,
  COMPUTER_USE_ENVIRONMENTS,
  IMAGE_TOOL_BACKGROUNDS,
  IMAGE_TOOL_MODELS,
  IMAGE_TOOL_OUTPUT_FORMATS,
  IMAGE_TOOL_QUALITIES,
  IMAGE_TOOL_SIZES,
  WEB_SEARCH_LOCATION_LABELS,
  reasoningEffortOptions,
  reasoningSummaryOptions,
  textVerbosityOptions,
} from "../constants";
import { useAgentInspectorState } from "../hooks/useAgentInspectorState";
import { HelpTooltip } from "../components/HelpTooltip";
import { ToggleRow } from "../components/ToggleRow";
import styles from "../NodeInspector.module.css";
import { ToolSettingsPanel } from "./ToolSettingsPanel";

const normalizeHostedWorkflowKey = (value: string): string =>
  value.trim().toLowerCase();

type AgentInspectorSectionProps = {
  nodeId: string;
  parameters: FlowNode["data"]["parameters"];
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
    kind: "text" | "json_schema" | "widget",
  ) => void;
  onAgentResponseFormatNameChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatSchemaChange: (nodeId: string, schema: unknown) => void;
  onAgentResponseWidgetSlugChange: (nodeId: string, slug: string) => void;
  onAgentResponseWidgetSourceChange: (
    nodeId: string,
    source: "library" | "variable",
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
  onAgentMcpSseConfigChange: (
    nodeId: string,
    config: McpSseToolConfig | null,
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

export const AgentInspectorSection = ({
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
  onAgentMcpSseConfigChange,
  onAgentWeatherToolChange,
  onAgentWidgetValidationToolChange,
  onAgentWorkflowValidationToolChange,
  onAgentWorkflowToolToggle,
}: AgentInspectorSectionProps) => {
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
    widgetValidationMessage,
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

  const handleProviderChange = useCallback(
    (value: string) => {
      if (!value) {
        onAgentProviderChange(nodeId, {
          providerId: null,
          providerSlug: null,
        });
        return;
      }
      const option = providerOptions.find(
        (candidate) => candidate.value === value,
      );
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
          model: "",
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
    },
    [nodeId, onAgentModelChange],
  );

  const { t } = useI18n();
  const handleTestMcpSseConnection = useCallback(
    (config: McpSseToolConfig) => testMcpToolConnection(token ?? null, config),
    [token],
  );
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
  const storePreferenceLocked = matchedModel?.store === false;
  const resolvedStoreResponses = storePreferenceLocked ? false : storeResponses;
  const widgetSelectId = useId();
  const nestedWorkflowLabelId = useId();
  const nestedWorkflowModeName = `${nestedWorkflowLabelId}-mode`;
  const localModeOptionId = `${nestedWorkflowLabelId}-local`;
  const hostedModeOptionId = `${nestedWorkflowLabelId}-hosted`;
  const customModeOptionId = `${nestedWorkflowLabelId}-custom`;
  const localWorkflowSelectId = `${nestedWorkflowLabelId}-select`;
  const hostedWorkflowIdFieldId = `${nestedWorkflowLabelId}-hosted-id`;

  const parseDimension = (value: string, fallback: number): number => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, 4096);
    }
    return fallback;
  };

  const handleComputerUseFieldChange = (updates: {
    display_width?: string;
    display_height?: string;
    environment?: string;
    start_url?: string;
  }) => {
    const base = computerUseConfig ?? { ...DEFAULT_COMPUTER_USE_CONFIG };
    const nextWidth = parseDimension(
      updates.display_width ?? computerUseDisplayWidthValue,
      base.display_width,
    );
    const nextHeight = parseDimension(
      updates.display_height ?? computerUseDisplayHeightValue,
      base.display_height,
    );
    const envCandidate = (updates.environment ?? computerUseEnvironmentValue)
      .trim()
      .toLowerCase();
    const normalizedEnvironment = COMPUTER_USE_ENVIRONMENTS.includes(
      envCandidate as (typeof COMPUTER_USE_ENVIRONMENTS)[number],
    )
      ? (envCandidate as ComputerUseConfig["environment"])
      : base.environment;
    const startUrlCandidate = updates.start_url ?? computerUseStartUrlValue;
    const payload: ComputerUseConfig = {
      display_width: nextWidth,
      display_height: nextHeight,
      environment: normalizedEnvironment,
    };
    const trimmedUrl = startUrlCandidate.trim();
    if (trimmedUrl) {
      payload.start_url = trimmedUrl;
    }
    onAgentComputerUseChange(nodeId, payload);
  };

  const availableNestedWorkflows = useMemo(
    () => workflows.filter((workflow) => workflow.id !== currentWorkflowId),
    [workflows, currentWorkflowId],
  );

  const hostedWorkflowMap = useMemo(() => {
    const map = new Map<string, HostedWorkflowMetadata>();
    for (const workflow of hostedWorkflows) {
      map.set(normalizeHostedWorkflowKey(workflow.id), workflow);
      map.set(normalizeHostedWorkflowKey(workflow.slug), workflow);
    }
    return map;
  }, [hostedWorkflows]);

  const findHostedWorkflow = useCallback(
    (value: string): HostedWorkflowMetadata | null => {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      return hostedWorkflowMap.get(normalizeHostedWorkflowKey(trimmed)) ?? null;
    },
    [hostedWorkflowMap],
  );

  const [workflowMode, setWorkflowMode] = useState(nestedWorkflowMode);
  const [localWorkflowIdValue, setLocalWorkflowIdValue] = useState(
    nestedWorkflowMode === "local" && nestedWorkflowId != null
      ? String(nestedWorkflowId)
      : "",
  );
  const [hostedWorkflowIdInput, setHostedWorkflowIdInput] = useState(
    nestedWorkflowMode === "hosted"
      ? nestedWorkflowId != null
        ? String(nestedWorkflowId)
        : nestedWorkflowSlug.trim()
      : "",
  );
  const [hostedWorkflowSlugValue, setHostedWorkflowSlugValue] = useState(
    nestedWorkflowMode === "hosted" ? nestedWorkflowSlug : "",
  );
  const nestedWorkflowReference = useRef({
    id: nestedWorkflowId,
    slug: nestedWorkflowSlug,
  });

  useEffect(() => {
    const previous = nestedWorkflowReference.current;
    if (
      previous.id === nestedWorkflowId &&
      previous.slug === nestedWorkflowSlug
    ) {
      return;
    }

    nestedWorkflowReference.current = {
      id: nestedWorkflowId,
      slug: nestedWorkflowSlug,
    };

    setWorkflowMode(nestedWorkflowMode);

    if (nestedWorkflowMode === "local") {
      setLocalWorkflowIdValue(
        nestedWorkflowId != null ? String(nestedWorkflowId) : "",
      );
      return;
    }

    if (nestedWorkflowMode === "custom") {
      setLocalWorkflowIdValue("");
      setHostedWorkflowIdInput("");
      setHostedWorkflowSlugValue("");
      return;
    }

    const matchedHosted =
      nestedWorkflowId != null
        ? findHostedWorkflow(String(nestedWorkflowId))
        : nestedWorkflowSlug
          ? findHostedWorkflow(nestedWorkflowSlug)
          : null;

    const nextHostedIdValue = matchedHosted
      ? String(matchedHosted.id)
      : nestedWorkflowId != null
        ? String(nestedWorkflowId)
        : "";
    setHostedWorkflowIdInput(nextHostedIdValue);
    setHostedWorkflowSlugValue(
      matchedHosted?.slug ?? nestedWorkflowSlug.trim(),
    );
  }, [
    findHostedWorkflow,
    nestedWorkflowId,
    nestedWorkflowMode,
    nestedWorkflowSlug,
  ]);

  const parseWorkflowId = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return null;
  };

  const emitNestedWorkflowChange = (
    mode: "local" | "hosted" | "custom",
    idValue: string,
    slugValue: string,
  ) => {
    if (mode === "custom") {
      onAgentNestedWorkflowChange(nodeId, {
        mode: "custom",
        workflowId: null,
        workflowSlug: "",
      });
      return;
    }

    const parsedId = parseWorkflowId(idValue);
    let slug = slugValue.trim();
    if (mode === "local") {
      const workflow =
        parsedId != null
          ? availableNestedWorkflows.find((item) => item.id === parsedId)
          : null;
      slug = workflow?.slug ?? "";
    }

    onAgentNestedWorkflowChange(nodeId, {
      mode,
      workflowId: parsedId,
      workflowSlug: slug,
    });
  };

  const handleWorkflowModeChange = (mode: "local" | "hosted" | "custom") => {
    setWorkflowMode(mode);
    if (mode === "custom") {
      emitNestedWorkflowChange("custom", "", "");
      return;
    }
    if (mode === "local") {
      emitNestedWorkflowChange("local", localWorkflowIdValue, "");
      return;
    }

    const candidateSlugFromLocal = (() => {
      const parsed = parseWorkflowId(localWorkflowIdValue);
      const workflow =
        parsed != null
          ? availableNestedWorkflows.find((item) => item.id === parsed)
          : null;
      return workflow?.slug ?? "";
    })();

    const trimmedHostedId = hostedWorkflowIdInput.trim();
    const trimmedHostedSlug = hostedWorkflowSlugValue.trim();
    const trimmedNestedSlug = nestedWorkflowSlug.trim();
    const matchCandidates = [
      trimmedHostedId,
      trimmedHostedSlug,
      trimmedNestedSlug,
      candidateSlugFromLocal,
    ];
    const matchedHosted =
      matchCandidates
        .map((candidate) => (candidate ? findHostedWorkflow(candidate) : null))
        .find((entry): entry is HostedWorkflowMetadata => Boolean(entry)) ??
      null;

    const nextIdValue = (matchedHosted?.id ?? trimmedHostedId) || "";
    const nextSlugValue =
      (matchedHosted?.slug ??
        trimmedHostedSlug ??
        candidateSlugFromLocal ??
        trimmedNestedSlug) ||
      "";

    if (nextIdValue !== hostedWorkflowIdInput) {
      setHostedWorkflowIdInput(nextIdValue);
    }
    if (nextSlugValue !== hostedWorkflowSlugValue) {
      setHostedWorkflowSlugValue(nextSlugValue);
    }

    emitNestedWorkflowChange("hosted", nextIdValue, nextSlugValue);
  };

  const handleLocalWorkflowChange = (value: string) => {
    setLocalWorkflowIdValue(value);
    if (workflowMode === "local") {
      emitNestedWorkflowChange("local", value, "");
    }
  };

  const handleHostedWorkflowSelectChange = (value: string) => {
    if (value === "__loading__" || value === "__empty__") {
      return;
    }
    setHostedWorkflowIdInput(value);
    const matched = findHostedWorkflow(value);
    const nextSlug = matched?.slug ?? hostedWorkflowSlugValue;
    if (matched?.slug && matched.slug !== hostedWorkflowSlugValue) {
      setHostedWorkflowSlugValue(matched.slug);
    }
    if (workflowMode === "hosted") {
      emitNestedWorkflowChange("hosted", value, nextSlug);
    }
  };

  const selectedNestedWorkflow = useMemo(() => {
    if (nestedWorkflowId == null) {
      return null;
    }
    return (
      availableNestedWorkflows.find(
        (workflow) => workflow.id === nestedWorkflowId,
      ) ?? null
    );
  }, [availableNestedWorkflows, nestedWorkflowId]);

  const selectedHostedWorkflow = useMemo(() => {
    if (workflowMode !== "hosted") {
      return null;
    }
    return (
      findHostedWorkflow(hostedWorkflowIdInput) ??
      findHostedWorkflow(hostedWorkflowSlugValue) ??
      findHostedWorkflow(
        nestedWorkflowId != null ? String(nestedWorkflowId) : "",
      ) ??
      findHostedWorkflow(nestedWorkflowSlug)
    );
  }, [
    findHostedWorkflow,
    hostedWorkflowIdInput,
    hostedWorkflowSlugValue,
    nestedWorkflowId,
    nestedWorkflowSlug,
    workflowMode,
  ]);

  const nestedWorkflowMissing =
    workflowMode === "local" &&
    nestedWorkflowId != null &&
    !selectedNestedWorkflow;

  const hostedSlugInfoValue =
    hostedWorkflowSlugValue.trim() || nestedWorkflowSlug.trim();
  const showHostedSlugInfo =
    workflowMode === "hosted" &&
    nestedWorkflowId == null &&
    hostedSlugInfoValue.length > 0;

  const localWorkflowSelected =
    workflowMode === "local" && localWorkflowIdValue.trim().length > 0;
  const hostedWorkflowSelected =
    workflowMode === "hosted" &&
    (hostedWorkflowIdInput.trim().length > 0 ||
      hostedWorkflowSlugValue.trim().length > 0);
  const hasNestedWorkflowSelection =
    localWorkflowSelected || hostedWorkflowSelected;
  const showNestedWorkflowDetails = workflowMode !== "custom";

  const nestedWorkflowSummaryLabel = useMemo(() => {
    if (!hasNestedWorkflowSelection) {
      return null;
    }
    if (workflowMode === "local") {
      const parsed = parseWorkflowId(localWorkflowIdValue);
      if (parsed != null) {
        const match =
          availableNestedWorkflows.find((workflow) => workflow.id === parsed) ??
          selectedNestedWorkflow;
        if (match) {
          return match.display_name?.trim() || match.slug;
        }
      }
      if (selectedNestedWorkflow) {
        return (
          selectedNestedWorkflow.display_name?.trim() ||
          selectedNestedWorkflow.slug
        );
      }
      return localWorkflowIdValue.trim();
    }
    if (selectedHostedWorkflow) {
      return selectedHostedWorkflow.label;
    }
    const slugCandidate =
      hostedWorkflowSlugValue.trim() || nestedWorkflowSlug.trim();
    if (slugCandidate) {
      return slugCandidate;
    }
    const idCandidate = hostedWorkflowIdInput.trim();
    return idCandidate || null;
  }, [
    availableNestedWorkflows,
    hasNestedWorkflowSelection,
    hostedWorkflowIdInput,
    hostedWorkflowSlugValue,
    localWorkflowIdValue,
    nestedWorkflowSlug,
    selectedHostedWorkflow,
    selectedNestedWorkflow,
    workflowMode,
  ]);

  const nestedWorkflowSummaryText = hasNestedWorkflowSelection
    ? nestedWorkflowSummaryLabel
      ? t("workflowBuilder.agentInspector.nestedWorkflowSelectedInfo", {
          label: nestedWorkflowSummaryLabel,
        })
      : t("workflowBuilder.agentInspector.nestedWorkflowSelectedInfoUnknown")
    : "";
  return (
    <>
      <div
        className={`${styles.nodeInspectorField} ${styles.agentNestedWorkflowField}`}
      >
        <span id={nestedWorkflowLabelId} className={styles.nodeInspectorLabel}>
          {t("workflowBuilder.agentInspector.nestedWorkflowLabel")}
          <HelpTooltip
            label={t("workflowBuilder.agentInspector.nestedWorkflowHelp")}
          />
        </span>
        <div
          className={`${styles.nodeInspectorRadioGroup} ${styles.agentNestedWorkflowModes}`}
          role="radiogroup"
          aria-labelledby={nestedWorkflowLabelId}
        >
          <label
            className={styles.nodeInspectorRadioOption}
            htmlFor={customModeOptionId}
          >
            <input
              type="radio"
              id={customModeOptionId}
              name={nestedWorkflowModeName}
              value="custom"
              checked={workflowMode === "custom"}
              onChange={() => handleWorkflowModeChange("custom")}
            />
            <span>
              {t("workflowBuilder.agentInspector.nestedWorkflowCustomOption")}
            </span>
          </label>
          <label
            className={styles.nodeInspectorRadioOption}
            htmlFor={localModeOptionId}
          >
            <input
              type="radio"
              id={localModeOptionId}
              name={nestedWorkflowModeName}
              value="local"
              checked={workflowMode === "local"}
              onChange={() => handleWorkflowModeChange("local")}
            />
            <span>
              {t("workflowBuilder.agentInspector.nestedWorkflowLocalOption")}
            </span>
          </label>
          <label
            className={styles.nodeInspectorRadioOption}
            htmlFor={hostedModeOptionId}
          >
            <input
              type="radio"
              id={hostedModeOptionId}
              name={nestedWorkflowModeName}
              value="hosted"
              checked={workflowMode === "hosted"}
              onChange={() => handleWorkflowModeChange("hosted")}
            />
            <span>
              {t("workflowBuilder.agentInspector.nestedWorkflowHostedOption")}
            </span>
          </label>
        </div>
        {workflowMode === "local" ? (
          <select
            id={localWorkflowSelectId}
            className={styles.agentNestedWorkflowSelect}
            value={localWorkflowIdValue}
            aria-labelledby={nestedWorkflowLabelId}
            onChange={(event) => handleLocalWorkflowChange(event.target.value)}
          >
            <option value="" disabled hidden>
              {t("workflowBuilder.agentInspector.nestedWorkflowNoneOption")}
            </option>
            {availableNestedWorkflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.display_name?.trim() || workflow.slug}
              </option>
            ))}
          </select>
        ) : null}
        {workflowMode === "hosted" ? (
          <div className={styles.agentNestedWorkflowHostedFields}>
            <label
              className={`${styles.nodeInspectorSubField} ${styles.agentNestedWorkflowHostedSelectField}`}
              htmlFor={hostedWorkflowIdFieldId}
            >
              <span className={styles.nodeInspectorSubLabel}>
                {t(
                  "workflowBuilder.agentInspector.nestedWorkflowHostedSelectLabel",
                )}
              </span>
              <select
                id={hostedWorkflowIdFieldId}
                className={styles.agentNestedWorkflowHostedSelect}
                value={hostedWorkflowIdInput}
                aria-labelledby={nestedWorkflowLabelId}
                onChange={(event) =>
                  handleHostedWorkflowSelectChange(event.target.value)
                }
                disabled={
                  hostedWorkflowsLoading && hostedWorkflows.length === 0
                }
              >
                <option value="" disabled hidden>
                  {t("workflowBuilder.agentInspector.nestedWorkflowNoneOption")}
                </option>
                {hostedWorkflowsLoading ? (
                  <option value="__loading__" disabled>
                    {t(
                      "workflowBuilder.agentInspector.nestedWorkflowHostedLoading",
                    )}
                  </option>
                ) : null}
                {!hostedWorkflowsLoading && hostedWorkflows.length === 0 ? (
                  <option value="__empty__" disabled>
                    {t(
                      "workflowBuilder.agentInspector.nestedWorkflowHostedSelectEmpty",
                    )}
                  </option>
                ) : null}
                {hostedWorkflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </div>

      {showNestedWorkflowDetails ? (
        <>
          {nestedWorkflowMissing ? (
            <p className={styles.nodeInspectorErrorTextSpaced}>
              {t("workflowBuilder.agentInspector.nestedWorkflowMissing")}
            </p>
          ) : null}

          {showHostedSlugInfo ? (
            <p className={styles.nodeInspectorMutedTextSpaced}>
              {t("workflowBuilder.agentInspector.nestedWorkflowSlugInfo", {
                slug: hostedSlugInfoValue,
              })}
            </p>
          ) : null}

          {workflowMode === "hosted" && hostedWorkflowsError ? (
            <p className={styles.nodeInspectorErrorTextSpaced}>
              {hostedWorkflowsError}
            </p>
          ) : null}

          {hasNestedWorkflowSelection ? (
            <>
              <p className={styles.nodeInspectorMutedTextSpaced}>
                {nestedWorkflowSummaryText}
              </p>
              {workflowMode === "local" &&
              selectedNestedWorkflow?.description ? (
                <p className={styles.nodeInspectorMutedTextSpaced}>
                  {selectedNestedWorkflow.description}
                </p>
              ) : null}
              {workflowMode === "hosted" &&
              selectedHostedWorkflow?.description ? (
                <p className={styles.nodeInspectorMutedTextSpaced}>
                  {selectedHostedWorkflow.description}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {workflowMode === "custom" ? (
        <>
          <label className={styles.nodeInspectorField}>
            <span>Message système</span>
            <textarea
              value={agentMessage}
              rows={5}
              placeholder="Texte transmis à l'agent pour définir son rôle"
              onChange={(event) =>
                onAgentMessageChange(nodeId, event.target.value)
              }
            />
          </label>

          <label className={styles.nodeInspectorInlineField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.agentInspector.providerLabel")}
            </span>
            <select
              value={selectedProviderValue}
              onChange={(event) => handleProviderChange(event.target.value)}
              disabled={availableModelsLoading}
            >
              <option value="">
                {t("workflowBuilder.agentInspector.providerPlaceholder")}
              </option>
              {providerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.nodeInspectorInlineField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.agentInspector.modelLabel")}
              <HelpTooltip
                label={t("workflowBuilder.agentInspector.modelHelp")}
              />
            </span>
            <select
              value={selectedModelOption}
              onChange={(event) => handleModelChange(event.target.value)}
              disabled={availableModelsLoading}
            >
              <option value="">
                {t("workflowBuilder.agentInspector.modelPlaceholder")}
              </option>
              {modelsForProvider.map((model) => {
                const displayLabel = model.display_name?.trim()
                  ? `${model.display_name.trim()} (${model.name})`
                  : model.name;
                const reasoningSuffix = model.supports_reasoning
                  ? t("workflowBuilder.agentInspector.reasoningSuffix")
                  : "";
                const providerSlug = model.provider_slug?.trim();
                const providerId = model.provider_id?.trim();
                const providerSuffix =
                  providerSlug || providerId
                    ? ` – ${providerSlug ?? ""}${providerId ? ` (${providerId})` : ""}`
                    : "";
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
          </label>

          {agentModel.trim() && !matchedModel && !availableModelsLoading ? (
            <p className={styles.nodeInspectorErrorTextSpaced}>
              {t("workflowBuilder.agentInspector.unlistedModelWarning", {
                model: agentModel.trim(),
              })}
            </p>
          ) : null}

          {availableModelsLoading ? (
            <p className={styles.nodeInspectorMutedTextSpacedTop}>
              {t("workflowBuilder.agentInspector.modelsLoading")}
            </p>
          ) : availableModelsError ? (
            <p className={styles.nodeInspectorErrorTextSpaced}>
              {availableModelsError}
            </p>
          ) : matchedModel?.description ? (
            <p className={styles.nodeInspectorMutedTextSpacedTop}>
              {matchedModel.description}
            </p>
          ) : null}

          {supportsReasoning ? (
            <>
              <label className={styles.nodeInspectorInlineField}>
                <span className={styles.nodeInspectorLabel}>
                  Niveau de raisonnement
                  <HelpTooltip label="Ajuste la profondeur d'analyse du modèle (laisser vide pour utiliser la valeur par défaut)." />
                </span>
                <select
                  value={reasoningEffort}
                  onChange={(event) =>
                    onAgentReasoningChange(nodeId, event.target.value)
                  }
                >
                  {reasoningEffortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.nodeInspectorInlineField}>
                <span className={styles.nodeInspectorLabel}>
                  Verbosité de la réponse
                  <HelpTooltip label="Contrôle la quantité de texte renvoyée par le modèle (laisser vide pour appliquer le paramétrage par défaut)." />
                </span>
                <select
                  value={textVerbosityValue}
                  onChange={(event) =>
                    onAgentTextVerbosityChange(nodeId, event.target.value)
                  }
                >
                  {textVerbosityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.nodeInspectorInlineField}>
                <span className={styles.nodeInspectorLabel}>
                  Résumé des étapes
                  <HelpTooltip label="Détermine si l'agent doit générer un résumé automatique de son raisonnement." />
                </span>
                <select
                  value={reasoningSummaryValue}
                  onChange={(event) =>
                    onAgentReasoningSummaryChange(nodeId, event.target.value)
                  }
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
              <label className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
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
                  onChange={(event) =>
                    onAgentTemperatureChange(nodeId, event.target.value)
                  }
                />
              </label>
              <label className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
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
                  onChange={(event) =>
                    onAgentTopPChange(nodeId, event.target.value)
                  }
                />
              </label>
            </>
          )}

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              Nombre maximal de tokens générés
              <HelpTooltip label="Limite la longueur maximale des réponses produites par cet agent." />
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={maxOutputTokensValue}
              placeholder="Laisser vide pour la valeur par défaut"
              onChange={(event) =>
                onAgentMaxOutputTokensChange(nodeId, event.target.value)
              }
            />
          </label>

          <div className={styles.nodeInspectorToggleGroup}>
            <ToggleRow
              label="Inclure l'historique du chat"
              checked={includeChatHistory}
              onChange={(next) => onAgentIncludeChatHistoryChange(nodeId, next)}
            />
            <ToggleRow
              label="Afficher la réponse dans le chat"
              checked={displayResponseInChat}
              onChange={(next) =>
                onAgentDisplayResponseInChatChange(nodeId, next)
              }
            />
            <ToggleRow
              label="Afficher les sources de recherche"
              checked={showSearchSources}
              onChange={(next) => onAgentShowSearchSourcesChange(nodeId, next)}
            />
            <ToggleRow
              label="Continuer l'exécution en cas d'erreur"
              checked={continueOnError}
              onChange={(next) => onAgentContinueOnErrorChange(nodeId, next)}
            />
            <ToggleRow
              label="Enregistrer la réponse dans l'historique de conversation"
              checked={resolvedStoreResponses}
              onChange={(next) => onAgentStorePreferenceChange(nodeId, next)}
              disabled={storePreferenceLocked}
            />
          </div>

          <label className={styles.nodeInspectorInlineField}>
            <span className={styles.nodeInspectorLabel}>
              Type de sortie
              <HelpTooltip label="Choisissez le format attendu pour la réponse de l'agent." />
            </span>
            <select
              value={responseFormat.kind}
              onChange={(event) => {
                const nextKind = event.target.value as
                  | "text"
                  | "json_schema"
                  | "widget";
                onAgentResponseFormatKindChange(nodeId, nextKind);
              }}
            >
              <option value="text">Texte libre</option>
              <option value="json_schema">Schéma JSON</option>
              <option value="widget">Widget de la bibliothèque</option>
            </select>
          </label>

          {responseFormat.kind === "json_schema" ? (
            <>
              <label className={styles.nodeInspectorField}>
                <span>Nom du schéma JSON</span>
                <input
                  type="text"
                  value={responseFormat.name}
                  onChange={(event) =>
                    onAgentResponseFormatNameChange(nodeId, event.target.value)
                  }
                />
              </label>

              <label className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
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
                      onAgentResponseFormatSchemaChange(nodeId, parsed);
                    } catch (error) {
                      setSchemaError(
                        error instanceof Error
                          ? error.message
                          : "Schéma JSON invalide",
                      );
                    }
                  }}
                  className={[
                    styles.nodeInspectorTextareaLarge,
                    schemaError ? styles.nodeInspectorInputError : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
                {schemaError ? (
                  <span className={styles.nodeInspectorErrorTextSmall}>
                    {schemaError}
                  </span>
                ) : null}
              </label>
            </>
          ) : null}

          {responseFormat.kind === "widget" ? (
            <>
              <label className={styles.nodeInspectorField}>
                <span className={styles.nodeInspectorLabel}>
                  Source du widget
                  <HelpTooltip label="Choisissez entre un widget enregistré ou un JSON fourni par une variable du workflow." />
                </span>
                <select
                  value={responseWidgetSource}
                  onChange={(event) =>
                    onAgentResponseWidgetSourceChange(
                      nodeId,
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
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      Widget de sortie
                      <HelpTooltip label="Sélectionnez un widget de la bibliothèque pour diffuser la réponse." />
                    </span>
                    <select
                      value={widgetSelectValue}
                      onChange={(event) =>
                        onAgentResponseWidgetSlugChange(
                          nodeId,
                          event.target.value,
                        )
                      }
                      aria-describedby={
                        widgetValidationMessage
                          ? `${widgetSelectId}-message`
                          : undefined
                      }
                    >
                      <option value="">Sélectionnez un widget</option>
                      {widgets.map((widget) => (
                        <option key={widget.slug} value={widget.slug}>
                          {widget.title?.trim()
                            ? `${widget.title} (${widget.slug})`
                            : widget.slug}
                        </option>
                      ))}
                    </select>
                  </label>

                  {widgetsLoading ? (
                    <p className={styles.nodeInspectorMutedText}>
                      Chargement de la bibliothèque de widgets…
                    </p>
                  ) : widgetsError ? (
                    <p className={styles.nodeInspectorErrorText}>
                      {widgetsError}
                      <br />
                      Vous pouvez saisir le slug du widget manuellement
                      ci-dessus.
                    </p>
                  ) : widgets.length === 0 ? (
                    <p className={styles.nodeInspectorMutedText}>
                      Créez un widget dans la bibliothèque dédiée pour
                      l'utiliser ici.
                    </p>
                  ) : null}

                  {widgetValidationMessage ? (
                    <p
                      id={`${widgetSelectId}-message`}
                      className={styles.nodeInspectorErrorTextTightTop}
                    >
                      {widgetValidationMessage}
                    </p>
                  ) : null}

                  {responseWidgetSlug && !widgetsLoading && widgetsError ? (
                    <p className={styles.nodeInspectorMutedTextTightTop}>
                      Le widget sélectionné ({responseWidgetSlug}) sera conservé
                      tant que la bibliothèque n'est pas disponible.
                    </p>
                  ) : null}

                  {trimmedWidgetSlug && !widgetsLoading && !widgetsError ? (
                    <WidgetJsonFormatInfo
                      definition={responseWidgetDefinition}
                      loading={responseWidgetDefinitionLoading}
                      error={responseWidgetDefinitionError}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <label className={styles.nodeInspectorField}>
                    <span className={styles.nodeInspectorLabel}>
                      Expression JSON du widget
                      <HelpTooltip label="Saisissez une expression (ex. state.widget_json) qui renvoie la définition JSON complète du widget." />
                    </span>
                    <input
                      type="text"
                      value={responseWidgetDefinitionExpression}
                      onChange={(event) =>
                        onAgentResponseWidgetDefinitionChange(
                          nodeId,
                          event.target.value,
                        )
                      }
                      placeholder="Ex. state.widget_json"
                    />
                  </label>
                  <p className={styles.nodeInspectorHintText}>
                    La valeur doit être un objet JSON valide conforme aux
                    spécifications ChatKit Widget.
                  </p>
                  {widgetValidationMessage ? (
                    <p
                      id={`${widgetSelectId}-message`}
                      className={styles.nodeInspectorErrorTextTightTop}
                    >
                      {widgetValidationMessage}
                    </p>
                  ) : null}
                </>
              )}
            </>
          ) : null}

          <div className={styles.nodeInspectorPanel}>
            <strong className={styles.nodeInspectorSectionTitle}>Outils</strong>
            <ToggleRow
              label="Activer la recherche web"
              checked={webSearchEnabled}
              onChange={(next) =>
                onAgentWebSearchChange(
                  nodeId,
                  next
                    ? (webSearchConfig ?? { ...DEFAULT_WEB_SEARCH_CONFIG })
                    : null,
                )
              }
            />
            {webSearchEnabled ? (
              <>
                <label className={styles.nodeInspectorInlineField}>
                  <span className={styles.nodeInspectorLabel}>
                    Portée de la recherche
                    <HelpTooltip label="Définit la quantité de contexte web récupérée pour l'agent." />
                  </span>
                  <select
                    value={webSearchConfig?.search_context_size ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      const nextConfig: WebSearchConfig = {
                        ...(webSearchConfig ?? {}),
                      };
                      if (value) {
                        nextConfig.search_context_size = value;
                      } else {
                        delete nextConfig.search_context_size;
                      }
                      onAgentWebSearchChange(nodeId, nextConfig);
                    }}
                  >
                    <option value="">(par défaut)</option>
                    <option value="low">Petit contexte</option>
                    <option value="medium">Contexte moyen</option>
                    <option value="high">Grand contexte</option>
                  </select>
                </label>

                <div className={styles.nodeInspectorInputGroup}>
                  <span className={styles.nodeInspectorSectionLabel}>
                    Localisation utilisateur
                  </span>
                  {Object.entries(WEB_SEARCH_LOCATION_LABELS).map(
                    ([key, label]) => {
                      const typedKey =
                        key as keyof typeof WEB_SEARCH_LOCATION_LABELS;
                      const currentValue =
                        (webSearchConfig?.user_location?.[typedKey] as
                          | string
                          | undefined) ?? "";
                      return (
                        <label key={key} className={styles.nodeInspectorField}>
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
                        </label>
                      );
                    },
                  )}
                </div>
              </>
            ) : null}

            <ToggleRow
              label="Activer la recherche documentaire"
              checked={fileSearchEnabled}
              onChange={(next) => {
                if (next) {
                  const preferredSlug =
                    (fileSearchConfig?.vector_store_slug?.trim() ?? "") ||
                    vectorStores[0]?.slug ||
                    "";
                  onAgentFileSearchChange(nodeId, {
                    vector_store_slug: preferredSlug,
                  });
                } else {
                  onAgentFileSearchChange(nodeId, null);
                }
              }}
            />

            {vectorStoresError ? (
              <p className={styles.nodeInspectorErrorText}>
                {vectorStoresError}
              </p>
            ) : null}

            {fileSearchEnabled ? (
              <>
                {vectorStoresLoading ? (
                  <p className={styles.nodeInspectorMutedText}>
                    Chargement des vector stores…
                  </p>
                ) : vectorStores.length === 0 ? (
                  <p className={styles.nodeInspectorMutedText}>
                    Aucun vector store disponible. Créez-en un depuis l'onglet «
                    Vector stores JSON ».
                  </p>
                ) : (
                  <label className={styles.nodeInspectorInlineField}>
                    <span className={styles.nodeInspectorLabel}>
                      Vector store à interroger
                      <HelpTooltip label="Le document complet du résultat sera transmis à l'agent." />
                    </span>
                    <select
                      value={selectedVectorStoreSlug}
                      onChange={(event) =>
                        onAgentFileSearchChange(nodeId, {
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
                    {fileSearchValidationMessage ? (
                      <p className={styles.nodeInspectorErrorText}>
                        {fileSearchValidationMessage}
                      </p>
                    ) : null}
                  </label>
                )}
              </>
            ) : null}

            <ToggleRow
              label={t("workflowBuilder.agentInspector.computerUseToggle")}
              checked={computerUseEnabled}
              onChange={(next) =>
                onAgentComputerUseChange(
                  nodeId,
                  next
                    ? (computerUseConfig ?? { ...DEFAULT_COMPUTER_USE_CONFIG })
                    : null,
                )
              }
              help={t("workflowBuilder.agentInspector.computerUseToggleHelp")}
            />

            {computerUseEnabled ? (
              <div className={styles.nodeInspectorPanelInnerAccent}>
                <label className={styles.nodeInspectorInlineField}>
                  <span className={styles.nodeInspectorLabel}>
                    {t("workflowBuilder.agentInspector.computerUseWidthLabel")}
                  </span>
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
                </label>

                <label className={styles.nodeInspectorInlineField}>
                  <span className={styles.nodeInspectorLabel}>
                    {t("workflowBuilder.agentInspector.computerUseHeightLabel")}
                  </span>
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
                </label>

                <label className={styles.nodeInspectorInlineField}>
                  <span className={styles.nodeInspectorLabel}>
                    {t(
                      "workflowBuilder.agentInspector.computerUseEnvironmentLabel",
                    )}
                  </span>
                  <select
                    value={computerUseEnvironmentValue}
                    onChange={(event) =>
                      handleComputerUseFieldChange({
                        environment: event.target.value,
                      })
                    }
                  >
                    {COMPUTER_USE_ENVIRONMENTS.map((environment) => (
                      <option key={environment} value={environment}>
                        {t(
                          `workflowBuilder.agentInspector.computerUseEnvironment.${environment}`,
                        )}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.nodeInspectorField}>
                  <span className={styles.nodeInspectorLabel}>
                    {t(
                      "workflowBuilder.agentInspector.computerUseStartUrlLabel",
                    )}
                    <HelpTooltip
                      label={t(
                        "workflowBuilder.agentInspector.computerUseStartUrlHelp",
                      )}
                    />
                  </span>
                  <input
                    type="text"
                    value={computerUseStartUrlValue}
                    onChange={(event) =>
                      handleComputerUseFieldChange({
                        start_url: event.target.value,
                      })
                    }
                    placeholder={t(
                      "workflowBuilder.agentInspector.computerUseStartUrlPlaceholder",
                    )}
                  />
                </label>
              </div>
            ) : null}

            <ToggleRow
              label="Activer la génération d'image"
              checked={imageGenerationEnabled}
              onChange={(next) =>
                onAgentImageGenerationChange(
                  nodeId,
                  next ? { ...DEFAULT_IMAGE_TOOL_CONFIG } : null,
                )
              }
              help={t("workflowBuilder.agentInspector.imageToolToggleHelp")}
            />

            {imageGenerationEnabled ? (
              <div className={styles.nodeInspectorPanelInnerAccent}>
                <label className={styles.nodeInspectorInlineField}>
                  <span className={styles.nodeInspectorLabel}>
                    Modèle de génération
                    <HelpTooltip
                      label={t("workflowBuilder.agentInspector.imageModelHelp")}
                    />
                  </span>
                  <select
                    value={imageModelValue}
                    onChange={(event) =>
                      updateImageTool({
                        model:
                          event.target.value || DEFAULT_IMAGE_TOOL_CONFIG.model,
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

                <label className={styles.nodeInspectorInlineField}>
                  <span className={styles.nodeInspectorLabel}>
                    Taille de sortie
                    <HelpTooltip label="Définit la résolution retournée par l'API." />
                  </span>
                  <select
                    value={imageSizeValue}
                    onChange={(event) =>
                      updateImageTool({ size: event.target.value || undefined })
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

                <label className={styles.nodeInspectorInlineField}>
                  <span className={styles.nodeInspectorLabel}>
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

                <label className={styles.nodeInspectorInlineField}>
                  <span className={styles.nodeInspectorLabel}>
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

                <label className={styles.nodeInspectorInlineField}>
                  <span className={styles.nodeInspectorLabel}>
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
            ) : null}

            <ToolSettingsPanel
              nodeId={nodeId}
              parameters={parameters}
              workflows={workflows}
              currentWorkflowId={currentWorkflowId}
              onAgentWeatherToolChange={onAgentWeatherToolChange}
              onAgentWidgetValidationToolChange={
                onAgentWidgetValidationToolChange
              }
              onAgentWorkflowValidationToolChange={
                onAgentWorkflowValidationToolChange
              }
              onAgentWorkflowToolToggle={onAgentWorkflowToolToggle}
              onAgentMcpSseConfigChange={onAgentMcpSseConfigChange}
              onTestMcpSseConnection={handleTestMcpSseConnection}
              onStartMcpOAuth={handleStartMcpOAuth}
              onPollMcpOAuth={handlePollMcpOAuth}
              onCancelMcpOAuth={handleCancelMcpOAuth}
            />
          </div>
        </>
      ) : null}
    </>
  );
};

type WidgetJsonFormatInfoProps = {
  definition: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
};

const WidgetJsonFormatInfo = ({
  definition,
  loading,
  error,
}: WidgetJsonFormatInfoProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (loading) {
    return (
      <div className={styles.nodeInspectorInfoMessage}>
        Chargement du format JSON…
      </div>
    );
  }

  if (error || !definition) {
    return null;
  }

  const bindings = collectWidgetBindings(definition);
  const bindingKeys = Object.keys(bindings);

  if (bindingKeys.length === 0) {
    return (
      <div className={styles.nodeInspectorInfoCard}>
        <div className={styles.nodeInspectorInfoCardNote}>
          Ce widget n'a pas de champs dynamiques configurables.
        </div>
      </div>
    );
  }

  const jsonExample: Record<string, string> = {};
  bindingKeys.forEach((key) => {
    const sanitizedKey = key
      .replace(/[^0-9a-zA-Z_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (sanitizedKey) {
      jsonExample[sanitizedKey] = `"valeur pour ${key}"`;
    }
  });

  const jsonString = JSON.stringify(jsonExample, null, 2).replace(
    /"valeur pour ([^"]+)"/g,
    '"valeur pour $1"',
  );

  return (
    <div className={styles.nodeInspectorInfoCard}>
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className={styles.nodeInspectorDisclosureButton}
      >
        <span className={styles.nodeInspectorDisclosureLabel}>
          <span
            className={[
              styles.nodeInspectorDisclosureIcon,
              isExpanded ? styles.nodeInspectorDisclosureIconExpanded : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            ▶
          </span>
          Format JSON attendu
        </span>
        <span className={styles.nodeInspectorBadge}>{bindingKeys.length}</span>
      </button>

      {isExpanded ? (
        <div className={styles.nodeInspectorDisclosureContent}>
          <div className={styles.nodeInspectorDisclosureHeading}>
            Champs dynamiques disponibles :
          </div>
          <ul className={styles.nodeInspectorList}>
            {bindingKeys.sort().map((key) => {
              const sanitizedKey = key
                .replace(/[^0-9a-zA-Z_]+/g, "_")
                .replace(/^_+|_+$/g, "");
              return (
                <li key={key} className={styles.nodeInspectorListItem}>
                  <code className={styles.nodeInspectorCode}>
                    {sanitizedKey}
                  </code>
                  {sanitizedKey !== key ? (
                    <span className={styles.nodeInspectorCodeNote}>
                      (pour {key})
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className={styles.nodeInspectorDisclosureExample}>
            Exemple de JSON à générer par l'agent :
          </div>
          <pre className={styles.nodeInspectorPre}>{jsonString}</pre>
          <div className={styles.nodeInspectorDisclosureNote}>
            Note : Les clés avec des caractères spéciaux sont normalisées
            (points remplacés par underscores).
          </div>
        </div>
      ) : null}
    </div>
  );
};
