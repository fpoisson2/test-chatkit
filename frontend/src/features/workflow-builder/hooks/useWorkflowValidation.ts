/**
 * useWorkflowValidation
 *
 * Hook for validating workflow graphs and node parameters.
 * Provides comprehensive validation for graph structure, node parameters,
 * and resource references (vector stores, widgets).
 *
 * Responsibilities:
 * - Validate graph structure (condition nodes, connections)
 * - Validate node parameters (required fields, types)
 * - Validate resource references (vector stores, widgets)
 * - Determine if workflow can be saved
 * - Provide validation messages
 *
 * @phase Phase 3.6 - Custom Hooks Creation
 */

import { useMemo } from "react";
import { validateGraphStructure } from "../utils/graphValidation";
import { resolveNodeParameters } from "../utils/parameterResolver";
import type { FlowNode, FlowEdge } from "../types";

type VectorStore = {
  id: number;
  name: string;
  slug: string;
};

type Widget = {
  id: number;
  name: string;
  slug: string;
};

type UseWorkflowValidationOptions = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  availableModels?: string[];
  vectorStores?: VectorStore[];
  widgets?: Widget[];
};

type ValidationResult = {
  valid: boolean;
  errors: string[];
};

type UseWorkflowValidationReturn = {
  // Graph structure validation
  conditionGraphError: string | null;

  // Parameter validation
  hasParameterErrors: boolean;
  parameterErrors: Array<{ nodeId: string; error: string }>;

  // Resource reference validation
  hasVectorStoreErrors: boolean;
  vectorStoreErrors: Array<{ nodeId: string; error: string }>;
  hasWidgetErrors: boolean;
  widgetErrors: Array<{ nodeId: string; error: string }>;

  // Overall validation
  disableSave: boolean;
  validationMessage: string | null;

  // Validation results
  graphValidation: ValidationResult;
  parameterValidation: ValidationResult;
  resourceValidation: ValidationResult;
};

/**
 * Hook for validating workflow graphs
 *
 * @example
 * ```typescript
 * const {
 *   conditionGraphError,
 *   hasParameterErrors,
 *   disableSave,
 *   validationMessage
 * } = useWorkflowValidation({
 *   nodes,
 *   edges,
 *   availableModels,
 *   vectorStores,
 *   widgets
 * });
 *
 * if (disableSave) {
 *    * }
 * ```
 */
