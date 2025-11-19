import { useCallback, useEffect, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { Modal } from "../Modal";
import { useAuth } from "../../auth";
import { workflowsApi } from "../../utils/backend";
import { LoadingSpinner } from "../LoadingSpinner";

interface WorkflowStepInfo {
  slug: string;
  display_name: string;
  timestamp: string | null;
}

interface WorkflowUserInfo {
  id: number;
  email: string;
  is_admin: boolean;
}

interface WorkflowInfo {
  id: number;
  slug: string;
  display_name: string;
  definition_id: number | null;
}

interface ActiveWorkflowSession {
  thread_id: string;
  user: WorkflowUserInfo;
  workflow: WorkflowInfo;
  current_step: WorkflowStepInfo;
  step_history: WorkflowStepInfo[];
  started_at: string;
  last_activity: string;
  status: "active" | "waiting_user" | "paused";
}

interface WorkflowVisualizationModalProps {
  workflow: WorkflowInfo;
  sessions: ActiveWorkflowSession[];
  onClose: () => void;
}

interface WorkflowStep {
  id: number;
  slug: string;
  display_name: string;
  kind: string;
  position: { x: number; y: number };
  metadata?: {
    position?: { x: number; y: number };
  };
}

interface WorkflowTransition {
  id: number;
  source_step_id: number;
  target_step_id: number;
  condition?: string | null;
}

interface WorkflowVersion {
  id: number;
  workflow_id: number;
  name: string;
  version: number;
  steps: WorkflowStep[];
  graph: {
    nodes: WorkflowStep[];
    edges: WorkflowTransition[];
  };
}

type NodeStatus = "active" | "completed" | "pending";

// Node personnalisé pour afficher les utilisateurs sur un step
const CustomNode = ({
  data,
}: NodeProps<{
  label: string;
  users: Array<{ email: string; is_admin: boolean }>;
  kind: string;
  nodeStatus: NodeStatus;
}>) => {
  const [showUsersList, setShowUsersList] = useState(false);

  const getNodeBaseColor = (kind: string) => {
    const colors: Record<string, string> = {
      start: "#10b981",
      end: "#ef4444",
      agent: "#3b82f6",
      condition: "#f59e0b",
      wait: "#8b5cf6",
    };
    return colors[kind] || "#6b7280";
  };

  const getNodeStyleByStatus = (nodeStatus: NodeStatus, kind: string) => {
    const baseColor = getNodeBaseColor(kind);

    switch (nodeStatus) {
      case "active":
        // Utilisateurs actuellement ici - border épais + background plus opaque
        return {
          border: `3px solid ${baseColor}`,
          background: `color-mix(in srgb, ${baseColor} 20%, var(--color-surface, white))`,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${baseColor} 30%, transparent)`,
        };
      case "completed":
        // Déjà complété - border normale + background opaque
        return {
          border: `2px solid ${baseColor}`,
          background: `color-mix(in srgb, ${baseColor} 10%, var(--color-surface, white))`,
          boxShadow: "none",
        };
      case "pending":
        // Pas encore atteint - gris + dashed
        return {
          border: "2px dashed var(--color-border-subtle, #d1d5db)",
          background: "var(--color-surface-subtle, #f9fafb)",
          boxShadow: "none",
          opacity: 0.6,
        };
      default:
        return {
          border: `2px solid ${baseColor}`,
          background: "var(--color-surface, white)",
          boxShadow: "none",
        };
    }
  };

  const nodeStyle = getNodeStyleByStatus(data.nodeStatus, data.kind);

  return (
    <div
      style={{
        padding: "10px 20px",
        borderRadius: "8px",
        minWidth: "150px",
        position: "relative",
        transition: "all 0.3s ease",
        cursor: data.users && data.users.length > 0 ? "pointer" : "default",
        ...nodeStyle,
      }}
      onClick={() => data.users && data.users.length > 0 && setShowUsersList(!showUsersList)}
      onMouseEnter={() => data.users && data.users.length > 0 && setShowUsersList(true)}
      onMouseLeave={() => setShowUsersList(false)}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: "14px",
          marginBottom: "4px",
          color: data.nodeStatus === "pending"
            ? "var(--color-text-subtle, #9ca3af)"
            : "var(--color-text, #1f2937)",
        }}
      >
        {data.label}
      </div>
      <div style={{ fontSize: "11px", color: "var(--color-text-muted, #6b7280)" }}>
        {data.kind}
      </div>

      {/* Badge utilisateurs actuels */}
      {data.users && data.users.length > 0 && (
        <>
          <div
            style={{
              position: "absolute",
              top: "-10px",
              right: "-10px",
              background: getNodeBaseColor(data.kind),
              color: "white",
              borderRadius: "50%",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "13px",
              fontWeight: "bold",
              border: "3px solid var(--color-surface, white)",
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
              animation: "pulse 2s ease-in-out infinite",
            }}
          >
            {data.users.length}
          </div>

          {/* Liste des utilisateurs au survol/clic */}
          {showUsersList && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: "50%",
                transform: "translateX(-50%)",
                marginTop: "8px",
                background: "var(--color-surface, white)",
                border: "1px solid var(--color-border, #e5e7eb)",
                borderRadius: "8px",
                padding: "8px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                zIndex: 1000,
                minWidth: "200px",
                maxWidth: "300px",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{
                fontSize: "11px",
                fontWeight: 600,
                marginBottom: "6px",
                color: "var(--color-text, #1f2937)",
              }}>
                Utilisateurs actifs ({data.users.length})
              </div>
              {data.users.map((user, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "4px 8px",
                    fontSize: "12px",
                    borderRadius: "4px",
                    background: "var(--color-surface-subtle, #f9fafb)",
                    marginBottom: idx < data.users.length - 1 ? "4px" : "0",
                    color: "var(--color-text, #1f2937)",
                  }}
                >
                  {user.email}
                  {user.is_admin && (
                    <span style={{
                      marginLeft: "6px",
                      fontSize: "10px",
                      color: "var(--color-text-muted, #6b7280)",
                    }}>
                      (admin)
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Indicateur de statut */}
      {data.nodeStatus === "completed" && data.users.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: "-8px",
            right: "-8px",
            background: "#10b981",
            color: "white",
            borderRadius: "50%",
            width: "20px",
            height: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            border: "2px solid var(--color-surface, white)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
          title="Étape complétée"
        >
          ✓
        </div>
      )}
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

export const WorkflowVisualizationModal = ({
  workflow,
  sessions,
  onClose,
}: WorkflowVisualizationModalProps) => {
  const { token } = useAuth();
  const [workflowVersion, setWorkflowVersion] = useState<WorkflowVersion | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadWorkflowVersion = async () => {
      if (!workflow.definition_id || !token) {
        setIsLoading(false);
        return;
      }

      try {
        const version = await workflowsApi.getVersion(token, workflow.id, workflow.definition_id);
        setWorkflowVersion(version as unknown as WorkflowVersion);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Erreur lors du chargement du workflow"
        );
      } finally {
        setIsLoading(false);
      }
    };

    void loadWorkflowVersion();
  }, [workflow.definition_id, token]);

  const buildNodesAndEdges = useCallback(() => {
    if (!workflowVersion) {
      return { nodes: [], edges: [], userPathEdges: [] };
    }

    // Grouper les sessions par étape actuelle
    const usersByStep = new Map<string, Array<{ email: string; is_admin: boolean }>>();
    const visitedSteps = new Set<string>();

    // Collecter toutes les étapes visitées par au moins un utilisateur
    sessions.forEach((session) => {
      const currentSlug = session.current_step.slug;

      // Utilisateurs sur cette étape actuellement
      if (!usersByStep.has(currentSlug)) {
        usersByStep.set(currentSlug, []);
      }
      usersByStep.get(currentSlug)!.push({
        email: session.user.email,
        is_admin: session.user.is_admin,
      });

      // Marquer cette étape et son historique comme visités
      visitedSteps.add(currentSlug);
      session.step_history.forEach((step) => {
        visitedSteps.add(step.slug);
      });
    });

    // Déterminer le statut de chaque node
    const getNodeStatus = (slug: string): NodeStatus => {
      if (usersByStep.has(slug)) {
        return "active"; // Utilisateurs actuellement ici
      }
      if (visitedSteps.has(slug)) {
        return "completed"; // Déjà visité
      }
      return "pending"; // Pas encore atteint
    };

    // Construire les nodes
    const nodes: Node[] = (workflowVersion.graph?.nodes || []).map((step) => {
      const position = step.metadata?.position || { x: 0, y: 0 };
      const usersOnThisStep = usersByStep.get(step.slug) || [];
      const nodeStatus = getNodeStatus(step.slug);

      return {
        id: step.slug,
        type: "custom",
        data: {
          label: step.display_name || step.slug,
          users: usersOnThisStep,
          kind: step.kind,
          nodeStatus,
        },
        position,
      };
    });

    // Construire les edges de base
    const stepIdToSlug = new Map(
      (workflowVersion.graph?.nodes || []).map((step) => [step.id, step.slug])
    );

    const edges: Edge[] = (workflowVersion.graph?.edges || []).map((transition, index) => {
      const sourceSlug = stepIdToSlug.get(transition.source_step_id);
      const targetSlug = stepIdToSlug.get(transition.target_step_id);

      // Déterminer si cet edge fait partie d'un chemin parcouru
      const isOnUserPath = sourceSlug && targetSlug &&
        visitedSteps.has(sourceSlug) && visitedSteps.has(targetSlug);

      return {
        id: `edge-${index}`,
        source: sourceSlug || "",
        target: targetSlug || "",
        label: transition.condition || undefined,
        type: "smoothstep",
        animated: false,
        style: isOnUserPath
          ? { stroke: "#3b82f6", strokeWidth: 2 }
          : { stroke: "#e5e7eb", strokeWidth: 1.5 },
      };
    });

    // Créer les edges des chemins utilisateurs (animés)
    const userPathEdges: Edge[] = [];
    sessions.forEach((session, sessionIndex) => {
      const allSteps = [...session.step_history.map(s => s.slug), session.current_step.slug];

      for (let i = 0; i < allSteps.length - 1; i++) {
        const source = allSteps[i];
        const target = allSteps[i + 1];

        userPathEdges.push({
          id: `user-path-${sessionIndex}-${i}`,
          source,
          target,
          type: "smoothstep",
          animated: true,
          style: {
            stroke: "#10b981",
            strokeWidth: 3,
            opacity: 0.6,
          },
          zIndex: 10,
        });
      }
    });

    return { nodes, edges: [...edges, ...userPathEdges] };
  }, [workflowVersion, sessions]);

  const { nodes, edges } = buildNodesAndEdges();

  return (
    <Modal
      title={`Workflow: ${workflow.display_name}`}
      onClose={onClose}
      size="xl"
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <div style={{ height: "70vh", width: "100%" }}>
        {isLoading ? (
          <LoadingSpinner text="Chargement du workflow..." />
        ) : error ? (
          <div className="error-message">
            <p>{error}</p>
          </div>
        ) : !workflowVersion ? (
          <div className="admin-card__subtitle">
            Aucune version de workflow disponible.
          </div>
        ) : (
          <>
            <div style={{ marginBottom: "12px", padding: "10px 12px", background: "var(--color-surface-subtle, #f3f4f6)", borderRadius: "8px", border: "1px solid var(--color-border, #e5e7eb)" }}>
              {/* Légende - responsive */}
              <div style={{ display: "flex", gap: "12px", fontSize: "11px", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
                  <div style={{
                    width: "16px",
                    height: "16px",
                    border: "3px solid #3b82f6",
                    borderRadius: "4px",
                    background: "#3b82f615",
                    boxShadow: "0 0 0 2px #3b82f630",
                    flexShrink: 0,
                  }} />
                  <span style={{ color: "var(--color-text, #1f2937)" }}>Actif</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
                  <div style={{
                    width: "16px",
                    height: "16px",
                    border: "2px solid #3b82f6",
                    borderRadius: "4px",
                    background: "#3b82f608",
                    flexShrink: 0,
                  }} />
                  <span style={{ color: "var(--color-text, #1f2937)" }}>Complété</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
                  <div style={{
                    width: "16px",
                    height: "16px",
                    border: "2px dashed #d1d5db",
                    borderRadius: "4px",
                    background: "#f9fafb",
                    opacity: 0.6,
                    flexShrink: 0,
                  }} />
                  <span style={{ color: "var(--color-text, #1f2937)" }}>En attente</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
                  <div style={{
                    width: "20px",
                    height: "2px",
                    background: "#10b981",
                    borderRadius: "1px",
                    flexShrink: 0,
                  }} />
                  <span style={{ color: "var(--color-text, #1f2937)" }}>Chemin parcouru</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
                  <div style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    background: "#3b82f6",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "10px",
                    fontWeight: "bold",
                    flexShrink: 0,
                  }}>
                    N
                  </div>
                  <span style={{ color: "var(--color-text, #1f2937)" }}>Cliquez pour voir les utilisateurs</span>
                </div>
              </div>
            </div>

            <div style={{ height: "calc(100% - 70px)", border: "1px solid var(--color-border, #e5e7eb)", borderRadius: "8px", overflow: "hidden" }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{
                  padding: 0.2,
                  minZoom: 0.5,
                  maxZoom: 1.5,
                }}
                minZoom={0.1}
                maxZoom={4}
                attributionPosition="bottom-left"
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={true}
                panOnScroll={true}
                zoomOnScroll={true}
                zoomOnPinch={true}
                panOnDrag={true}
                style={{
                  background: "var(--color-surface-subtle, #f9fafb)",
                }}
              >
                <Background gap={18} size={1} color="#e5e7eb" />
                <Controls
                  showZoom={true}
                  showFitView={true}
                  showInteractive={true}
                />
              </ReactFlow>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
        }
      `}</style>
    </Modal>
  );
};
