import { useCallback } from "react";
import type {
  AgentParameters,
  VectorStoreNodeConfig,
  VoiceAgentStartBehavior,
  VoiceAgentStopBehavior,
  VoiceAgentTool,
  WidgetVariableAssignment,
} from "../types";
import {
  setAssistantMessage,
  setAssistantMessageStreamDelay,
  setAssistantMessageStreamEnabled,
  setEndAgsMaximumExpression,
  setEndAgsScoreExpression,
  setEndAgsVariableId,
  setEndMessage,
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
import { updateNodeParameters, type UpdateNodeDataFn } from "./nodeHandlerUtils";

export type UseDataNodeHandlersParams = {
  updateNodeData: UpdateNodeDataFn;
};

/**
 * Hook managing handlers for Data/UI nodes
 * Includes: widget, vector store, messages (assistant, user, end, wait), voice agent, outbound call
 */
const useDataNodeHandlers = ({
  updateNodeData,
}: UseDataNodeHandlersParams) => {
  // ========== Widget Node Handlers ==========

  const handleWidgetNodeSlugChange = useCallback(
    (nodeId: string, slug: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeSlug(data.parameters, slug);
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData]
  );

  // ========== Vector Store Node Handlers ==========

  const handleVectorStoreNodeConfigChange = useCallback(
    (nodeId: string, updates: Partial<VectorStoreNodeConfig>) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "json_vector_store") {
          return data;
        }
        const nextParameters = setVectorStoreNodeConfig(data.parameters, updates);
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  // ========== Message Node Handlers ==========

  const handleEndMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "end") {
          return data;
        }
        const nextParameters = setEndMessage(data.parameters, value);
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  const handleEndAgsVariableIdChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "end") {
          return data;
        }
        const nextParameters = setEndAgsVariableId(data.parameters, value);
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  const handleEndAgsScoreExpressionChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "end") {
          return data;
        }
        const nextParameters = setEndAgsScoreExpression(data.parameters, value);
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  const handleEndAgsMaximumExpressionChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "end") {
          return data;
        }
        const nextParameters = setEndAgsMaximumExpression(data.parameters, value);
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  // ========== Voice Agent Node Handlers ==========

  const handleVoiceAgentVoiceChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "voice_agent") {
          return data;
        }
        const nextParameters = setVoiceAgentVoice(data.parameters, value);
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  // ========== Outbound Call Node Handlers ==========

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
        };
      });
    },
    [updateNodeData],
  );

  return {
    // Widget handlers
    handleWidgetNodeSlugChange,
    handleWidgetNodeSourceChange,
    handleWidgetNodeDefinitionExpressionChange,
    handleWidgetNodeVariablesChange,
    handleWidgetNodeAwaitActionChange,
    // Vector store handlers
    handleVectorStoreNodeConfigChange,
    // Message handlers
    handleEndMessageChange,
    handleEndAgsVariableIdChange,
    handleEndAgsScoreExpressionChange,
    handleEndAgsMaximumExpressionChange,
    handleAssistantMessageChange,
    handleAssistantMessageStreamEnabledChange,
    handleAssistantMessageStreamDelayChange,
    handleWaitForUserInputMessageChange,
    handleUserMessageChange,
    // Voice agent handlers
    handleVoiceAgentVoiceChange,
    handleVoiceAgentStartBehaviorChange,
    handleVoiceAgentStopBehaviorChange,
    handleVoiceAgentToolChange,
    handleTranscriptionModelChange,
    handleTranscriptionLanguageChange,
    handleTranscriptionPromptChange,
    // Outbound call handlers
    handleOutboundCallParametersChange,
  };
};

export default useDataNodeHandlers;
