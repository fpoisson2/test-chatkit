/**
 * Hook pour la génération de workflows par IA avec streaming de progression.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";

export interface WorkflowGenerationRequest {
  description: string;
  workflow_name?: string;
  workflow_slug?: string;
  model?: string;
  temperature?: number;
  save_to_database?: boolean;
}

export interface WorkflowGenerationProgress {
  task_id: string;
  state: "PENDING" | "PROGRESS" | "SUCCESS" | "FAILURE" | "ERROR";
  status: string;
  step: string;
  current: number;
  total: number;
  nodes_count?: number;
  edges_count?: number;
  description?: string;
  error?: string;
  errors?: string[];
  result?: any;
}

export interface GeneratedWorkflow {
  graph: {
    nodes: any[];
    edges: any[];
  };
  workflow_name: string;
  workflow_slug: string;
  description: string;
  validation_passed: boolean;
  validation_errors: string[];
  workflow_id?: number;
  tokens_used?: number;
}

/**
 * Hook pour générer un workflow par IA avec streaming de progression.
 */
export const useWorkflowGeneration = () => {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<WorkflowGenerationProgress | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [generatedWorkflow, setGeneratedWorkflow] = useState<GeneratedWorkflow | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Nettoyer l'EventSource à la destruction
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // Mutation pour démarrer la génération
  const startGenerationMutation = useMutation({
    mutationFn: async (request: WorkflowGenerationRequest) => {
      const response = await fetch("/ai-workflows/generate-async", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          description: request.description,
          workflow_name: request.workflow_name,
          workflow_slug: request.workflow_slug,
          model: request.model || "gpt-4o-2024-08-06",
          temperature: request.temperature ?? 0.3,
          save_to_database: request.save_to_database ?? false,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Échec du lancement de la génération");
      }

      return response.json();
    },
    onSuccess: (data: { task_id: string }) => {
      // Démarrer le streaming de progression
      startStreaming(data.task_id);
    },
  });

  /**
   * Démarre le streaming de progression via SSE.
   */
  const startStreaming = useCallback((taskId: string) => {
    // Fermer l'EventSource existant si présent
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setIsStreaming(true);
    setGeneratedWorkflow(null);

    const eventSource = new EventSource(`/ai-workflows/stream/${taskId}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data: WorkflowGenerationProgress = JSON.parse(event.data);
        setProgress(data);

        // Si la tâche est terminée avec succès
        if (data.state === "SUCCESS" && data.result) {
          setGeneratedWorkflow(data.result.workflow);
          setIsStreaming(false);
          eventSource.close();

          // Invalider le cache des workflows si sauvegardé en base
          if (data.result.workflow.workflow_id) {
            queryClient.invalidateQueries({ queryKey: ["workflows"] });
          }
        }

        // Si la tâche a échoué
        if (data.state === "FAILURE" || data.state === "ERROR") {
          setIsStreaming(false);
          eventSource.close();
        }
      } catch (error) {
        console.error("Erreur lors du parsing des données SSE:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("Erreur EventSource:", error);
      setIsStreaming(false);
      eventSource.close();
      setProgress({
        task_id: taskId,
        state: "ERROR",
        status: "Erreur de connexion au serveur",
        step: "error",
        current: 0,
        total: 100,
        error: "Impossible de se connecter au serveur de streaming",
      });
    };
  }, [queryClient]);

  /**
   * Annule la génération en cours.
   */
  const cancelGeneration = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
    setProgress(null);
  }, []);

  /**
   * Réinitialise l'état.
   */
  const reset = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
    setProgress(null);
    setGeneratedWorkflow(null);
  }, []);

  return {
    // État
    progress,
    isStreaming,
    generatedWorkflow,
    isGenerating: startGenerationMutation.isPending || isStreaming,
    error: startGenerationMutation.error,

    // Actions
    startGeneration: startGenerationMutation.mutate,
    cancelGeneration,
    reset,
  };
};

/**
 * Hook pour obtenir les capacités du générateur.
 */
export const useGeneratorCapabilities = () => {
  const { token } = useAuth();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/ai-workflows/capabilities", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Échec de la récupération des capacités");
      }

      return response.json();
    },
  });
};
