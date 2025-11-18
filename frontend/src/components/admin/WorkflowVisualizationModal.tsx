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

// Node personnalisé pour afficher les utilisateurs sur un step
const CustomNode = ({
  data,
}: NodeProps<{
  label: string;
  users: Array<{ email: string; is_admin: boolean }>;
  kind: string;
}>) => {
  const getNodeColor = (kind: string) => {
    const colors: Record<string, string> = {
      start: "#10b981",
      end: "#ef4444",
      agent: "#3b82f6",
      condition: "#f59e0b",
      wait: "#8b5cf6",
    };
    return colors[kind] || "#6b7280";
  };

  return (
    <div
      style={{
        padding: "10px 20px",
        borderRadius: "8px",
        background: "white",
        border: `2px solid ${getNodeColor(data.kind)}`,
        minWidth: "150px",
        position: "relative",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>
        {data.label}
      </div>
      <div style={{ fontSize: "11px", color: "#6b7280" }}>
        {data.kind}
      </div>

      {data.users && data.users.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "-10px",
            right: "-10px",
            background: "#3b82f6",
            color: "white",
            borderRadius: "50%",
            width: "24px",
            height: "24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            fontWeight: "bold",
            border: "2px solid white",
            boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
          }}
          title={data.users.map((u) => u.email).join(", ")}
        >
          {data.users.length}
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
      return { nodes: [], edges: [] };
    }

    // Grouper les sessions par étape actuelle
    const usersByStep = new Map<string, Array<{ email: string; is_admin: boolean }>>();
    sessions.forEach((session) => {
      const stepSlug = session.current_step.slug;
      if (!usersByStep.has(stepSlug)) {
        usersByStep.set(stepSlug, []);
      }
      usersByStep.get(stepSlug)!.push({
        email: session.user.email,
        is_admin: session.user.is_admin,
      });
    });

    // Construire les nodes
    const nodes: Node[] = workflowVersion.steps.map((step) => {
      const position = step.ui_metadata?.position || step.position || { x: 0, y: 0 };
      const usersOnThisStep = usersByStep.get(step.slug) || [];

      return {
        id: step.slug,
        type: "custom",
        data: {
          label: step.display_name || step.slug,
          users: usersOnThisStep,
          kind: step.kind,
        },
        position,
      };
    });

    // Construire les edges
    const stepIdToSlug = new Map(
      workflowVersion.steps.map((step) => [step.id, step.slug])
    );

    const edges: Edge[] = workflowVersion.transitions.map((transition, index) => {
      const sourceSlug = stepIdToSlug.get(transition.source_step_id);
      const targetSlug = stepIdToSlug.get(transition.target_step_id);

      return {
        id: `edge-${index}`,
        source: sourceSlug || "",
        target: targetSlug || "",
        label: transition.condition || undefined,
        type: "smoothstep",
        animated: false,
      };
    });

    return { nodes, edges };
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
              <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: 600 }}>
                Utilisateurs actifs ({sessions.length})
              </h3>
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
                  </div>
                ))}
              </div>
            </div>

            <div style={{ height: "calc(100% - 100px)", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
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
    </Modal>
  );
};
