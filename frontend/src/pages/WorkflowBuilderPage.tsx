import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  addEdge,
  type Connection,
  type Edge,
  type EdgeOptions,
  type Node,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "reactflow";

import "reactflow/dist/style.css";

import { useAuth } from "../auth";
import { makeApiEndpointCandidates } from "../utils/backend";
import {
  getAgentMessage,
  getAgentModel,
  getAgentReasoningEffort,
  parseAgentParameters,
  setAgentMessage,
  setAgentModel,
  setAgentReasoningEffort,
  stringifyAgentParameters,
  type AgentParameters,
} from "../utils/workflows";

const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();

type NodeKind = "start" | "agent" | "condition" | "end";

type ApiWorkflowNode = {
  id: number;
  slug: string;
  kind: NodeKind;
  display_name: string | null;
  agent_key: string | null;
  is_enabled: boolean;
  parameters: AgentParameters;
  metadata: Record<string, unknown> | null;
};

type ApiWorkflowEdge = {
  id: number;
  source: string;
  target: string;
  condition: string | null;
  metadata: Record<string, unknown> | null;
};

type WorkflowResponse = {
  id: number;
  name: string;
  is_active: boolean;
  graph: {
    nodes: ApiWorkflowNode[];
    edges: ApiWorkflowEdge[];
  };
};

type FlowNodeData = {
  slug: string;
  kind: NodeKind;
  displayName: string;
  label: string;
  isEnabled: boolean;
  parameters: AgentParameters;
  parametersText: string;
  parametersError: string | null;
  metadata: Record<string, unknown>;
};

type FlowEdgeData = {
  condition?: string | null;
  metadata: Record<string, unknown>;
};

type FlowNode = Node<FlowNodeData>;
type FlowEdge = Edge<FlowEdgeData>;

type SaveState = "idle" | "saving" | "saved" | "error";

const NODE_COLORS: Record<NodeKind, string> = {
  start: "#2563eb",
  agent: "#16a34a",
  condition: "#f97316",
  end: "#7c3aed",
};

const NODE_BACKGROUNDS: Record<NodeKind, string> = {
  start: "rgba(37, 99, 235, 0.12)",
  agent: "rgba(22, 163, 74, 0.12)",
  condition: "rgba(249, 115, 22, 0.14)",
  end: "rgba(124, 58, 237, 0.12)",
};

const conditionOptions = [
  { value: "", label: "(par défaut)" },
  { value: "true", label: "Branche true" },
  { value: "false", label: "Branche false" },
];

const reasoningEffortOptions = [
  { value: "", label: "Comportement par défaut" },
  { value: "minimal", label: "Effort minimal" },
  { value: "medium", label: "Effort moyen" },
  { value: "high", label: "Effort élevé" },
];

const defaultEdgeOptions: EdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, color: "#1e293b" },
  style: { stroke: "#1e293b", strokeWidth: 2 },
  labelStyle: { fill: "#0f172a", fontWeight: 600 },
  labelShowBg: true,
  labelBgPadding: [8, 4],
  labelBgBorderRadius: 6,
  labelBgStyle: { fill: "#f1f5f9", stroke: "#cbd5f5" },
};

const connectionLineStyle = { stroke: "#1e293b", strokeWidth: 2 };

