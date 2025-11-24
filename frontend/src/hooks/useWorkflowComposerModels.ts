import { useEffect, useState } from "react";
import {
  workflowsApi,
  modelRegistryApi,
  type WorkflowVersionResponse,
  type AvailableModel,
} from "../utils/backend";
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
        // Les nœuds sont dans version.graph.nodes (pas version.definition)
        // et les propriétés sont directement sur le nœud (pas dans node.data)
        const versionWithGraph = version as unknown as { graph?: { nodes?: unknown[] } };
        const nodes = versionWithGraph.graph?.nodes;
        console.log("[useWorkflowComposerModels] Nodes:", nodes);

        const agentNode = nodes?.find(
          (node: unknown) => {
            const n = node as { kind?: string };
            return n.kind === "agent";
          }
        ) as { kind?: string; parameters?: Record<string, unknown> } | undefined;

        console.log("[useWorkflowComposerModels] Agent node:", agentNode);

        if (!agentNode?.parameters) {
          console.log("[useWorkflowComposerModels] No agent parameters found");
          setComposerModels(null);
          setLoading(false);
          return;
        }

        const parameters = agentNode.parameters;
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

        // Récupérer les modèles disponibles pour obtenir display_name et description
        let availableModels: AvailableModel[] = [];
        try {
          availableModels = await modelRegistryApi.list(token);
          console.log("[useWorkflowComposerModels] Available models:", availableModels);
        } catch (err) {
          console.warn("[useWorkflowComposerModels] Failed to fetch available models:", err);
        }

        if (cancelled) return;

        // Créer une map pour un accès rapide par nom de modèle
        const modelsByName = new Map<string, AvailableModel>();
        for (const model of availableModels) {
          modelsByName.set(model.name, model);
        }

        // Convertir UserModelOption[] en ComposerModel[]
        // Utiliser l'ID unique de l'option pour différencier les modèles avec différents paramètres
        const models: ComposerModel[] = userModelOptions.map(
          (option: UserModelOption) => {
            const dbModel = modelsByName.get(option.model);
            return {
              // Utiliser l'ID unique de l'option (pas le nom du modèle)
              // pour permettre plusieurs configurations du même modèle
              id: option.id,
              // Utiliser le label configuré, sinon display_name de la BD, sinon le nom du modèle
              label: option.label || dbModel?.display_name || option.model,
              // Utiliser la description configurée, sinon celle de la BD
              description: option.description || dbModel?.description,
              default: option.default,
            };
          }
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
