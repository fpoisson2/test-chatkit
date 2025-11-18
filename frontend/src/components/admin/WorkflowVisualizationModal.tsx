import { useCallback, useEffect, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
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
  ui_metadata?: {
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
  transitions: WorkflowTransition[];
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
        // Utilisateurs actuellement ici - border épais + background léger
        return {
          border: `3px solid ${baseColor}`,
          background: `${baseColor}15`, // 15 = ~8% opacity
          boxShadow: `0 0 0 3px ${baseColor}30`,
        };
      case "completed":
        // Déjà complété - border normale + background très léger
        return {
          border: `2px solid ${baseColor}`,
          background: `${baseColor}08`, // 08 = ~3% opacity
          boxShadow: "none",
        };
      case "pending":
        // Pas encore atteint - gris + dashed
        return {
          border: "2px dashed #d1d5db",
          background: "#f9fafb",
          boxShadow: "none",
          opacity: 0.6,
        };
      default:
        return {
          border: `2px solid ${baseColor}`,
          background: "white",
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
        ...nodeStyle,
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: "14px",
          marginBottom: "4px",
          color: data.nodeStatus === "pending" ? "#9ca3af" : "#1f2937",
        }}
      >
        {data.label}
      </div>
      <div style={{ fontSize: "11px", color: "#6b7280" }}>
        {data.kind}
      </div>

      {/* Badge utilisateurs actuels */}
      {data.users && data.users.length > 0 && (
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
            border: "3px solid white",
            boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            animation: "pulse 2s ease-in-out infinite",
          }}
          title={data.users.map((u) => u.email).join(", ")}
        >
          {data.users.length}
        </div>
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
            border: "2px solid white",
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
        const version = await workflowsApi.getVersion(token, workflow.definition_id);
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
    const nodes: Node[] = workflowVersion.steps.map((step) => {
      const position = step.ui_metadata?.position || step.position || { x: 0, y: 0 };
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
      workflowVersion.steps.map((step) => [step.id, step.slug])
    );

    const edges: Edge[] = workflowVersion.transitions.map((transition, index) => {
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
            <div style={{ marginBottom: "16px", padding: "12px", background: "#f3f4f6", borderRadius: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "8px" }}>
                <div>
                  <h3 style={{ margin: "0 0 4px 0", fontSize: "16px", fontWeight: 600 }}>
                    Utilisateurs actifs ({sessions.length})
                  </h3>
                </div>

                {/* Légende */}
                <div style={{ display: "flex", gap: "12px", fontSize: "11px", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <div style={{
                      width: "16px",
                      height: "16px",
                      border: "3px solid #3b82f6",
                      borderRadius: "4px",
                      background: "#3b82f615",
                      boxShadow: "0 0 0 2px #3b82f630",
                    }} />
                    <span>Actif</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <div style={{
                      width: "16px",
                      height: "16px",
                      border: "2px solid #3b82f6",
                      borderRadius: "4px",
                      background: "#3b82f608",
                    }} />
                    <span>Complété</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <div style={{
                      width: "16px",
                      height: "16px",
                      border: "2px dashed #d1d5db",
                      borderRadius: "4px",
                      background: "#f9fafb",
                      opacity: 0.6,
                    }} />
                    <span>En attente</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <div style={{
                      width: "20px",
                      height: "2px",
                      background: "#10b981",
                      borderRadius: "1px",
                    }} />
                    <span>Chemin parcouru</span>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {sessions.map((session) => (
                  <div
                    key={session.thread_id}
                    style={{
                      padding: "6px 12px",
                      background: "white",
                      borderRadius: "6px",
                      fontSize: "12px",
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{session.user.email}</div>
                    <div style={{ color: "#6b7280" }}>
                      → {session.current_step.display_name}
                    </div>
                    <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "2px" }}>
                      {session.step_history.length} étapes complétées
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ height: "calc(100% - 140px)", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                attributionPosition="bottom-left"
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
              >
                <Background />
                <Controls showInteractive={false} />
                <MiniMap />
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