const WorkflowBuilderPage = () => {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdgeData>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const authHeader = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  useEffect(() => {
    let isMounted = true;
    const fetchWorkflow = async () => {
      setLoading(true);
      setLoadError(null);
      const candidates = makeApiEndpointCandidates(backendUrl, "/api/workflows/current");
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
          });
          if (!response.ok) {
            throw new Error(`Échec du chargement (${response.status})`);
          }
          const data: WorkflowResponse = await response.json();
          if (!isMounted) {
            return;
          }
          const flowNodes = data.graph.nodes.map<FlowNode>((node, index) => {
            const positionFromMetadata = extractPosition(node.metadata);
            const displayName = node.display_name ?? humanizeSlug(node.slug);
            const parameters = { ...(node.parameters ?? {}) } as AgentParameters;
            return {
              id: node.slug,
              position: positionFromMetadata ?? { x: 150 * index, y: 120 * index },
              data: {
                slug: node.slug,
                kind: node.kind,
                displayName,
                label: displayName,
                isEnabled: node.is_enabled,
                parameters,
                parametersText: stringifyAgentParameters(parameters),
                parametersError: null,
                metadata: node.metadata ?? {},
              },
              draggable: node.kind !== "start" && node.kind !== "end",
              style: buildNodeStyle(node.kind),
            } satisfies FlowNode;
          });
          const flowEdges = data.graph.edges.map<FlowEdge>((edge) => ({
            id: String(edge.id ?? `${edge.source}-${edge.target}-${Math.random()}`),
            source: edge.source,
            target: edge.target,
            label: edge.metadata?.label ? String(edge.metadata.label) : edge.condition ?? "",
            data: {
              condition: edge.condition,
              metadata: edge.metadata ?? {},
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#1e293b" },
          }));
          setNodes(flowNodes);
          setEdges(flowEdges);
          setLoading(false);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            continue;
          }
          if (isMounted) {
            setLoadError(
              error instanceof Error ? error.message : "Impossible de charger le workflow."
            );
          }
        }
      }
      if (isMounted) {
        setLoading(false);
        setLoadError((previous) => previous ?? "Impossible de charger le workflow.");
      }
    };
    void fetchWorkflow();
    return () => {
      isMounted = false;
    };
  }, [authHeader]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge<FlowEdgeData>(
          {
            ...connection,
            id: `edge-${Date.now()}`,
            label: "",
            data: { condition: "", metadata: {} },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#1e293b" },
          },
          current
        )
      );
    },
    [setEdges]
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  );

  const handleNodeClick = useCallback((_: unknown, node: FlowNode) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const handleEdgeClick = useCallback((_: unknown, edge: FlowEdge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const updateNodeData = useCallback(
    (nodeId: string, updater: (data: FlowNodeData) => FlowNodeData) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          const nextData = updater(node.data);
          return {
            ...node,
            data: nextData,
            style: buildNodeStyle(nextData.kind),
          } satisfies FlowNode;
        })
      );
    },
    [setNodes]
  );

  const handleDisplayNameChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        const display = value;
        return {
          ...data,
          displayName: display,
          label: display.trim() ? display : humanizeSlug(data.slug),
        };
      });
    },
    [updateNodeData]
  );

  const handleToggleNode = useCallback(
    (nodeId: string) => {
      updateNodeData(nodeId, (data) => ({
        ...data,
        isEnabled: !data.isEnabled,
      }));
    },
    [updateNodeData]
  );

  const handleParametersChange = useCallback(
    (nodeId: string, rawValue: string) => {
      updateNodeData(nodeId, (data) => {
        let error: string | null = null;
        let parsed = data.parameters;
        try {
          parsed = parseAgentParameters(rawValue);
        } catch (err) {
          error = err instanceof Error ? err.message : "Paramètres invalides";
        }
        return {
          ...data,
          parameters: error ? data.parameters : parsed,
          parametersText: rawValue,
          parametersError: error,
        };
      });
    },
    [updateNodeData]
  );

  const handleAgentMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentMessage(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentModelChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentModel(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleAgentReasoningChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentReasoningEffort(data.parameters, value);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData]
  );

  const handleConditionChange = useCallback(
    (edgeId: string, value: string) => {
      setEdges((current) =>
        current.map((edge) =>
          edge.id === edgeId
            ? {
                ...edge,
                label: value,
                data: { ...edge.data, condition: value || null },
              }
            : edge
        )
      );
    },
    [setEdges]
  );

  const handleEdgeLabelChange = useCallback(
    (edgeId: string, value: string) => {
      setEdges((current) =>
        current.map((edge) =>
          edge.id === edgeId
            ? {
                ...edge,
                label: value,
                data: {
                  ...edge.data,
                  metadata: { ...edge.data?.metadata, label: value },
                },
              }
            : edge
        )
      );
    },
    [setEdges]
  );

  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      const nodeToRemove = nodes.find((node) => node.id === nodeId);
      if (!nodeToRemove || nodeToRemove.data.kind === "start" || nodeToRemove.data.kind === "end") {
        return;
      }
      setNodes((currentNodes) => currentNodes.filter((node) => node.id !== nodeId));
      setEdges((currentEdges) =>
        currentEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
      );
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
    },
    [nodes, selectedNodeId, setEdges, setNodes]
  );

  const handleRemoveEdge = useCallback(
    (edgeId: string) => {
      setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== edgeId));
      if (selectedEdgeId === edgeId) {
        setSelectedEdgeId(null);
      }
    },
    [selectedEdgeId, setEdges]
  );

  const handleAddAgentNode = useCallback(() => {
    const slug = `agent-${Date.now()}`;
    const parameters: AgentParameters = {};
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 200 },
      data: {
        slug,
        kind: "agent",
        displayName: humanizeSlug(slug),
        isEnabled: true,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
        label: humanizeSlug(slug),
      },
      draggable: true,
      style: buildNodeStyle("agent"),
    };
    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(slug);
    setSelectedEdgeId(null);
  }, [setNodes]);

  const handleAddConditionNode = useCallback(() => {
    const slug = `condition-${Date.now()}`;
    const parameters: AgentParameters = { path: "has_all_details", mode: "truthy" };
    const newNode: FlowNode = {
      id: slug,
      position: { x: 400, y: 260 },
      data: {
        slug,
        kind: "condition",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("condition"),
    };
    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(slug);
    setSelectedEdgeId(null);
  }, [setNodes]);

  const handleSave = useCallback(async () => {
    setSaveMessage(null);
    const nodesWithErrors = nodes.filter((node) => node.data.parametersError);
    if (nodesWithErrors.length > 0) {
      setSaveState("error");
      setSaveMessage("Corrigez les paramètres JSON invalides avant d'enregistrer.");
      return;
    }

    try {
      const graphPayload = {
        nodes: nodes.map((node, index) => ({
          slug: node.data.slug,
          kind: node.data.kind,
          display_name: node.data.displayName.trim() || null,
          agent_key: null,
          is_enabled: node.data.isEnabled,
          parameters: node.data.parameters,
          metadata: {
            ...node.data.metadata,
            position: { x: node.position.x, y: node.position.y },
            order: index + 1,
          },
        })),
        edges: edges.map((edge, index) => ({
          source: edge.source,
          target: edge.target,
          condition: edge.data?.condition ? edge.data.condition : null,
          metadata: {
            ...edge.data?.metadata,
            label: edge.label ?? "",
            order: index + 1,
          },
        })),
      };

      const candidates = makeApiEndpointCandidates(backendUrl, "/api/workflows/current");
      setSaveState("saving");
      for (const url of candidates) {
        const response = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({ graph: graphPayload }),
        });
        if (!response.ok) {
          throw new Error(`Échec de l'enregistrement (${response.status})`);
        }
        setSaveState("saved");
        setSaveMessage("Workflow enregistré avec succès.");
        setTimeout(() => setSaveState("idle"), 1500);
        return;
      }
    } catch (error) {
      setSaveState("error");
      setSaveMessage(
        error instanceof Error ? error.message : "Impossible d'enregistrer le workflow."
      );
    }
  }, [authHeader, edges, nodes]);

  const disableSave = useMemo(
    () => nodes.some((node) => node.data.parametersError),
    [nodes]
  );

  return (
    <ReactFlowProvider>
      <main
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 340px",
          gap: "1.25rem",
          height: "calc(100vh - 4rem)",
          padding: "1.5rem",
        }}
      >
        <section
          style={{
            position: "relative",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            borderRadius: "1rem",
            overflow: "hidden",
            background: "#fff",
          }}
          aria-label="Éditeur visuel du workflow"
        >
          {loading ? (
            <div style={loadingStyle}>Chargement du workflow…</div>
          ) : loadError ? (
            <div style={loadingStyle} role="alert">
              {loadError}
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onConnect={onConnect}
              defaultEdgeOptions={defaultEdgeOptions}
              connectionLineStyle={connectionLineStyle}
              style={{ background: "#f8fafc" }}
              fitView
              fitViewOptions={{ padding: 0.2 }}
            >
              <Background gap={18} size={1} />
              <MiniMap
                nodeStrokeColor={(node) => NODE_COLORS[(node.data as FlowNodeData).kind]}
                nodeColor={(node) => NODE_COLORS[(node.data as FlowNodeData).kind]}
              />
              <Controls />
            </ReactFlow>
          )}
        </section>

        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            padding: "1rem",
            borderRadius: "1rem",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            background: "#fff",
            overflowY: "auto",
          }}
        >
          <header>
            <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Workflow visuel</h1>
            <p style={{ color: "#475569" }}>
              Ajoutez des agents, connectez-les entre eux et ajustez leurs paramètres pour piloter le
              workflow ChatKit.
            </p>
          </header>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn" onClick={handleAddAgentNode}>
              Ajouter un agent
            </button>
            <button type="button" className="btn" onClick={handleAddConditionNode}>
              Ajouter un bloc conditionnel
            </button>
          </div>

          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
              onToggle={handleToggleNode}
              onDisplayNameChange={handleDisplayNameChange}
              onAgentMessageChange={handleAgentMessageChange}
              onAgentModelChange={handleAgentModelChange}
              onAgentReasoningChange={handleAgentReasoningChange}
              onParametersChange={handleParametersChange}
              onRemove={handleRemoveNode}
            />
          ) : selectedEdge ? (
            <EdgeInspector
              edge={selectedEdge}
              onConditionChange={handleConditionChange}
              onLabelChange={handleEdgeLabelChange}
              onRemove={handleRemoveEdge}
            />
          ) : (
            <EmptyInspector />
          )
}

          <footer style={{ marginTop: "auto" }}>
            <button
              type="button"
              className="btn primary"
              onClick={handleSave}
              disabled={disableSave || saveState === "saving" || loading}
            >
              {saveState === "saving" ? "Enregistrement…" : "Enregistrer les modifications"}
            </button>
            {saveMessage && (
              <p
                style={{
                  marginTop: "0.5rem",
                  color: saveState === "error" ? "#b91c1c" : "#047857",
                }}
              >
                {saveMessage}
              </p>
            )}
          </footer>
        </aside>
      </main>
    </ReactFlowProvider>
  );
};

