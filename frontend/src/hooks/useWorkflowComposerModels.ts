import { useEffect, useState } from "react";
import { workflowsApi, type WorkflowVersionResponse } from "../utils/backend";
import {
  getAgentModelSelectionMode,
  getAgentUserModelOptions,
  type UserModelOption,
} from "../utils/workflows";
import type { ComposerModel } from "../chatkit/types";

type UseWorkflowComposerModelsParams = {
  token: string | null;
  workflowId: number | null;
  activeVersionId: number | null;
};

type UseWorkflowComposerModelsResult = {
  composerModels: ComposerModel[] | null;
  loading: boolean;
  error: string | null;
};

/**
 * Hook pour récupérer les modèles configurés dans le bloc agent du workflow
 * pour le sélecteur de modèle du composer.
 */
export const useWorkflowComposerModels = ({
  token,
  workflowId,
  activeVersionId,
}: UseWorkflowComposerModelsParams): UseWorkflowComposerModelsResult => {
  const [composerModels, setComposerModels] = useState<ComposerModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log("[useWorkflowComposerModels] params:", { token: !!token, workflowId, activeVersionId });

    if (!token || !workflowId || !activeVersionId) {
      console.log("[useWorkflowComposerModels] Missing params, skipping");
      setComposerModels(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchWorkflowVersion = async () => {
      setLoading(true);
      setError(null);

      try {
        console.log("[useWorkflowComposerModels] Fetching version...");
        const version: WorkflowVersionResponse = await workflowsApi.getVersion(
          token,
          workflowId,
          activeVersionId
        );

        console.log("[useWorkflowComposerModels] Version loaded:", version);

        if (cancelled) return;

        // Trouver le premier bloc agent dans le workflow
        const nodes = (version.definition as { nodes?: unknown[] })?.nodes;
        console.log("[useWorkflowComposerModels] Nodes:", nodes);

        const agentNode = nodes?.find(
          (node: unknown) => {
            const n = node as { data?: { kind?: string } };
            return n.data?.kind === "agent";
          }
        ) as { data?: { kind?: string; parameters?: Record<string, unknown> } } | undefined;

        console.log("[useWorkflowComposerModels] Agent node:", agentNode);

        if (!agentNode?.data?.parameters) {
          console.log("[useWorkflowComposerModels] No agent parameters found");
          setComposerModels(null);
          setLoading(false);
          return;
        }

        const parameters = agentNode.data.parameters;
        console.log("[useWorkflowComposerModels] Parameters:", parameters);

        const selectionMode = getAgentModelSelectionMode(parameters);
        console.log("[useWorkflowComposerModels] Selection mode:", selectionMode);

        if (selectionMode !== "user_choice") {
          console.log("[useWorkflowComposerModels] Not user_choice mode");
          setComposerModels(null);
          setLoading(false);
          return;
        }

        const userModelOptions = getAgentUserModelOptions(parameters);
        console.log("[useWorkflowComposerModels] User model options:", userModelOptions);

        if (userModelOptions.length === 0) {
          console.log("[useWorkflowComposerModels] No user model options");
          setComposerModels(null);
          setLoading(false);
          return;
        }

        // Convertir UserModelOption[] en ComposerModel[]
        const models: ComposerModel[] = userModelOptions.map(
          (option: UserModelOption) => ({
            id: option.model,
            label: option.label,
            description: option.description,
            default: option.default,
          })
        );

        console.log("[useWorkflowComposerModels] Setting composer models:", models);
        setComposerModels(models);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("[useWorkflowComposerModels] Failed to load:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setComposerModels(null);
        setLoading(false);
      }
    };

    fetchWorkflowVersion();

    return () => {
      cancelled = true;
    };
  }, [token, workflowId, activeVersionId]);

  return { composerModels, loading, error };
};
