import { useCallback, useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "../../../components/Modal";
import { useModalContext } from "../contexts/ModalContext";
import { useWorkflowContext } from "../contexts/WorkflowContext";
import { useGraphContext } from "../contexts/GraphContext";
import { useAuth } from "../../../auth";
import {
  workflowGenerationApi,
  type WorkflowGenerationPromptSummary,
  type WorkflowGenerationStreamEvent,
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
    generationError,
  } = useModalContext();

  const { selectedWorkflowId } = useWorkflowContext();
  const { setNodes, setEdges } = useGraphContext();

  const [userMessage, setUserMessage] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);

  // Streaming state
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reasoningEndRef = useRef<HTMLDivElement>(null);
  const contentEndRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll to bottom of streaming content
  useEffect(() => {
    reasoningEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingReasoning]);

  useEffect(() => {
    contentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingContent]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!userMessage.trim() || !selectedWorkflowId) return;

      setGenerationError(null);
      setStreamingReasoning("");
      setStreamingContent("");
      setIsGenerating(true);

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();

      try {
        const stream = workflowGenerationApi.streamGeneration(
          token,
          selectedWorkflowId,
          { prompt_id: selectedPromptId, user_message: userMessage },
          abortControllerRef.current.signal
        );

        for await (const event of stream) {
          switch (event.type) {
            case "reasoning":
              if (typeof event.content === "string") {
                setStreamingReasoning((prev) => prev + event.content);
              }
              break;

            case "content":
              if (typeof event.content === "string") {
                setStreamingContent((prev) => prev + event.content);
              }
              break;

            case "result":
              if (event.content && typeof event.content === "object") {
                const { nodes: newNodes, edges: newEdges } = event.content as {
                  nodes: ApiWorkflowNode[];
                  edges: ApiWorkflowEdge[];
                };

                // Convert API nodes to flow nodes
                const flowNodes = newNodes.map((node, index) => ({
                  id: node.slug,
                  type: node.kind === "while" ? "whileNode" : "customNode",
                  position: node.metadata?.position ?? {
                    x: 100 + (index % 5) * 300,
                    y: 100 + Math.floor(index / 5) * 200,
                  },
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
              }
              break;

            case "error":
              setGenerationError(
                typeof event.content === "string"
                  ? event.content
                  : "Une erreur est survenue"
              );
              break;

            case "done":
              // Stream completed
              break;
          }
        }

        setIsGenerating(false);
        setGenerationTaskId(null);

        // Only close if successful (no error)
        if (!generationError) {
          closeGenerationModal();
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          // User cancelled
          setGenerationError("Génération annulée");
        } else {
          setGenerationError((error as Error).message || "Erreur de génération");
        }
        setIsGenerating(false);
      }
    },
    [
      userMessage,
      selectedWorkflowId,
      selectedPromptId,
      token,
      setGenerationError,
      setIsGenerating,
      setGenerationTaskId,
      setNodes,
      setEdges,
      closeGenerationModal,
      generationError,
    ]
  );

  const handleClose = useCallback(() => {
    if (isGenerating) {
      // Cancel the streaming
      abortControllerRef.current?.abort();
    }
    setUserMessage("");
    setStreamingReasoning("");
    setStreamingContent("");
    setGenerationError(null);
    closeGenerationModal();
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
          >
            {isGenerating ? "Annuler" : "Fermer"}
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
            rows={4}
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

        {/* Streaming Reasoning Section */}
        {(isGenerating || streamingReasoning) && (
          <div
            style={{
              marginBottom: "1rem",
              border: "1px solid #e5e7eb",
              borderRadius: "0.375rem",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                backgroundColor: "#f9fafb",
                border: "none",
                borderBottom: isReasoningExpanded ? "1px solid #e5e7eb" : "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#374151",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1rem" }}>🧠</span>
                Raisonnement de l'IA
                {isGenerating && streamingReasoning && (
                  <span
                    style={{
                      width: "0.5rem",
                      height: "0.5rem",
                      backgroundColor: "#10b981",
                      borderRadius: "50%",
                      animation: "pulse 1.5s ease-in-out infinite",
                    }}
                  />
                )}
              </span>
              <span style={{ transform: isReasoningExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                ▼
              </span>
            </button>
            {isReasoningExpanded && (
              <div
                style={{
                  maxHeight: "150px",
                  overflowY: "auto",
                  padding: "0.75rem",
                  backgroundColor: "#f3f4f6",
                  fontSize: "0.8125rem",
                  fontFamily: "monospace",
                  whiteSpace: "pre-wrap",
                  color: "#4b5563",
                  lineHeight: 1.5,
                }}
              >
                {streamingReasoning || (
                  <span style={{ color: "#9ca3af", fontStyle: "italic" }}>
                    En attente du raisonnement...
                  </span>
                )}
                <div ref={reasoningEndRef} />
              </div>
            )}
          </div>
        )}

        {/* Streaming Content Section */}
        {(isGenerating || streamingContent) && (
          <div
            style={{
              marginBottom: "1rem",
              border: "1px solid #bfdbfe",
              borderRadius: "0.375rem",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "0.5rem 0.75rem",
                backgroundColor: "#eff6ff",
                borderBottom: "1px solid #bfdbfe",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#1d4ed8",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span style={{ fontSize: "1rem" }}>📝</span>
              Réponse de l'IA
              {isGenerating && (
                <div
                  style={{
                    width: "1rem",
                    height: "1rem",
                    border: "2px solid #3b82f6",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                    marginLeft: "auto",
                  }}
                />
              )}
            </div>
            <div
              style={{
                maxHeight: "200px",
                overflowY: "auto",
                padding: "0.75rem",
                backgroundColor: "#fff",
                fontSize: "0.8125rem",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                color: "#111827",
                lineHeight: 1.5,
              }}
            >
              {streamingContent || (
                <span style={{ color: "#9ca3af", fontStyle: "italic" }}>
                  En attente de la réponse...
                </span>
              )}
              <div ref={contentEndRef} />
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
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </Modal>
  );
}
