import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useModalContext } from "../contexts/ModalContext";
import { useWorkflowContext } from "../contexts/WorkflowContext";
import { useGraphContext } from "../contexts/GraphContext";
import { chatkitApi } from "../../../utils/backend";
import styles from "../WorkflowBuilderPage.module.css";
import type { ApiWorkflowNode, ApiWorkflowEdge } from "../types";

interface GenerationPromptSummary {
  id: number;
  name: string;
  description: string | null;
  is_default: boolean;
}

interface GenerationTaskStatus {
  task_id: string;
  workflow_id: number;
  version_id: number | null;
  prompt_id: number | null;
  user_message: string;
  status: string;
  progress: number;
  error_message: string | null;
  result_json: {
    nodes: ApiWorkflowNode[];
    edges: ApiWorkflowEdge[];
  } | null;
  created_at: string;
  completed_at: string | null;
}

export default function WorkflowGenerationModal() {
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
  const { setNodes, setEdges, addHistoryEntry, nodes: currentNodes, edges: currentEdges } = useGraphContext();

  const [userMessage, setUserMessage] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);

  // Fetch active generation prompts
  const { data: prompts, isLoading: isLoadingPrompts } = useQuery({
    queryKey: ["workflow-generation-prompts"],
    queryFn: async () => {
      const response = await chatkitApi.get<GenerationPromptSummary[]>(
        "/api/workflows/generation/prompts"
      );
      return response;
    },
    enabled: isGenerationModalOpen,
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
      const response = await chatkitApi.post<{
        task_id: string;
        status: string;
        message: string;
      }>(`/api/workflows/${selectedWorkflowId}/generate`, {
        prompt_id: selectedPromptId,
        user_message: userMessage,
      });
      return response;
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
    queryFn: async () => {
      const response = await chatkitApi.get<GenerationTaskStatus>(
        `/api/workflows/generation/tasks/${generationTaskId}`
      );
      return response;
    },
    enabled: Boolean(generationTaskId) && isGenerating,
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
      // Store previous state for undo
      addHistoryEntry({
        nodes: currentNodes,
        edges: currentEdges,
      });

      // Transform nodes and edges from API format to flow format
      const { nodes: newNodes, edges: newEdges } = taskStatus.result_json;

      // Convert API nodes to flow nodes with proper positions
      const flowNodes = newNodes.map((node, index) => ({
        id: node.slug,
        type: node.kind === "while" ? "whileNode" : "customNode",
        position: node.metadata?.position ?? { x: 100 + (index % 5) * 300, y: 100 + Math.floor(index / 5) * 200 },
        data: {
          slug: node.slug,
          kind: node.kind,
          display_name: node.display_name,
          agent_key: node.agent_key,
          parent_slug: node.parent_slug,
          position: node.position ?? index + 1,
          is_enabled: node.is_enabled ?? true,
          parameters: node.parameters ?? {},
          metadata: node.metadata ?? {},
          created_at: node.created_at,
          updated_at: node.updated_at,
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
  }, [taskStatus, setNodes, setEdges, addHistoryEntry, currentNodes, currentEdges, setIsGenerating, setGenerationTaskId, setGenerationError, closeGenerationModal]);

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

  return (
    <Dialog.Root open={isGenerationModalOpen} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.modalOverlay} />
        <Dialog.Content className={styles.modalContent}>
          <Dialog.Title className={styles.modalTitle}>
            Générer un workflow avec l'IA
          </Dialog.Title>
          <Dialog.Description className={styles.modalDescription}>
            Décrivez le workflow que vous souhaitez créer et l'IA le générera pour vous.
          </Dialog.Description>

          <form onSubmit={handleSubmit}>
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
                value={selectedPromptId ?? ""}
                onChange={(e) => setSelectedPromptId(Number(e.target.value))}
                disabled={isLoadingPrompts || isGenerating}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "0.375rem",
                  border: "1px solid var(--color-border, #e5e7eb)",
                  fontSize: "0.875rem",
                }}
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
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                placeholder="Exemple: Crée un workflow pédagogique pour enseigner les bases de Python avec des questions à choix multiples et des exercices pratiques..."
                disabled={isGenerating}
                rows={6}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "0.375rem",
                  border: "1px solid var(--color-border, #e5e7eb)",
                  fontSize: "0.875rem",
                  resize: "vertical",
                  fontFamily: "inherit",
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

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={handleClose}
                disabled={isGenerating}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "0.375rem",
                  border: "1px solid var(--color-border, #e5e7eb)",
                  backgroundColor: "white",
                  cursor: isGenerating ? "not-allowed" : "pointer",
                  opacity: isGenerating ? 0.5 : 1,
                }}
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={
                  !userMessage.trim() ||
                  !selectedPromptId ||
                  isGenerating ||
                  !prompts?.length
                }
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "0.375rem",
                  border: "none",
                  backgroundColor: "#3b82f6",
                  color: "white",
                  cursor:
                    !userMessage.trim() || !selectedPromptId || isGenerating || !prompts?.length
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    !userMessage.trim() || !selectedPromptId || isGenerating || !prompts?.length
                      ? 0.5
                      : 1,
                }}
              >
                {isGenerating ? "Génération..." : "Générer"}
              </button>
            </div>
          </form>

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Fermer"
              onClick={handleClose}
              disabled={isGenerating}
              style={{
                position: "absolute",
                top: "1rem",
                right: "1rem",
                background: "none",
                border: "none",
                cursor: isGenerating ? "not-allowed" : "pointer",
                padding: "0.25rem",
                opacity: isGenerating ? 0.5 : 1,
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>

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
    </Dialog.Root>
  );
}