type NodeInspectorProps = {
  node: FlowNode;
  onToggle: (nodeId: string) => void;
  onDisplayNameChange: (nodeId: string, value: string) => void;
  onAgentMessageChange: (nodeId: string, value: string) => void;
  onAgentModelChange: (nodeId: string, value: string) => void;
  onAgentReasoningChange: (nodeId: string, value: string) => void;
  onParametersChange: (nodeId: string, value: string) => void;
  onRemove: (nodeId: string) => void;
};

const NodeInspector = ({
  node,
  onToggle,
  onDisplayNameChange,
  onAgentMessageChange,
  onAgentModelChange,
  onAgentReasoningChange,
  onParametersChange,
  onRemove,
}: NodeInspectorProps) => {
  const { kind, displayName, isEnabled, parameters, parametersText, parametersError } = node.data;
  const isFixed = kind === "start" || kind === "end";
  const agentMessage = getAgentMessage(parameters);
  const agentModel = getAgentModel(parameters);
  const reasoningEffort = getAgentReasoningEffort(parameters);
  return (
    <section aria-label={`Propriétés du nœud ${node.data.slug}`}>
      <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>Nœud sélectionné</h2>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 0.75rem" }}>
        <dt>Identifiant</dt>
        <dd>{node.data.slug}</dd>
        <dt>Type</dt>
        <dd>{labelForKind(kind)}</dd>
      </dl>

      <label style={fieldStyle}>
        <span>Nom affiché</span>
        <input
          type="text"
          value={displayName}
          onChange={(event) => onDisplayNameChange(node.id, event.target.value)}
        />
      </label>

      {kind === "agent" && (
        <>
          <label style={fieldStyle}>
            <span>Message système</span>
            <textarea
              value={agentMessage}
              rows={5}
              placeholder="Texte transmis à l'agent pour définir son rôle"
              onChange={(event) => onAgentMessageChange(node.id, event.target.value)}
            />
          </label>

          <label style={fieldStyle}>
            <span>Modèle OpenAI</span>
            <input
              type="text"
              value={agentModel}
              placeholder="Ex. gpt-4.1-mini"
              onChange={(event) => onAgentModelChange(node.id, event.target.value)}
            />
          </label>

          <label style={fieldStyle}>
            <span>Niveau de raisonnement</span>
            <select
              value={reasoningEffort}
              onChange={(event) => onAgentReasoningChange(node.id, event.target.value)}
            >
              {reasoningEffortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small style={{ color: "#475569" }}>
              Ajuste la profondeur d'analyse du modèle (laisser vide pour utiliser la valeur par
              défaut).
            </small>
          </label>
        </>
      )}

      <label style={fieldStyle}>
        <span>Paramètres JSON avancés</span>
        <textarea
          value={parametersText}
          rows={8}
          onChange={(event) => onParametersChange(node.id, event.target.value)}
          style={parametersError ? { borderColor: "#b91c1c" } : undefined}
        />
        {parametersError && (
          <span style={{ color: "#b91c1c", fontSize: "0.875rem" }}>{parametersError}</span>
        )}
        {kind === "agent" && !parametersError && (
          <span style={{ color: "#475569", fontSize: "0.85rem" }}>
            Utilisez ce champ pour ajouter des paramètres avancés (JSON) comme les réglages du modèle
            ou des options d'inférence supplémentaires.
          </span>
        )}
      </label>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={() => onToggle(node.id)}
            disabled={isFixed}
          />
          Activer ce nœud
        </label>
        {!isFixed && (
          <button type="button" className="btn danger" onClick={() => onRemove(node.id)}>
            Supprimer
          </button>
        )}
      </div>
    </section>
  );
};

