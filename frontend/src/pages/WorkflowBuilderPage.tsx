import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { useAuth } from "../auth";
import { makeApiEndpointCandidates } from "../utils/backend";
import {
  parseAgentParameters,
  stringifyAgentParameters,
  type AgentParameters,
} from "../utils/workflows";

const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();

type ApiWorkflowStep = {
  id?: number;
  agent_key: string;
  position: number;
  is_enabled: boolean;
  parameters: AgentParameters;
};

type WorkflowResponse = {
  id: number;
  name: string;
  is_active: boolean;
  steps: ApiWorkflowStep[];
};

type EditableWorkflowStep = {
  key: string;
  id?: number;
  agent_key: string;
  position: number;
  is_enabled: boolean;
  parametersText: string;
  parametersError: string | null;
};

type SortableStepProps = {
  step: EditableWorkflowStep;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onToggle: (stepKey: string) => void;
  onMove: (stepKey: string, direction: -1 | 1) => void;
  onParametersChange: (stepKey: string, value: string) => void;
};

const SortableStep = ({ step, index, isFirst, isLast, onToggle, onMove, onParametersChange }: SortableStepProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.key,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    background: "var(--workflow-card-bg, #fff)",
    border: "1px solid rgba(15, 23, 42, 0.08)",
    borderRadius: "0.75rem",
    padding: "1rem",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08)",
  };

  return (
    <article ref={setNodeRef} style={style} aria-label={`Étape ${index + 1}`}> 
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <button
          type="button"
          aria-label={`Déplacer l'étape ${step.agent_key}`}
          style={{
            cursor: "grab",
            border: "none",
            background: "transparent",
            fontSize: "1.25rem",
            lineHeight: 1,
          }}
          {...attributes}
          {...listeners}
        >
          ≡
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{index + 1}. {step.agent_key}</div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={step.is_enabled}
            onChange={() => onToggle(step.key)}
          />
          Activer
        </label>
      </header>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <button
          type="button"
          onClick={() => onMove(step.key, -1)}
          disabled={isFirst}
          style={{ padding: "0.4rem 0.75rem" }}
        >
          Monter
        </button>
        <button
          type="button"
          onClick={() => onMove(step.key, 1)}
          disabled={isLast}
          style={{ padding: "0.4rem 0.75rem" }}
        >
          Descendre
        </button>
      </div>
      <label style={{ display: "block", fontWeight: 500, marginBottom: "0.5rem" }}>
        Paramètres JSON
        <textarea
          value={step.parametersText}
          onChange={(event) => onParametersChange(step.key, event.currentTarget.value)}
          rows={8}
          style={{
            width: "100%",
            fontFamily: "var(--font-mono, monospace)",
            marginTop: "0.5rem",
            borderRadius: "0.5rem",
            border: step.parametersError ? "1px solid #dc2626" : "1px solid rgba(15,23,42,0.15)",
            padding: "0.75rem",
          }}
        />
      </label>
      {step.parametersError ? (
        <p style={{ color: "#dc2626", marginTop: "0.25rem" }}>{step.parametersError}</p>
      ) : null}
    </article>
  );
};

