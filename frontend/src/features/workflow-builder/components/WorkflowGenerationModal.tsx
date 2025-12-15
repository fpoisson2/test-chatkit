import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Modal } from "../../../components/Modal";
import { useModalContext } from "../contexts/ModalContext";
import { useWorkflowContext } from "../contexts/WorkflowContext";
import { useGraphContext } from "../contexts/GraphContext";
import { useAuth } from "../../../auth";
import {
  workflowGenerationApi,
  type WorkflowGenerationPromptSummary,
  type WorkflowGenerationTaskStatus,
} from "../../../utils/backend";
import type { ApiWorkflowNode, ApiWorkflowEdge } from "../types";

export default function WorkflowGenerationModal() {
  const { token } = useAuth();
  const {
    isGenerationModalOpen,
    closeGenerationModal,
    isGenerating,
    setIsGenerating,
    setGenerationTaskId,
    setGenerationError,
    generationTaskId,
    generationError,
  } = useModalContext();

  const { selectedWorkflowId } = useWorkflowContext();
  const { setNodes, setEdges } = useGraphContext();

  const [userMessage, setUserMessage] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);

  // Fetch active generation prompts
  const { data: prompts, isLoading: isLoadingPrompts } = useQuery({
    queryKey: ["workflow-generation-prompts"],
    queryFn: () => workflowGenerationApi.listPrompts(token),
    enabled: isGenerationModalOpen && Boolean(token),
  });

  // Set default prompt when prompts are loaded
  useEffect(() => {
    if (prompts && prompts.length > 0 && selectedPromptId === null) {
      const defaultPrompt = prompts.find((p) => p.is_default);
      setSelectedPromptId(defaultPrompt?.id ?? prompts[0].id);
    }
  }, [prompts, selectedPromptId]);

  // Start generation mutation
  const startGenerationMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkflowId) throw new Error("No workflow selected");
      return workflowGenerationApi.startGeneration(token, selectedWorkflowId, {
        prompt_id: selectedPromptId,
        user_message: userMessage,
      });
    },
    onSuccess: (data) => {
      setGenerationTaskId(data.task_id);
      setIsGenerating(true);
    },
    onError: (error: Error) => {
      setGenerationError(error.message);
      setIsGenerating(false);
    },
  });

  // Poll for task status
  const { data: taskStatus } = useQuery({
    queryKey: ["workflow-generation-task", generationTaskId],
    queryFn: () => workflowGenerationApi.getTaskStatus(token, generationTaskId!),
    enabled: Boolean(generationTaskId) && isGenerating && Boolean(token),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === "completed" || data.status === "failed")) {
        return false;
      }
      return 1500; // Poll every 1.5 seconds
    },
  });

  // Handle task completion
  useEffect(() => {
    if (!taskStatus) return;

    if (taskStatus.status === "completed" && taskStatus.result_json) {
      // Transform nodes and edges from API format to flow format
      const { nodes: newNodes, edges: newEdges } = taskStatus.result_json as {
        nodes: ApiWorkflowNode[];
        edges: ApiWorkflowEdge[];
      };

      // Convert API nodes to flow nodes with proper positions
      const flowNodes = newNodes.map((node, index) => ({
        id: node.slug,
        type: node.kind === "while" ? "whileNode" : "customNode",
        position: node.metadata?.position ?? { x: 100 + (index % 5) * 300, y: 100 + Math.floor(index / 5) * 200 },
        data: {
          slug: node.slug,
          kind: node.kind,
          displayName: node.display_name || node.slug,
          label: node.display_name || node.slug,
          isEnabled: node.is_enabled ?? true,
          agentKey: node.agent_key ?? null,
          parentSlug: node.parent_slug ?? null,
          parameters: node.parameters ?? {},
          parametersText: JSON.stringify(node.parameters ?? {}, null, 2),
          parametersError: null,
          metadata: node.metadata ?? {},
        },
        selected: false,
        dragging: false,
      }));

      // Convert API edges to flow edges
      const flowEdges = newEdges.map((edge, index) => ({
        id: `edge-${edge.source}-${edge.target}-${edge.condition ?? "default"}-${index}`,
        source: edge.source,
        target: edge.target,
        type: "smart",
        data: {
          condition: edge.condition,
          metadata: edge.metadata ?? {},
          created_at: edge.created_at,
          updated_at: edge.updated_at,
        },
        selected: false,
      }));

      setNodes(flowNodes);
      setEdges(flowEdges);

      setIsGenerating(false);
      setGenerationTaskId(null);
      closeGenerationModal();
    } else if (taskStatus.status === "failed") {
      setGenerationError(taskStatus.error_message ?? "Génération échouée");
      setIsGenerating(false);
      setGenerationTaskId(null);
    }
  }, [taskStatus, setNodes, setEdges, setIsGenerating, setGenerationTaskId, setGenerationError, closeGenerationModal]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!userMessage.trim() || !selectedWorkflowId) return;
      setGenerationError(null);
      startGenerationMutation.mutate();
    },
    [userMessage, selectedWorkflowId, startGenerationMutation, setGenerationError]
  );

  const handleClose = useCallback(() => {
    if (!isGenerating) {
      setUserMessage("");
      setGenerationError(null);
      closeGenerationModal();
    }
  }, [isGenerating, closeGenerationModal, setGenerationError]);

  if (!isGenerationModalOpen) {
    return null;
  }

  return (
    <Modal
      title="Générer un workflow avec l'IA"
      onClose={handleClose}
      size="lg"
      footer={
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleClose}
            disabled={isGenerating}
          >
            Annuler
          </button>
          <button
            type="submit"
            form="generation-form"
            className="btn btn-primary"
            disabled={
              !userMessage.trim() ||
              !selectedPromptId ||
              isGenerating ||
              !prompts?.length
            }
          >
            {isGenerating ? "Génération..." : "Générer"}
          </button>
        </div>
      }
    >
      <form id="generation-form" onSubmit={handleSubmit}>
        <p style={{ marginBottom: "1rem", color: "#6b7280", fontSize: "0.875rem" }}>
          Décrivez le workflow que vous souhaitez créer et l'IA le générera pour vous.
        </p>

        <div style={{ marginBottom: "1rem" }}>
          <label
            htmlFor="generation-prompt-select"
            style={{
              display: "block",
              marginBottom: "0.5rem",
              fontWeight: 500,
              fontSize: "0.875rem",
            }}
          >
            Type de génération
          </label>
          <select
            id="generation-prompt-select"
            className="form-select"
            value={selectedPromptId ?? ""}
            onChange={(e) => setSelectedPromptId(Number(e.target.value))}
            disabled={isLoadingPrompts || isGenerating}
            style={{ width: "100%" }}
          >
            {isLoadingPrompts ? (
              <option>Chargement...</option>
            ) : prompts && prompts.length > 0 ? (
              prompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name}
                  {prompt.is_default ? " (par défaut)" : ""}
                </option>
              ))
            ) : (
              <option value="">Aucun prompt configuré</option>
            )}
          </select>
          {prompts && selectedPromptId && (
            <p style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#6b7280" }}>
              {prompts.find((p) => p.id === selectedPromptId)?.description}
            </p>
          )}
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label
            htmlFor="generation-user-message"
            style={{
              display: "block",
              marginBottom: "0.5rem",
              fontWeight: 500,
              fontSize: "0.875rem",
            }}
          >
            Décrivez votre workflow
          </label>
          <textarea
            id="generation-user-message"
            className="form-textarea"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            placeholder="Exemple: Crée un workflow pédagogique pour enseigner les bases de Python avec des questions à choix multiples et des exercices pratiques..."
            disabled={isGenerating}
            rows={6}
            style={{
              width: "100%",
              resize: "vertical",
            }}
          />
        </div>

        {generationError && (
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.75rem",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "0.375rem",
              color: "#dc2626",
              fontSize: "0.875rem",
            }}
          >
            {generationError}
          </div>
        )}

        {isGenerating && taskStatus && (
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.75rem",
              backgroundColor: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: "0.375rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div
                className="spinner"
                style={{
                  width: "1rem",
                  height: "1rem",
                  border: "2px solid #3b82f6",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
              <span style={{ fontSize: "0.875rem", color: "#1d4ed8" }}>
                Génération en cours... {taskStatus.progress}%
              </span>
            </div>
            <div
              style={{
                marginTop: "0.5rem",
                height: "0.5rem",
                backgroundColor: "#dbeafe",
                borderRadius: "0.25rem",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${taskStatus.progress}%`,
                  height: "100%",
                  backgroundColor: "#3b82f6",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}
      </form>

      <style>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </Modal>
  );
}