type EdgeInspectorProps = {
  edge: FlowEdge;
  onConditionChange: (edgeId: string, value: string) => void;
  onLabelChange: (edgeId: string, value: string) => void;
  onRemove: (edgeId: string) => void;
};

const EdgeInspector = ({ edge, onConditionChange, onLabelChange, onRemove }: EdgeInspectorProps) => (
  <section aria-label="Propriétés de l'arête sélectionnée">
    <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>Connexion sélectionnée</h2>
    <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 0.75rem" }}>
      <dt>Depuis</dt>
      <dd>{edge.source}</dd>
      <dt>Vers</dt>
      <dd>{edge.target}</dd>
    </dl>
    <label style={fieldStyle}>
      <span>Branche conditionnelle</span>
      <select
        value={edge.data?.condition ?? ""}
        onChange={(event) => onConditionChange(edge.id, event.target.value)}
      >
        {conditionOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
    <label style={fieldStyle}>
      <span>Libellé affiché</span>
      <input
        type="text"
        value={edge.label ?? ""}
        onChange={(event) => onLabelChange(edge.id, event.target.value)}
      />
    </label>
    <button type="button" className="btn danger" onClick={() => onRemove(edge.id)}>
      Supprimer cette connexion
    </button>
  </section>
);

const EmptyInspector = () => (
  <section aria-label="Aucun élément sélectionné">
    <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>Sélectionnez un élément</h2>
    <p style={{ color: "#475569" }}>
      Cliquez sur un nœud ou une connexion dans le graphe pour en modifier les paramètres.
    </p>
  </section>
);

const loadingStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "1.1rem",
  height: "100%",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  marginTop: "0.75rem",
};

const labelForKind = (kind: NodeKind) => {
  switch (kind) {
    case "start":
      return "Début";
    case "agent":
      return "Agent";
    case "condition":
      return "Condition";
    case "end":
      return "Fin";
    default:
      return kind;
  }
};

const buildNodeStyle = (kind: NodeKind): CSSProperties => ({
  padding: "0.75rem 1rem",
  borderRadius: "0.75rem",
  border: `2px solid ${NODE_COLORS[kind]}`,
  color: "#0f172a",
  background: NODE_BACKGROUNDS[kind],
  fontWeight: 600,
  minWidth: 160,
  textAlign: "center",
  boxShadow: "0 1px 3px rgba(15, 23, 42, 0.18)",
});

const humanizeSlug = (slug: string) => slug.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const extractPosition = (metadata: Record<string, unknown> | null | undefined) => {
  const position = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).position : null;
  if (
    position &&
    typeof position === "object" &&
    "x" in position &&
    "y" in position &&
    typeof (position as Record<string, unknown>).x === "number" &&
    typeof (position as Record<string, unknown>).y === "number"
  ) {
    return { x: (position as { x: number }).x, y: (position as { y: number }).y };
  }
  return null;
};

export default WorkflowBuilderPage;