export const WorkflowBuilderPage = () => {
  const { token, logout } = useAuth();
  const [steps, setSteps] = useState<EditableWorkflowStep[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const headers = useMemo(() => {
    const base: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      base.Authorization = `Bearer ${token}`;
    }
    return base;
  }, [token]);

  const requestWithFallback = useCallback(
    async (path: string, init?: RequestInit) => {
      const endpoints = makeApiEndpointCandidates(backendUrl, path);
      let lastError: Error | null = null;
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, init);
          const sameOrigin = endpoint.startsWith("/");
          if (!response.ok && sameOrigin && endpoints.length > 1) {
            let detail = `${response.status} ${response.statusText}`;
            try {
              const body = await response.clone().json();
              if (body?.detail) {
                detail = String(body.detail);
              }
            } catch (parseError) {
              if (parseError instanceof Error) {
                detail = parseError.message;
              }
            }
            lastError = new Error(detail);
            continue;
          }
          return response;
        } catch (networkError) {
          if (networkError instanceof Error) {
            lastError = networkError;
          } else {
            lastError = new Error("Impossible de joindre l'API workflows");
          }
        }
      }
      throw lastError ?? new Error("Impossible de joindre l'API workflows");
    },
    [],
  );

  const mapSteps = useCallback((apiSteps: ApiWorkflowStep[]): EditableWorkflowStep[] =>
    apiSteps
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((step, index) => ({
        key: String(step.id ?? `${step.agent_key}-${index}`),
        id: step.id,
        agent_key: step.agent_key,
        position: index + 1,
        is_enabled: step.is_enabled,
        parametersText: stringifyAgentParameters(step.parameters),
        parametersError: null,
      })),
  []);

  const fetchWorkflow = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await requestWithFallback("/api/workflows/current", { headers });
      if (response.status === 401) {
        logout();
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      if (!response.ok) {
        const { detail } = await response.json();
        throw new Error(detail ?? "Impossible de récupérer le workflow");
      }
      const data: WorkflowResponse = await response.json();
      setSteps(mapSteps(data.steps));
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur inattendue est survenue");
      }
    } finally {
      setLoading(false);
    }
  }, [headers, logout, mapSteps, requestWithFallback, token]);

  useEffect(() => {
    void fetchWorkflow();
  }, [fetchWorkflow]);

  const handleToggle = useCallback((stepKey: string) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.key === stepKey
          ? { ...step, is_enabled: !step.is_enabled }
          : step,
      ),
    );
  }, []);

  const handleMove = useCallback((stepKey: string, direction: -1 | 1) => {
    setSteps((prev) => {
      const currentIndex = prev.findIndex((step) => step.key === stepKey);
      if (currentIndex === -1) {
        return prev;
      }
      const newIndex = currentIndex + direction;
      if (newIndex < 0 || newIndex >= prev.length) {
        return prev;
      }
      return arrayMove(prev, currentIndex, newIndex);
    });
  }, []);

  const handleParametersChange = useCallback((stepKey: string, value: string) => {
    setSteps((prev) =>
      prev.map((step) => {
        if (step.key !== stepKey) {
          return step;
        }
        let error: string | null = null;
        try {
          parseAgentParameters(value);
        } catch (parseError) {
          if (parseError instanceof Error) {
            error = parseError.message;
          } else {
            error = "Paramètres JSON invalides";
          }
        }
        return {
          ...step,
          parametersText: value,
          parametersError: error,
        };
      }),
    );
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!event.active.id || !event.over?.id || event.active.id === event.over.id) {
        return;
      }
      setSteps((prev) => {
        const oldIndex = prev.findIndex((step) => step.key === event.active.id);
        const newIndex = prev.findIndex((step) => step.key === event.over?.id);
        if (oldIndex === -1 || newIndex === -1) {
          return prev;
        }
        return arrayMove(prev, oldIndex, newIndex);
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!token) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const serializedSteps = steps.map((step, index) => {
        if (step.parametersError) {
          throw new Error(
            `Corrigez les paramètres JSON de l'étape « ${step.agent_key} » avant d'enregistrer.`,
          );
        }
        return {
          agent_key: step.agent_key,
          position: index + 1,
          is_enabled: step.is_enabled,
          parameters: parseAgentParameters(step.parametersText),
        };
      });

      const response = await requestWithFallback("/api/workflows/current", {
        method: "PUT",
        headers,
        body: JSON.stringify({ steps: serializedSteps }),
      });
      if (response.status === 401) {
        logout();
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      if (!response.ok) {
        const { detail } = await response.json();
        throw new Error(detail ?? "Impossible d'enregistrer le workflow");
      }
      const data: WorkflowResponse = await response.json();
      setSteps(mapSteps(data.steps));
      setSuccess("Configuration enregistrée avec succès");
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur inattendue est survenue");
      }
    } finally {
      setSaving(false);
    }
  }, [headers, logout, mapSteps, requestWithFallback, steps, token]);

  return (
    <section style={{ maxWidth: "960px", margin: "0 auto", padding: "2rem 1rem" }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.875rem", fontWeight: 700, marginBottom: "0.5rem" }}>
          Constructeur de workflow ChatKit
        </h1>
        <p style={{ color: "rgba(15,23,42,0.7)" }}>
          Réordonnez les étapes, activez ou désactivez des agents et ajustez leurs paramètres JSON.
        </p>
      </header>
      {error ? (
        <div
          role="alert"
          style={{
            borderRadius: "0.75rem",
            border: "1px solid rgba(220,38,38,0.2)",
            background: "rgba(254,226,226,0.6)",
            color: "#991b1b",
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          {error}
        </div>
      ) : null}
      {success ? (
        <div
          role="status"
          style={{
            borderRadius: "0.75rem",
            border: "1px solid rgba(34,197,94,0.2)",
            background: "rgba(220,252,231,0.6)",
            color: "#047857",
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          {success}
        </div>
      ) : null}
      {isLoading ? (
        <p>Chargement du workflow…</p>
      ) : (
        <DndContext onDragEnd={handleDragEnd}>
          <SortableContext items={steps.map((step) => step.key)} strategy={verticalListSortingStrategy}>
            <div style={{ display: "grid", gap: "1rem" }}>
              {steps.map((step, index) => (
                <SortableStep
                  key={step.key}
                  step={step}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === steps.length - 1}
                  onToggle={handleToggle}
                  onMove={handleMove}
                  onParametersChange={handleParametersChange}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <footer style={{ marginTop: "2rem", display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving || steps.length === 0}
          style={{
            padding: "0.75rem 1.5rem",
            borderRadius: "9999px",
            border: "none",
            background: "#2563eb",
            color: "white",
            fontWeight: 600,
            cursor: isSaving ? "wait" : "pointer",
            opacity: isSaving ? 0.7 : 1,
          }}
        >
          {isSaving ? "Enregistrement…" : "Enregistrer les modifications"}
        </button>
      </footer>
    </section>
  );
};
