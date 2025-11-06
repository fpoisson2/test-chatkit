import { useCallback } from "react";

import type {
  AgentNestedWorkflowSelection,
  AgentParameters,
  ComputerUseConfig,
  FileSearchConfig,
  FlowNode,
  FlowNodeData,
  ImageGenerationToolConfig,
  McpSseToolConfig,
  ParallelBranch,
  StateAssignment,
  StateAssignmentScope,
  VectorStoreNodeConfig,
  VoiceAgentStartBehavior,
  VoiceAgentStopBehavior,
  VoiceAgentTool,
  WebSearchConfig,
  WidgetVariableAssignment,
  WorkflowSummary,
  WorkflowToolConfig,
} from "../types";
import { isAgentKind } from "../WorkflowBuilderUtils";
import type { VectorStoreSummary } from "../../../utils/backend";
import {
  DEFAULT_END_MESSAGE,
  createParallelJoinParameters,
  createParallelSplitParameters,
  createVectorStoreNodeParameters,
  createVoiceAgentParameters,
  createWidgetNodeParameters,
  getAgentNestedWorkflow,
  getAgentWorkflowTools,
  setAgentComputerUseConfig,
  setAgentContinueOnError,
  setAgentDisplayResponseInChat,
  setAgentFileSearchConfig,
  setAgentImageGenerationConfig,
  setAgentIncludeChatHistory,
  setAgentMaxOutputTokens,
  setAgentMcpServers,
  setAgentMessage,
  setAgentModel,
  setAgentModelProvider,
  setAgentNestedWorkflow,
  setAgentReasoningEffort,
  setAgentReasoningSummary,
  setAgentResponseFormatKind,
  setAgentResponseFormatName,
  setAgentResponseFormatSchema,
  setAgentResponseWidgetDefinition,
  setAgentResponseWidgetSlug,
  setAgentResponseWidgetSource,
  setAgentShowSearchSources,
  setAgentStorePreference,
  setAgentTemperature,
  setAgentTextVerbosity,
  setAgentTopP,
  setAgentWeatherToolEnabled,
  setAgentWebSearchConfig,
  setAgentWidgetValidationToolEnabled,
  setAgentWorkflowTools,
  setAgentWorkflowValidationToolEnabled,
  setAssistantMessage,
  setAssistantMessageStreamDelay,
  setAssistantMessageStreamEnabled,
  setConditionMode,
  setConditionPath,
  setConditionValue,
  setEndMessage,
  setParallelSplitBranches,
  setParallelSplitJoinSlug,
  setStartAutoRun,
  setStartAutoRunAssistantMessage,
  setStartAutoRunMessage,
  setStartTelephonyRingTimeout,
  setStartTelephonySipAccountId,
  setStartTelephonySpeakFirst,
  setStateAssignments,
  setTranscriptionLanguage,
  setTranscriptionModel,
  setTranscriptionPrompt,
  setUserMessage,
  setVectorStoreNodeConfig,
  setVoiceAgentStartBehavior,
  setVoiceAgentStopBehavior,
  setVoiceAgentToolEnabled,
  setVoiceAgentVoice,
  setWaitForUserInputMessage,
  setWidgetNodeAwaitAction,
  setWidgetNodeDefinitionExpression,
  setWidgetNodeSlug,
  setWidgetNodeSource,
  setWidgetNodeVariables,
  stringifyAgentParameters,
} from "../../../utils/workflows";
import { resolveAgentParameters } from "../../../utils/agentPresets";

export type UseWorkflowNodeHandlersParams = {
  updateNodeData: (
    nodeId: string,
    updater: (data: FlowNodeData) => FlowNodeData,
  ) => void;
  addNodeToGraph: (node: FlowNode) => void;
  humanizeSlug: (value: string) => string;
  isReasoningModel: (model: string | null | undefined) => boolean;
  workflows: WorkflowSummary[];
  vectorStores: VectorStoreSummary[];
};

