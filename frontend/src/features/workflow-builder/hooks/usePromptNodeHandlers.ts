import { useCallback } from "react";
import type {
  AgentNestedWorkflowSelection,
  FlowNodeData,
  WorkflowSummary,
} from "../types";
import { isAgentKind } from "../WorkflowBuilderUtils";
import {
  getAgentNestedWorkflow,
  setAgentContinueOnError,
  setAgentDisplayResponseInChat,
  setAgentIncludeChatHistory,
  setAgentMaxOutputTokens,
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
  setStartAutoRun,
  setStartAutoRunAssistantMessage,
  setStartAutoRunMessage,
  setStartTelephonyRingTimeout,
  setStartTelephonySipAccountId,
  setStartTelephonySpeakFirst,
  stringifyAgentParameters,
} from "../../../utils/workflows";
import { updateNodeParameters, type UpdateNodeDataFn } from "./nodeHandlerUtils";

export type UsePromptNodeHandlersParams = {
  updateNodeData: UpdateNodeDataFn;
  isReasoningModel: (model: string | null | undefined) => boolean;
};

/**
 * Hook managing handlers for Prompt/Agent nodes and Start nodes
 * Includes: message, model, reasoning, response format, start configuration
 */
const usePromptNodeHandlers = ({
  updateNodeData,
  isReasoningModel,
}: UsePromptNodeHandlersParams) => {
  // ========== Start Node Handlers ==========

  const handleStartAutoRunChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "start") {
          return data;
        }
        const nextParameters = setStartAutoRun(data.parameters, value);
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  // ========== Agent Node Handlers ==========

  const handleAgentMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentMessage(data.parameters, value);
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
          return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData]
  );

  return {
    // Start handlers
    handleStartAutoRunChange,
    handleStartAutoRunMessageChange,
    handleStartAutoRunAssistantMessageChange,
    handleStartTelephonySipAccountIdChange,
    handleStartTelephonyRingTimeoutChange,
    handleStartTelephonySpeakFirstChange,
    // Agent handlers
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
  };
};

export default usePromptNodeHandlers;
