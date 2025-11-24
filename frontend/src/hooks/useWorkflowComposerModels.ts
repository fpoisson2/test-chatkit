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
    if (!token || !workflowId || !activeVersionId) {
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
        const version: WorkflowVersionResponse = await workflowsApi.getVersion(
          token,
          workflowId,
          activeVersionId
        );

        if (cancelled) return;

        // Trouver le premier bloc agent dans le workflow
        const agentNode = version.definition?.nodes?.find(
          (node: { data?: { kind?: string } }) => node.data?.kind === "agent"
        );

        if (!agentNode?.data?.parameters) {
          setComposerModels(null);
          setLoading(false);
          return;
        }

        const parameters = agentNode.data.parameters;
        const selectionMode = getAgentModelSelectionMode(parameters);

        if (selectionMode !== "user_choice") {
          setComposerModels(null);
          setLoading(false);
          return;
        }

        const userModelOptions = getAgentUserModelOptions(parameters);

        if (userModelOptions.length === 0) {
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

        setComposerModels(models);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load workflow composer models:", err);
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
