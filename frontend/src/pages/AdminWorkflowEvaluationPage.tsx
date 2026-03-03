import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth";
import {
  adminApi,
  workflowsApi,
  isUnauthorizedError,
  type EvaluationRecord,
  type EvaluationSavePayload,
  type ThreadMessageItem,
  type WorkflowThreadSummary,
} from "../utils/backend";
import type { WorkflowSummary } from "../types/workflows";
import { LoadingSpinner } from "../components";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkflowStep {
  slug: string;
  kind: string;
  display_name: string | null;
}

interface WorkflowVersion {
  graph?: {
    nodes?: WorkflowStep[];
  };
}

interface ThreadWithMessages {
  thread: WorkflowThreadSummary;
  messages: ThreadMessageItem[];
  lastUserMsg: string;
  agentMsg: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const EvaluationCard = ({
  item,
  stepSlug,
  workflowId,
  existingEval,
  onSaved,
}: {
  item: ThreadWithMessages;
  stepSlug: string;
  workflowId: number;
  existingEval: EvaluationRecord | null;
  onSaved: (evaluation: EvaluationRecord) => void;
}) => {
  const { token } = useAuth();
  const [rating, setRating] = useState<"good" | "bad" | null>(
    existingEval ? (existingEval.rating as "good" | "bad") : null,
  );
  const [notes, setNotes] = useState(existingEval?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!existingEval);

  const handleSave = async () => {
    if (!rating || !token) return;
    setSaving(true);
    try {
      const payload: EvaluationSavePayload = {
        thread_id: item.thread.thread_id,
        step_slug: stepSlug,
        workflow_id: workflowId,
        user_message: item.lastUserMsg,
        agent_message: item.agentMsg,
        rating,
        notes: notes || null,
      };
      const result = await adminApi.saveEvaluation(token, payload);
      onSaved(result);
      setSaved(true);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        border: `1px solid ${saved ? "var(--color-success, #16a34a)" : "var(--color-border, #e5e7eb)"}`,
        borderRadius: "0.75rem",
        padding: "1rem",
        background: "var(--color-surface, white)",
        marginBottom: "1rem",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <span style={{ fontSize: "12px", color: "var(--color-text-muted, #6b7280)" }}>
          {item.thread.user_email}
        </span>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted, #6b7280)" }}>
          {new Date(item.thread.started_at).toLocaleString("fr-FR", {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </span>
      </div>

      {/* Conversation pair */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
        {/* User message */}
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <div
            style={{
              maxWidth: "80%",
              padding: "0.5rem 0.75rem",
              borderRadius: "0.75rem 0.75rem 0.75rem 0.125rem",
              background: "var(--color-surface-subtle, #f3f4f6)",
              fontSize: "13px",
              color: "var(--color-text, #1f2937)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {item.lastUserMsg || <em style={{ opacity: 0.5 }}>(message vide)</em>}
          </div>
        </div>

        {/* Agent response */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              maxWidth: "80%",
              padding: "0.5rem 0.75rem",
              borderRadius: "0.75rem 0.75rem 0.125rem 0.75rem",
              background: "var(--color-primary, #2563eb)",
              color: "white",
              fontSize: "13px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {item.agentMsg || <em style={{ opacity: 0.7 }}>(réponse vide)</em>}
          </div>
        </div>
      </div>

      {/* Rating + Notes */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={() => {
              setRating("good");
              setSaved(false);
            }}
            style={{
              padding: "0.375rem 0.75rem",
              borderRadius: "0.5rem",
              border: `2px solid ${rating === "good" ? "#16a34a" : "var(--color-border, #e5e7eb)"}`,
              background: rating === "good" ? "#dcfce7" : "transparent",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: rating === "good" ? 600 : 400,
              color: rating === "good" ? "#16a34a" : "var(--color-text-muted, #6b7280)",
            }}
          >
            👍 Bonne
          </button>
          <button
            type="button"
            onClick={() => {
              setRating("bad");
              setSaved(false);
            }}
            style={{
              padding: "0.375rem 0.75rem",
              borderRadius: "0.5rem",
              border: `2px solid ${rating === "bad" ? "#dc2626" : "var(--color-border, #e5e7eb)"}`,
              background: rating === "bad" ? "#fee2e2" : "transparent",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: rating === "bad" ? 600 : 400,
              color: rating === "bad" ? "#dc2626" : "var(--color-text-muted, #6b7280)",
            }}
          >
            👎 Mauvaise
          </button>
          {saved && (
            <span style={{ color: "#16a34a", fontSize: "12px", alignSelf: "center" }}>
              ✓ Sauvegardé
            </span>
          )}
        </div>

        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaved(false);
          }}
          placeholder="Notes optionnelles..."
          rows={2}
          style={{
            width: "100%",
            padding: "0.375rem 0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border, #e5e7eb)",
            background: "var(--color-surface-subtle, #f9fafb)",
            fontSize: "12px",
            resize: "vertical",
            fontFamily: "inherit",
            color: "var(--color-text, #1f2937)",
            boxSizing: "border-box",
          }}
        />

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!rating || saving}
          style={{
            alignSelf: "flex-end",
            padding: "0.375rem 1rem",
            borderRadius: "0.5rem",
            border: "none",
            background: !rating ? "var(--color-border, #e5e7eb)" : "var(--color-primary, #2563eb)",
            color: !rating ? "var(--color-text-muted, #9ca3af)" : "white",
            cursor: !rating ? "not-allowed" : "pointer",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          {saving ? "Sauvegarde..." : "Sauvegarder"}
        </button>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export const AdminWorkflowEvaluationPage = () => {
  const { token, logout } = useAuth();

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [agentSteps, setAgentSteps] = useState<WorkflowStep[]>([]);
  const [selectedStepSlug, setSelectedStepSlug] = useState<string | null>(null);
  const [threadItems, setThreadItems] = useState<ThreadWithMessages[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(true);
  const [isLoadingSteps, setIsLoadingSteps] = useState(false);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load workflows list
  useEffect(() => {
    if (!token) return;
    setIsLoadingWorkflows(true);
    workflowsApi
      .list(token)
      .then((wfs) => setWorkflows(wfs))
      .catch((err) => {
        if (isUnauthorizedError(err)) logout();
        else setError("Impossible de charger les workflows.");
      })
      .finally(() => setIsLoadingWorkflows(false));
  }, [token, logout]);

  // Load agent steps when workflow changes
  useEffect(() => {
    if (!token || !selectedWorkflowId) {
      setAgentSteps([]);
      setSelectedStepSlug(null);
      setThreadItems([]);
      return;
    }
    const wf = workflows.find((w) => w.id === selectedWorkflowId);
    if (!wf?.active_version_id) {
      setAgentSteps([]);
      return;
    }
    setIsLoadingSteps(true);
    workflowsApi
      .getVersion(token, selectedWorkflowId, wf.active_version_id)
      .then((version) => {
        const versionData = version as unknown as WorkflowVersion;
        const nodes = versionData?.graph?.nodes ?? [];
        setAgentSteps(
          nodes.filter((n) =>
            ["agent", "voice_agent", "assistant_message"].includes(n.kind),
          ),
        );
      })
      .catch(() => setAgentSteps([]))
      .finally(() => setIsLoadingSteps(false));
    setSelectedStepSlug(null);
    setThreadItems([]);
  }, [selectedWorkflowId, workflows, token]);

  // Load threads + messages when step changes
  const loadThreadsForStep = useCallback(
    async (workflowId: number, stepSlug: string) => {
      if (!token) return;
      setIsLoadingThreads(true);
      setThreadItems([]);
      setError(null);
      try {
        const [threads, evals] = await Promise.all([
          adminApi.listWorkflowThreads(token, workflowId),
          adminApi.getEvaluations(token, workflowId, stepSlug),
        ]);
        setEvaluations(evals);

        // For each thread, load messages and find the last user+assistant pair
        const items: ThreadWithMessages[] = [];
        await Promise.all(
          threads.map(async (thread) => {
            try {
              const messages = await adminApi.getThreadMessages(token, thread.thread_id);
              // Walk messages in order; track the last user message seen before each assistant reply
              let pendingUserMsg = "";
              let lastUserMsg = "";
              let agentMsg = "";
              for (const msg of messages) {
                if (msg.role === "user") {
                  pendingUserMsg = msg.content_text;
                } else if (msg.role === "assistant" && pendingUserMsg) {
                  lastUserMsg = pendingUserMsg;
                  agentMsg = msg.content_text;
                  pendingUserMsg = ""; // consumed
                }
              }
              if (agentMsg) {
                items.push({ thread, messages, lastUserMsg, agentMsg });
              }
            } catch {
              // skip threads that fail
            }
          }),
        );

        setThreadItems(items);
      } catch (err) {
        if (isUnauthorizedError(err)) logout();
        else setError("Impossible de charger les conversations.");
      } finally {
        setIsLoadingThreads(false);
      }
    },
    [token, logout],
  );

  useEffect(() => {
    if (selectedWorkflowId && selectedStepSlug) {
      void loadThreadsForStep(selectedWorkflowId, selectedStepSlug);
    }
  }, [selectedWorkflowId, selectedStepSlug, loadThreadsForStep]);

  const handleEvaluationSaved = (evaluation: EvaluationRecord) => {
    setEvaluations((prev) => {
      const idx = prev.findIndex(
        (e) => e.thread_id === evaluation.thread_id && e.step_slug === evaluation.step_slug,
      );
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = evaluation;
        return updated;
      }
      return [...prev, evaluation];
    });
  };

  const handleExport = async (rating?: "good" | "bad") => {
    if (!token || !selectedWorkflowId) return;
    try {
      const blob = await adminApi.exportEvaluations(
        token,
        selectedWorkflowId,
        selectedStepSlug ?? undefined,
        rating,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evaluations_${selectedWorkflowId}${selectedStepSlug ? `_${selectedStepSlug}` : ""}${rating ? `_${rating}` : ""}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Erreur lors de l'export.");
    }
  };

  const evalMap = new Map(evaluations.map((e) => [e.thread_id, e]));

  return (
    <div style={{ padding: "1.5rem", maxWidth: "900px" }}>
      <h2
        style={{
          fontSize: "1.25rem",
          fontWeight: 700,
          marginBottom: "0.25rem",
          color: "var(--color-text, #1f2937)",
        }}
      >
        Évaluation des réponses d&apos;agents
      </h2>
      <p
        style={{
          fontSize: "13px",
          color: "var(--color-text-muted, #6b7280)",
          marginBottom: "1.5rem",
        }}
      >
        Évaluez les réponses d&apos;agents pour améliorer les prompts et construire des datasets de fine-tuning.
      </p>

      {error && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: "0.5rem",
            color: "#dc2626",
            fontSize: "13px",
            marginBottom: "1rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Step 1: Workflow selector */}
      <div
        style={{
          background: "var(--color-surface, white)",
          border: "1px solid var(--color-border, #e5e7eb)",
          borderRadius: "0.75rem",
          padding: "1rem",
          marginBottom: "1rem",
        }}
      >
        <label
          style={{
            display: "block",
            fontSize: "13px",
            fontWeight: 600,
            marginBottom: "0.5rem",
            color: "var(--color-text, #1f2937)",
          }}
        >
          1. Sélectionner un workflow
        </label>
        {isLoadingWorkflows ? (
          <LoadingSpinner text="Chargement..." />
        ) : (
          <select
            value={selectedWorkflowId ?? ""}
            onChange={(e) =>
              setSelectedWorkflowId(e.target.value ? Number(e.target.value) : null)
            }
            style={{
              width: "100%",
              padding: "0.5rem 0.75rem",
              borderRadius: "0.5rem",
              border: "1px solid var(--color-border, #e5e7eb)",
              background: "var(--color-surface-subtle, #f9fafb)",
              fontSize: "13px",
              color: "var(--color-text, #1f2937)",
            }}
          >
            <option value="">-- Choisir un workflow --</option>
            {workflows.map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.display_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Step 2: Step selector */}
      {selectedWorkflowId && (
        <div
          style={{
            background: "var(--color-surface, white)",
            border: "1px solid var(--color-border, #e5e7eb)",
            borderRadius: "0.75rem",
            padding: "1rem",
            marginBottom: "1rem",
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              marginBottom: "0.5rem",
              color: "var(--color-text, #1f2937)",
            }}
          >
            2. Sélectionner un step agent
          </label>
          {isLoadingSteps ? (
            <LoadingSpinner text="Chargement des steps..." />
          ) : agentSteps.length === 0 ? (
            <p style={{ fontSize: "13px", color: "var(--color-text-muted, #6b7280)" }}>
              Aucun step agent trouvé dans ce workflow.
            </p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {agentSteps.map((step) => (
                <button
                  key={step.slug}
                  type="button"
                  onClick={() => setSelectedStepSlug(step.slug)}
                  style={{
                    padding: "0.375rem 0.75rem",
                    borderRadius: "0.5rem",
                    border: `2px solid ${selectedStepSlug === step.slug ? "var(--color-primary, #2563eb)" : "var(--color-border, #e5e7eb)"}`,
                    background:
                      selectedStepSlug === step.slug
                        ? "rgba(37,99,235,0.08)"
                        : "var(--color-surface-subtle, #f9fafb)",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: selectedStepSlug === step.slug ? 600 : 400,
                    color:
                      selectedStepSlug === step.slug
                        ? "var(--color-primary, #2563eb)"
                        : "var(--color-text, #1f2937)",
                  }}
                >
                  {step.display_name ?? step.slug}
                  <span
                    style={{
                      marginLeft: "0.375rem",
                      fontSize: "10px",
                      color: "var(--color-text-muted, #9ca3af)",
                    }}
                  >
                    ({step.kind})
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Evaluation grid */}
      {selectedStepSlug && selectedWorkflowId && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1rem",
            }}
          >
            <h3
              style={{
                fontSize: "1rem",
                fontWeight: 600,
                color: "var(--color-text, #1f2937)",
              }}
            >
              3. Évaluation des conversations
            </h3>

            {/* Export buttons */}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => void handleExport("good")}
                style={{
                  padding: "0.375rem 0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #16a34a",
                  background: "transparent",
                  color: "#16a34a",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                ↓ Export bonnes réponses (JSONL)
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                style={{
                  padding: "0.375rem 0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--color-border, #e5e7eb)",
                  background: "transparent",
                  color: "var(--color-text-muted, #6b7280)",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                ↓ Export toutes évaluations
              </button>
            </div>
          </div>

          {isLoadingThreads ? (
            <LoadingSpinner text="Chargement des conversations..." />
          ) : threadItems.length === 0 ? (
            <div
              style={{
                padding: "2rem",
                textAlign: "center",
                color: "var(--color-text-muted, #6b7280)",
                fontSize: "13px",
                background: "var(--color-surface-subtle, #f9fafb)",
                borderRadius: "0.75rem",
                border: "1px solid var(--color-border, #e5e7eb)",
              }}
            >
              Aucune conversation trouvée pour ce step.
            </div>
          ) : (
            <div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--color-text-muted, #6b7280)",
                  marginBottom: "1rem",
                }}
              >
                {threadItems.length} conversation{threadItems.length > 1 ? "s" : ""} •{" "}
                {evaluations.length} évaluée{evaluations.length > 1 ? "s" : ""}
              </p>
              {threadItems.map((item) => (
                <EvaluationCard
                  key={item.thread.thread_id}
                  item={item}
                  stepSlug={selectedStepSlug}
                  workflowId={selectedWorkflowId}
                  existingEval={evalMap.get(item.thread.thread_id) ?? null}
                  onSaved={handleEvaluationSaved}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