export function useWorkflowValidation(options: UseWorkflowValidationOptions): UseWorkflowValidationReturn {
  const { nodes, edges, availableModels = [], vectorStores = [], widgets = [] } = options;

  // Validate graph structure
  const conditionGraphError = useMemo(() => {
    return validateGraphStructure(nodes, edges);
  }, [nodes, edges]);

  // Validate node parameters
  const parameterValidation = useMemo<ValidationResult>(() => {
    const errors: Array<{ nodeId: string; error: string }> = [];

    for (const node of nodes) {
      try {
        const params = resolveNodeParameters(node, availableModels);

        // Check for required fields based on node type
        if (node.type === "agent") {
          const agentParams = params as any;

          // Model validation
          if (!agentParams.model || agentParams.model === "") {
            errors.push({
              nodeId: node.id,
              error: "Model is required",
            });
          } else if (availableModels.length > 0 && !availableModels.includes(agentParams.model)) {
            errors.push({
              nodeId: node.id,
              error: `Invalid model: ${agentParams.model}`,
            });
          }

          // Message validation
          if (!agentParams.message || agentParams.message === "") {
            errors.push({
              nodeId: node.id,
              error: "Message is required",
            });
          }
        }

        if (node.type === "vectorstore") {
          const vsParams = params as any;

          if (!vsParams.vector_store_id) {
            errors.push({
              nodeId: node.id,
              error: "Vector store is required",
            });
          }
        }

        if (node.type === "condition") {
          const condParams = params as any;

          if (!condParams.mode || condParams.mode === "") {
            errors.push({
              nodeId: node.id,
              error: "Condition mode is required",
            });
          }

          if (condParams.mode === "path" && (!condParams.path || condParams.path === "")) {
            errors.push({
              nodeId: node.id,
              error: "Condition path is required",
            });
          }
        }
      } catch (error) {
        errors.push({
          nodeId: node.id,
          error: error instanceof Error ? error.message : "Parameter validation error",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.map((e) => `Node ${e.nodeId}: ${e.error}`),
    };
  }, [nodes, availableModels]);

  // Validate vector store references
  const vectorStoreValidation = useMemo<ValidationResult>(() => {
    const errors: Array<{ nodeId: string; error: string }> = [];

    for (const node of nodes) {
      if (node.type === "vectorstore") {
        const params = resolveNodeParameters(node, availableModels) as any;
        const vectorStoreId = params.vector_store_id;

        if (vectorStoreId && !vectorStores.some((vs) => vs.id === vectorStoreId)) {
          errors.push({
            nodeId: node.id,
            error: `Vector store with ID ${vectorStoreId} not found`,
          });
        }
      }

      // Check file_search config in agent nodes
      if (node.type === "agent") {
        const params = resolveNodeParameters(node, availableModels) as any;
        const fileSearchConfig = params.file_search_config;

        if (fileSearchConfig && Array.isArray(fileSearchConfig.vector_store_ids)) {
          for (const vsId of fileSearchConfig.vector_store_ids) {
            if (!vectorStores.some((vs) => vs.id === vsId)) {
              errors.push({
                nodeId: node.id,
                error: `Vector store with ID ${vsId} not found in file search config`,
              });
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.map((e) => `Node ${e.nodeId}: ${e.error}`),
    };
  }, [nodes, vectorStores, availableModels]);

  // Validate widget references
  const widgetValidation = useMemo<ValidationResult>(() => {
    const errors: Array<{ nodeId: string; error: string }> = [];

    for (const node of nodes) {
      if (node.type === "agent") {
        const params = resolveNodeParameters(node, availableModels) as any;
        const responseFormat = params.response_format;

        if (responseFormat && responseFormat.kind === "widget") {
          const widgetSlug = responseFormat.widget_slug;
          const widgetSource = responseFormat.widget_source;

          if (widgetSource === "chatkit" && widgetSlug) {
            if (!widgets.some((w) => w.slug === widgetSlug)) {
              errors.push({
                nodeId: node.id,
                error: `Widget with slug "${widgetSlug}" not found`,
              });
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.map((e) => `Node ${e.nodeId}: ${e.error}`),
    };
  }, [nodes, widgets, availableModels]);

  // Calculate overall validation
  const disableSave = useMemo(() => {
    return (
      conditionGraphError !== null ||
      !parameterValidation.valid ||
      !vectorStoreValidation.valid ||
      !widgetValidation.valid
    );
  }, [conditionGraphError, parameterValidation, vectorStoreValidation, widgetValidation]);

  // Generate validation message
  const validationMessage = useMemo(() => {
    const messages: string[] = [];

    if (conditionGraphError) {
      messages.push(conditionGraphError);
    }

    if (!parameterValidation.valid) {
      messages.push(...parameterValidation.errors);
    }

    if (!vectorStoreValidation.valid) {
      messages.push(...vectorStoreValidation.errors);
    }

    if (!widgetValidation.valid) {
      messages.push(...widgetValidation.errors);
    }

    return messages.length > 0 ? messages.join("; ") : null;
  }, [conditionGraphError, parameterValidation, vectorStoreValidation, widgetValidation]);

  return {
    // Graph structure validation
    conditionGraphError,

    // Parameter validation
    hasParameterErrors: !parameterValidation.valid,
    parameterErrors: parameterValidation.errors.map((error, index) => ({
      nodeId: `param-error-${index}`,
      error,
    })),

    // Resource reference validation
    hasVectorStoreErrors: !vectorStoreValidation.valid,
    vectorStoreErrors: vectorStoreValidation.errors.map((error, index) => ({
      nodeId: `vs-error-${index}`,
      error,
    })),
    hasWidgetErrors: !widgetValidation.valid,
    widgetErrors: widgetValidation.errors.map((error, index) => ({
      nodeId: `widget-error-${index}`,
      error,
    })),

    // Overall validation
    disableSave,
    validationMessage,

    // Validation results
    graphValidation: {
      valid: conditionGraphError === null,
      errors: conditionGraphError ? [conditionGraphError] : [],
    },
    parameterValidation,
    resourceValidation: {
      valid: vectorStoreValidation.valid && widgetValidation.valid,
      errors: [...vectorStoreValidation.errors, ...widgetValidation.errors],
    },
  };
}