const useWorkflowNodeHandlers = ({
  updateNodeData,
  addNodeToGraph,
  humanizeSlug,
  isReasoningModel,
  workflows,
  vectorStores,
}: UseWorkflowNodeHandlersParams) => {
  const handleDisplayNameChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        const display = value;
        return {
          ...data,
          displayName: display,
          label: display.trim() ? display : humanizeSlug(data.slug),
        };
      });
    },
    [humanizeSlug, updateNodeData]
  );

  const handleStartAutoRunChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartAutoRun(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleStartAutoRunMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartAutoRunMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleStartAutoRunAssistantMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartAutoRunAssistantMessage(
          data.parameters,
          value,
        );
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleStartTelephonySipAccountIdChange = useCallback(
    (nodeId: string, sipAccountId: number | null) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartTelephonySipAccountId(data.parameters, sipAccountId);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleStartTelephonyRingTimeoutChange = useCallback(
    (nodeId: string, ringTimeout: number) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartTelephonyRingTimeout(data.parameters, ringTimeout);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleStartTelephonySpeakFirstChange = useCallback(
    (nodeId: string, speakFirst: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartTelephonySpeakFirst(data.parameters, speakFirst);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleOutboundCallParametersChange = useCallback(
    (nodeId: string, parameters: Record<string, unknown>) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "outbound_call") {
          return data;
        }
        const nextParameters = parameters;
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentModelChange = useCallback(
    (
      nodeId: string,
      selection: {
        model: string;
        providerId?: string | null;
        providerSlug?: string | null;
        store?: boolean | null;
      },
    ) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        let nextParameters = setAgentModel(data.parameters, selection.model);
        nextParameters = setAgentModelProvider(nextParameters, selection);
        if (selection.store === false) {
          nextParameters = setAgentStorePreference(nextParameters, false);
        } else if (selection.store === null) {
          nextParameters = setAgentStorePreference(nextParameters, null);
        }
        if (!isReasoningModel(selection.model)) {
          nextParameters = setAgentReasoningEffort(nextParameters, "");
          nextParameters = setAgentReasoningSummary(nextParameters, "");
          nextParameters = setAgentTextVerbosity(nextParameters, "");
        }
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [isReasoningModel, updateNodeData],
  );

  const handleAgentProviderChange = useCallback(
    (
      nodeId: string,
      selection: { providerId?: string | null; providerSlug?: string | null },
    ) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentModelProvider(data.parameters, selection);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentNestedWorkflowChange = useCallback(
    (nodeId: string, selection: AgentNestedWorkflowSelection) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }

        const currentReference = getAgentNestedWorkflow(data.parameters);
        if (selection.mode === "custom") {
          const nextParameters = setAgentNestedWorkflow(data.parameters, {
            id: null,
            slug: null,
          });
          return {
            ...data,
            parameters: nextParameters,
            parametersText: stringifyAgentParameters(nextParameters),
            parametersError: null,
          } satisfies FlowNodeData;
        }

        const trimmedSlug = selection.workflowSlug.trim();
        const persistedSlug = trimmedSlug || currentReference.slug;

        let reference: { id?: number | null; slug?: string | null };
        if (selection.mode === "local") {
          if (selection.workflowId == null) {
            reference = { id: null, slug: null };
          } else {
            const slugForLocal = trimmedSlug || currentReference.slug;
            reference = {
              id: selection.workflowId,
              slug: slugForLocal.trim().length > 0 ? slugForLocal : null,
            };
          }
        } else if (!selection.workflowId && !persistedSlug.trim()) {
          reference = { id: null, slug: null };
        } else if (!persistedSlug.trim()) {
          reference = { id: selection.workflowId };
        } else {
          reference = {
            id: selection.workflowId,
            slug: persistedSlug.trim(),
          };
        }

        const nextParameters = setAgentNestedWorkflow(data.parameters, reference);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentReasoningChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentReasoningEffort(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentReasoningSummaryChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentReasoningSummary(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentTextVerbosityChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentTextVerbosity(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentTemperatureChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentTemperature(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentTopPChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentTopP(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentMaxOutputTokensChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentMaxOutputTokens(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentIncludeChatHistoryChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentIncludeChatHistory(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentDisplayResponseInChatChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentDisplayResponseInChat(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentShowSearchSourcesChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentShowSearchSources(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentContinueOnErrorChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentContinueOnError(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentStorePreferenceChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentStorePreference(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentResponseFormatKindChange = useCallback(
    (nodeId: string, kind: "text" | "json_schema" | "widget") => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentResponseFormatKind(data.parameters, kind);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentResponseFormatNameChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentResponseFormatName(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentResponseFormatSchemaChange = useCallback(
    (nodeId: string, schema: unknown) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentResponseFormatSchema(data.parameters, schema);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentResponseWidgetSlugChange = useCallback(
    (nodeId: string, slug: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentResponseWidgetSlug(data.parameters, slug);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentResponseWidgetSourceChange = useCallback(
    (nodeId: string, source: "library" | "variable") => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentResponseWidgetSource(data.parameters, source);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentResponseWidgetDefinitionChange = useCallback(
    (nodeId: string, expression: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentResponseWidgetDefinition(data.parameters, expression);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleConditionPathChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "condition") {
          return data;
        }
        const nextParameters = setConditionPath(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleConditionModeChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "condition") {
          return data;
        }
        let nextParameters = setConditionMode(data.parameters, value);
        if (value !== "equals" && value !== "not_equals") {
          nextParameters = setConditionValue(nextParameters, "");
        }
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleConditionValueChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "condition") {
          return data;
        }
        const nextParameters = setConditionValue(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleParallelJoinSlugChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "parallel_split") {
          return data;
        }
        const nextParameters = setParallelSplitJoinSlug(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleParallelBranchesChange = useCallback(
    (nodeId: string, branches: ParallelBranch[]) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "parallel_split") {
          return data;
        }
        const nextParameters = setParallelSplitBranches(data.parameters, branches);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleWidgetNodeSlugChange = useCallback(
    (nodeId: string, slug: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeSlug(data.parameters, slug);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleWidgetNodeSourceChange = useCallback(
    (nodeId: string, source: "library" | "variable") => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeSource(data.parameters, source);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleWidgetNodeDefinitionExpressionChange = useCallback(
    (nodeId: string, expression: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeDefinitionExpression(data.parameters, expression);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleWidgetNodeVariablesChange = useCallback(
    (nodeId: string, assignments: WidgetVariableAssignment[]) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeVariables(data.parameters, assignments);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleWidgetNodeAwaitActionChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeAwaitAction(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentWebSearchChange = useCallback(
    (nodeId: string, config: WebSearchConfig | null) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentWebSearchConfig(data.parameters, config);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentFileSearchChange = useCallback(
    (nodeId: string, config: FileSearchConfig | null) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentFileSearchConfig(data.parameters, config);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentImageGenerationChange = useCallback(
    (nodeId: string, config: ImageGenerationToolConfig | null) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentImageGenerationConfig(data.parameters, config);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentComputerUseChange = useCallback(
    (nodeId: string, config: ComputerUseConfig | null) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentComputerUseConfig(data.parameters, config);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentMcpServersChange = useCallback(
    (nodeId: string, configs: McpSseToolConfig[]) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind) && data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setAgentMcpServers(data.parameters, configs);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleVectorStoreNodeConfigChange = useCallback(
    (nodeId: string, updates: Partial<VectorStoreNodeConfig>) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "json_vector_store") {
          return data;
        }
        const nextParameters = setVectorStoreNodeConfig(data.parameters, updates);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleTransformExpressionsChange = useCallback(
    (nodeId: string, expressions: Record<string, unknown>) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "transform") {
          return data;
        }
        const nextParameters: AgentParameters = { ...(data.parameters ?? {}) };
        if (Object.keys(expressions).length > 0) {
          (nextParameters as Record<string, unknown>).expressions = expressions;
        } else {
          delete (nextParameters as Record<string, unknown>).expressions;
        }
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentWeatherToolChange = useCallback(
    (nodeId: string, enabled: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentWeatherToolEnabled(data.parameters, enabled);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentWidgetValidationToolChange = useCallback(
    (nodeId: string, enabled: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentWidgetValidationToolEnabled(
          data.parameters,
          enabled,
        );
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentWorkflowValidationToolChange = useCallback(
    (nodeId: string, enabled: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentWorkflowValidationToolEnabled(
          data.parameters,
          enabled,
        );
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAgentWorkflowToolToggle = useCallback(
    (nodeId: string, slug: string, enabled: boolean) => {
      const normalizedSlug = slug.trim();
      if (!normalizedSlug) {
        return;
      }

      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }

        const existingConfigs = getAgentWorkflowTools(data.parameters);
        const remainingConfigs = existingConfigs.filter(
          (config) => config.slug !== normalizedSlug,
        );

        let nextConfigs = remainingConfigs;
        if (enabled) {
          const workflow = workflows.find(
            (candidate) => candidate.slug === normalizedSlug,
          );
          if (!workflow) {
            return data;
          }

          const displayName = workflow.display_name?.trim();
          const enriched: WorkflowToolConfig = {
            slug: workflow.slug,
            name: workflow.slug,
            identifier: workflow.slug,
            workflowId: workflow.id,
          };

          if (displayName) {
            enriched.title = displayName;
          }

          if (workflow.description?.trim()) {
            enriched.description = workflow.description.trim();
          }

          nextConfigs = [...remainingConfigs, enriched];
        }

        const nextParameters = setAgentWorkflowTools(data.parameters, nextConfigs);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData, workflows],
  );

  const handleVoiceAgentVoiceChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setVoiceAgentVoice(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleVoiceAgentStartBehaviorChange = useCallback(
    (nodeId: string, behavior: VoiceAgentStartBehavior) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setVoiceAgentStartBehavior(data.parameters, behavior);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleVoiceAgentStopBehaviorChange = useCallback(
    (nodeId: string, behavior: VoiceAgentStopBehavior) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setVoiceAgentStopBehavior(data.parameters, behavior);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleVoiceAgentToolChange = useCallback(
    (nodeId: string, tool: VoiceAgentTool, enabled: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setVoiceAgentToolEnabled(
          data.parameters,
          tool,
          enabled,
        );
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleTranscriptionModelChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setTranscriptionModel(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleTranscriptionLanguageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setTranscriptionLanguage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleTranscriptionPromptChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setTranscriptionPrompt(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleStateAssignmentsChange = useCallback(
    (nodeId: string, scope: StateAssignmentScope, assignments: StateAssignment[]) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "state") {
          return data;
        }
        const nextParameters = setStateAssignments(data.parameters, scope, assignments);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleEndMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "end") {
          return data;
        }
        const nextParameters = setEndMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAssistantMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "assistant_message") {
          return data;
        }
        const nextParameters = setAssistantMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAssistantMessageStreamEnabledChange = useCallback(
    (nodeId: string, enabled: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "assistant_message") {
          return data;
        }
        const nextParameters = setAssistantMessageStreamEnabled(
          data.parameters,
          enabled,
        );
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAssistantMessageStreamDelayChange = useCallback(
    (nodeId: string, delay: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "assistant_message") {
          return data;
        }
        const nextParameters = setAssistantMessageStreamDelay(
          data.parameters,
          delay,
        );
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleWaitForUserInputMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "wait_for_user_input") {
          return data;
        }
        const nextParameters = setWaitForUserInputMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleUserMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "user_message") {
          return data;
        }
        const nextParameters = setUserMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
  );

  const handleAddAgentNode = useCallback(() => {
    const slug = `agent-${Date.now()}`;
    const parameters = resolveAgentParameters(null, {});
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 200 },
      data: {
        slug,
        kind: "agent",
        displayName: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
        label: humanizeSlug(slug),
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddVoiceAgentNode = useCallback(() => {
    const slug = `voice-agent-${Date.now()}`;
    const parameters = createVoiceAgentParameters();
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 220 },
      data: {
        slug,
        kind: "voice_agent",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddOutboundCallNode = useCallback(() => {
    const slug = `outbound-call-${Date.now()}`;
    const parameters: AgentParameters = {
      to_number: "",
      voice_workflow_id: null,
      sip_account_id: null,
      wait_for_completion: true,
      metadata: {},
    };
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 240 },
      data: {
        slug,
        kind: "outbound_call",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        isPreviewActive: false,
        isPreviewDimmed: false,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddConditionNode = useCallback(() => {
    const slug = `condition-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 400, y: 260 },
      data: {
        slug,
        kind: "condition",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddParallelSplitNode = useCallback(() => {
    const slug = `parallel-split-${Date.now()}`;
    const joinSlug = `parallel-join-${Date.now()}`;
    const parameters = {
      ...createParallelSplitParameters(),
      join_slug: joinSlug,
    };
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 420, y: 200 },
      data: {
        slug,
        kind: "parallel_split",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddParallelJoinNode = useCallback(() => {
    const slug = `parallel-join-${Date.now()}`;
    const parameters = createParallelJoinParameters();
    const displayName = humanizeSlug(slug);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 520, y: 220 },
      data: {
        slug,
        kind: "parallel_join",
        displayName,
        label: displayName,
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddStateNode = useCallback(() => {
    const slug = `state-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 360, y: 220 },
      data: {
        slug,
        kind: "state",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddWatchNode = useCallback(() => {
    const slug = `watch-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 380, y: 240 },
      data: {
        slug,
        kind: "watch",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddTransformNode = useCallback(() => {
    const slug = `transform-${Date.now()}`;
    const parameters: AgentParameters = { expressions: {} };
    const newNode: FlowNode = {
      id: slug,
      position: { x: 380, y: 260 },
      data: {
        slug,
        kind: "transform",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddWaitForUserInputNode = useCallback(() => {
    const slug = `wait-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 400, y: 260 },
      data: {
        slug,
        kind: "wait_for_user_input",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddAssistantMessageNode = useCallback(() => {
    const slug = `assistant-message-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 460, y: 220 },
      data: {
        slug,
        kind: "assistant_message",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddUserMessageNode = useCallback(() => {
    const slug = `user-message-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 440, y: 240 },
      data: {
        slug,
        kind: "user_message",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddVectorStoreNode = useCallback(() => {
    const slug = `json-vector-store-${Date.now()}`;
    const fallbackSlug = vectorStores[0]?.slug?.trim() ?? "";
    const parameters = createVectorStoreNodeParameters({ vector_store_slug: fallbackSlug });
    const newNode: FlowNode = {
      id: slug,
      position: { x: 420, y: 320 },
      data: {
        slug,
        kind: "json_vector_store",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug, vectorStores]);

  const handleAddWidgetNode = useCallback(() => {
    const slug = `widget-${Date.now()}`;
    const parameters = createWidgetNodeParameters();
    const newNode: FlowNode = {
      id: slug,
      position: { x: 520, y: 200 },
      data: {
        slug,
        kind: "widget",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    } satisfies FlowNode;
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);

  const handleAddEndNode = useCallback(() => {
    const slug = `end-${Date.now()}`;
    const parameters = setEndMessage({}, DEFAULT_END_MESSAGE);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 640, y: 120 },
      data: {
        slug,
        kind: "end",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
    };
    addNodeToGraph(newNode);
  }, [addNodeToGraph, humanizeSlug]);
  return {
    handleDisplayNameChange,
    handleStartAutoRunChange,
    handleStartAutoRunMessageChange,
    handleStartAutoRunAssistantMessageChange,
    handleStartTelephonySipAccountIdChange,
    handleStartTelephonyRingTimeoutChange,
    handleStartTelephonySpeakFirstChange,
    handleOutboundCallParametersChange,
    handleAgentMessageChange,
    handleAgentModelChange,
    handleAgentProviderChange,
    handleAgentNestedWorkflowChange,
    handleAgentReasoningChange,
    handleAgentReasoningSummaryChange,
    handleAgentTextVerbosityChange,
    handleAgentTemperatureChange,
    handleAgentTopPChange,
    handleAgentMaxOutputTokensChange,
    handleAgentIncludeChatHistoryChange,
    handleAgentDisplayResponseInChatChange,
    handleAgentShowSearchSourcesChange,
    handleAgentContinueOnErrorChange,
    handleAgentStorePreferenceChange,
    handleAgentResponseFormatKindChange,
    handleAgentResponseFormatNameChange,
    handleAgentResponseFormatSchemaChange,
    handleAgentResponseWidgetSlugChange,
    handleAgentResponseWidgetSourceChange,
    handleAgentResponseWidgetDefinitionChange,
    handleConditionPathChange,
    handleConditionModeChange,
    handleConditionValueChange,
    handleParallelJoinSlugChange,
    handleParallelBranchesChange,
    handleWidgetNodeSlugChange,
    handleWidgetNodeSourceChange,
    handleWidgetNodeDefinitionExpressionChange,
    handleWidgetNodeVariablesChange,
    handleWidgetNodeAwaitActionChange,
    handleAgentWebSearchChange,
    handleAgentFileSearchChange,
    handleAgentImageGenerationChange,
    handleAgentComputerUseChange,
    handleAgentMcpServersChange,
    handleVectorStoreNodeConfigChange,
    handleTransformExpressionsChange,
    handleAgentWeatherToolChange,
    handleAgentWidgetValidationToolChange,
    handleAgentWorkflowValidationToolChange,
    handleAgentWorkflowToolToggle,
    handleVoiceAgentVoiceChange,
    handleVoiceAgentStartBehaviorChange,
    handleVoiceAgentStopBehaviorChange,
    handleVoiceAgentToolChange,
    handleTranscriptionModelChange,
    handleTranscriptionLanguageChange,
    handleTranscriptionPromptChange,
    handleStateAssignmentsChange,
    handleEndMessageChange,
    handleAssistantMessageChange,
    handleAssistantMessageStreamEnabledChange,
    handleAssistantMessageStreamDelayChange,
    handleWaitForUserInputMessageChange,
    handleUserMessageChange,
    handleAddAgentNode,
    handleAddVoiceAgentNode,
    handleAddOutboundCallNode,
    handleAddConditionNode,
    handleAddParallelSplitNode,
    handleAddParallelJoinNode,
    handleAddStateNode,
    handleAddWatchNode,
    handleAddTransformNode,
    handleAddWaitForUserInputNode,
    handleAddAssistantMessageNode,
    handleAddUserMessageNode,
    handleAddVectorStoreNode,
    handleAddWidgetNode,
    handleAddEndNode,
  };
};

export default useWorkflowNodeHandlers;
