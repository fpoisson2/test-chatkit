import { useCallback } from "react";
import type {
  ComputerUseConfig,
  FileSearchConfig,
  ImageGenerationToolConfig,
  McpSseToolConfig,
  WebSearchConfig,
  WorkflowSummary,
  WorkflowToolConfig,
} from "../types";
import { isAgentKind } from "../WorkflowBuilderUtils";
import {
  getAgentWorkflowTools,
  setAgentComputerUseConfig,
  setAgentFileSearchConfig,
  setAgentImageGenerationConfig,
  setAgentMcpServers,
  setAgentWeatherToolEnabled,
  setAgentWebSearchConfig,
  setAgentWidgetValidationToolEnabled,
  setAgentWorkflowTools,
  setAgentWorkflowValidationToolEnabled,
} from "../../../utils/workflows";
import { updateNodeParameters, type UpdateNodeDataFn } from "./nodeHandlerUtils";

export type UseToolNodeHandlersParams = {
  updateNodeData: UpdateNodeDataFn;
  workflows: WorkflowSummary[];
};

/**
 * Hook managing handlers for Tool configurations
 * Includes: web search, file search, image generation, computer use, MCP, weather, validation tools, workflow tools
 */
const useToolNodeHandlers = ({
  updateNodeData,
  workflows,
}: UseToolNodeHandlersParams) => {
  const handleAgentWebSearchChange = useCallback(
    (nodeId: string, config: WebSearchConfig | null) => {
      updateNodeData(nodeId, (data) => {
        if (!isAgentKind(data.kind)) {
          return data;
        }
        const nextParameters = setAgentWebSearchConfig(data.parameters, config);
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData],
  );

  const handleAgentComputerUseChange = useCallback(
    (nodeId: string, config: ComputerUseConfig | null) => {
      updateNodeData(nodeId, (data) => {
        // Allow computer_use nodes (manual mode) and agent nodes to update computer use config
        if (!isAgentKind(data.kind) && data.kind !== "computer_use") {
          return data;
        }
        const nextParameters = setAgentComputerUseConfig(data.parameters, config);
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
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
        return updateNodeParameters(data, nextParameters);
      });
    },
    [updateNodeData, workflows],
  );

  return {
    handleAgentWebSearchChange,
    handleAgentFileSearchChange,
    handleAgentImageGenerationChange,
    handleAgentComputerUseChange,
    handleAgentMcpServersChange,
    handleAgentWeatherToolChange,
    handleAgentWidgetValidationToolChange,
    handleAgentWorkflowValidationToolChange,
    handleAgentWorkflowToolToggle,
  };
};

export default useToolNodeHandlers;
