import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from "react";
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
import { resolveAgentParameters, resolveStateParameters } from "../utils/agentPresets";
import {
  getAgentMessage,
  getAgentModel,
  getAgentReasoningEffort,
  getAgentResponseFormat,
  getAgentTemperature,
  getAgentTopP,
  getAgentWebSearchConfig,
  parseAgentParameters,
  setStateAssignments,
  setAgentMessage,
  setAgentModel,
  setAgentReasoningEffort,
  setAgentResponseFormatKind,
  setAgentResponseFormatName,
  setAgentResponseFormatSchema,
  setAgentTemperature,
  setAgentTopP,
  setAgentWebSearchConfig,
  getStateAssignments,
  stringifyAgentParameters,
  type AgentParameters,
  type WebSearchConfig,
  type StateAssignment,
  type StateAssignmentScope,
} from "../utils/workflows";

const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();

type NodeKind = "start" | "agent" | "condition" | "state" | "end";

type ApiWorkflowNode = {
  id: number;
  slug: string;
  kind: NodeKind;
  display_name: string | null;
  agent_key: string | null;
  is_enabled: boolean;
  parameters: AgentParameters | null;
  metadata: Record<string, unknown> | null;
};

type ApiWorkflowEdge = {
  id: number;
  source: string;
  target: string;
  condition: string | null;
  metadata: Record<string, unknown> | null;
};

type WorkflowVersionResponse = {
  id: number;
  workflow_id: number;
  workflow_slug: string | null;
  workflow_display_name: string | null;
  name: string | null;
  version: number;
  is_active: boolean;
  graph: {
    nodes: ApiWorkflowNode[];
    edges: ApiWorkflowEdge[];
  };
  steps: Array<{
    id: number;
    agent_key: string | null;
    position: number;
    is_enabled: boolean;
    parameters: AgentParameters;
    created_at: string;
    updated_at: string;
  }>;
  created_at: string;
  updated_at: string;
};

type WorkflowSummary = {
  id: number;
  slug: string;
  display_name: string;
  description: string | null;
  active_version_id: number | null;
  active_version_number: number | null;
  versions_count: number;
  created_at: string;
  updated_at: string;
};

type WorkflowVersionSummary = {
  id: number;
  workflow_id: number;
  name: string | null;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type FlowNodeData = {
  slug: string;
  kind: NodeKind;
  displayName: string;
  label: string;
  isEnabled: boolean;
  agentKey: string | null;
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
  state: "#0ea5e9",
  end: "#7c3aed",
};

const NODE_BACKGROUNDS: Record<NodeKind, string> = {
  start: "rgba(37, 99, 235, 0.12)",
  agent: "rgba(22, 163, 74, 0.12)",
  condition: "rgba(249, 115, 22, 0.14)",
  state: "rgba(14, 165, 233, 0.14)",
  end: "rgba(124, 58, 237, 0.12)",
};

const AGENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "triage", label: "Analyse des informations (triage)" },
  { value: "get_data_from_web", label: "Collecte d'exemples externes" },
  { value: "triage_2", label: "Validation après collecte" },
  { value: "get_data_from_user", label: "Collecte auprès de l'utilisateur" },
  { value: "r_dacteur", label: "Rédaction finale" },
];

const DEFAULT_AGENT_KEY = AGENT_OPTIONS[0]?.value ?? "triage";

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

const NON_REASONING_MODEL_PATTERN = /^gpt-4\.1/i;

const supportsReasoningModel = (model: string): boolean => {
  if (!model.trim()) {
    return true;
  }
  return !NON_REASONING_MODEL_PATTERN.test(model.trim());
};

const DEFAULT_JSON_SCHEMA_OBJECT = { type: "object", properties: {} } as const;
const DEFAULT_JSON_SCHEMA_TEXT = JSON.stringify(DEFAULT_JSON_SCHEMA_OBJECT, null, 2);
const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = { search_context_size: "medium" };
const WEB_SEARCH_LOCATION_LABELS = {
  city: "Ville",
  region: "Région",
  country: "Pays",
  type: "Type de précision",
} as const;

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
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [versions, setVersions] = useState<WorkflowVersionSummary[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [publishOnSave, setPublishOnSave] = useState(false);

  const authHeader = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);
  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflows],
  );

  const selectedVersionSummary = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? null,
    [selectedVersionId, versions],
  );

  const loadVersionDetail = useCallback(
    async (workflowId: number, versionId: number): Promise<boolean> => {
      setLoading(true);
      setLoadError(null);
      const candidates = makeApiEndpointCandidates(
        backendUrl,
        `/api/workflows/${workflowId}/versions/${versionId}`,
      );
      let lastError: Error | null = null;
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
          });
          if (!response.ok) {
            throw new Error(`Échec du chargement de la version (${response.status})`);
          }
          const data: WorkflowVersionResponse = await response.json();
          const flowNodes = data.graph.nodes.map<FlowNode>((node, index) => {
            const positionFromMetadata = extractPosition(node.metadata);
            const displayName = node.display_name ?? humanizeSlug(node.slug);
            const agentKey = node.kind === "agent" ? node.agent_key ?? null : null;
            const parameters =
              node.kind === "agent"
                ? resolveAgentParameters(agentKey, node.parameters)
                : node.kind === "state"
                  ? resolveStateParameters(node.slug, node.parameters)
                  : resolveAgentParameters(null, node.parameters);
            return {
              id: node.slug,
              position: positionFromMetadata ?? { x: 150 * index, y: 120 * index },
              data: {
                slug: node.slug,
                kind: node.kind,
                displayName,
                label: displayName,
                isEnabled: node.is_enabled,
                agentKey,
                parameters,
                parametersText: stringifyAgentParameters(parameters),
                parametersError: null,
                metadata: node.metadata ?? {},
              },
              draggable: true,
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
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          setSaveState("idle");
          setSaveMessage(null);
          setPublishOnSave(false);
          setLoading(false);
          return true;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            continue;
          }
          lastError = error instanceof Error ? error : new Error("Erreur inconnue");
        }
      }
      if (lastError) {
        setLoadError(lastError.message);
      }
      setLoading(false);
      return false;
    },
    [authHeader, setEdges, setNodes],
  );

  const loadVersions = useCallback(
    async (
      workflowId: number,
      preferredVersionId: number | null = null,
    ): Promise<boolean> => {
      setLoadError(null);
      const candidates = makeApiEndpointCandidates(
        backendUrl,
        `/api/workflows/${workflowId}/versions`,
      );
      let lastError: Error | null = null;
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
          });
          if (!response.ok) {
            throw new Error(`Échec du chargement des versions (${response.status})`);
          }
          const data: WorkflowVersionSummary[] = await response.json();
          setVersions(data);
          if (data.length === 0) {
            setSelectedVersionId(null);
            setNodes([]);
            setEdges([]);
            setLoading(false);
            return true;
          }
          const availableIds = new Set(data.map((version) => version.id));
          let nextVersionId: number | null = null;
          if (preferredVersionId && availableIds.has(preferredVersionId)) {
            nextVersionId = preferredVersionId;
          } else if (selectedVersionId && availableIds.has(selectedVersionId)) {
            nextVersionId = selectedVersionId;
          } else {
            const active = data.find((version) => version.is_active);
            nextVersionId = active?.id ?? data[0]?.id ?? null;
          }
          setSelectedVersionId(nextVersionId);
          if (nextVersionId != null) {
            await loadVersionDetail(workflowId, nextVersionId);
          } else {
            setLoading(false);
          }
          return true;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            continue;
          }
          lastError = error instanceof Error ? error : new Error("Erreur inconnue");
        }
      }
      if (lastError) {
        setLoadError(lastError.message);
      }
      setLoading(false);
      return false;
    },
    [authHeader, loadVersionDetail, selectedVersionId, setEdges, setNodes],
  );

  const loadWorkflows = useCallback(
    async (
      options: { selectWorkflowId?: number | null; selectVersionId?: number | null } = {},
    ): Promise<void> => {
      setLoading(true);
      setLoadError(null);
      const candidates = makeApiEndpointCandidates(backendUrl, "/api/workflows");
      let lastError: Error | null = null;
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
          });
          if (!response.ok) {
            throw new Error(`Échec du chargement de la bibliothèque (${response.status})`);
          }
          const data: WorkflowSummary[] = await response.json();
          setWorkflows(data);
          if (data.length === 0) {
            setSelectedWorkflowId(null);
            setSelectedVersionId(null);
            setVersions([]);
            setNodes([]);
            setEdges([]);
            setLoading(false);
            return;
          }
          let nextWorkflowId = options.selectWorkflowId ?? null;
          if (nextWorkflowId && data.some((workflow) => workflow.id === nextWorkflowId)) {
            // keep provided
          } else if (selectedWorkflowId && data.some((workflow) => workflow.id === selectedWorkflowId)) {
            nextWorkflowId = selectedWorkflowId;
          } else {
            nextWorkflowId = data[0]?.id ?? null;
          }
          setSelectedWorkflowId(nextWorkflowId);
          if (nextWorkflowId != null) {
            await loadVersions(nextWorkflowId, options.selectVersionId ?? null);
          } else {
            setLoading(false);
          }
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            continue;
          }
          lastError = error instanceof Error ? error : new Error("Erreur inconnue");
        }
      }
      if (lastError) {
        setLoadError(lastError.message);
      }
      setLoading(false);
    },
    [authHeader, loadVersions, selectedWorkflowId, setEdges, setNodes],
  );

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

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
        let nextParameters = setAgentModel(data.parameters, value);
        if (!supportsReasoningModel(value)) {
          nextParameters = setAgentReasoningEffort(nextParameters, "");
        }
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

  const handleAgentKeyChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const normalized = value.trim();
        const nextKey = normalized ? normalized : null;
        const nextParameters = nextKey
          ? resolveAgentParameters(nextKey, {})
          : data.parameters;
        return {
          ...data,
          agentKey: nextKey,
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

  const handleAgentTemperatureChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentTemperature(data.parameters, value);
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

  const handleAgentTopPChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentTopP(data.parameters, value);
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

  const handleAgentResponseFormatKindChange = useCallback(
    (nodeId: string, kind: "text" | "json_schema") => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentResponseFormatKind(data.parameters, kind);
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

  const handleAgentResponseFormatNameChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentResponseFormatName(data.parameters, value);
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

  const handleAgentResponseFormatSchemaChange = useCallback(
    (nodeId: string, schema: unknown) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentResponseFormatSchema(data.parameters, schema);
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

  const handleAgentWebSearchChange = useCallback(
    (nodeId: string, config: WebSearchConfig | null) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentWebSearchConfig(data.parameters, config);
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

  const handleStateAssignmentsChange = useCallback(
    (nodeId: string, scope: StateAssignmentScope, assignments: StateAssignment[]) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "state") {
          return data;
        }
        const nextParameters = setStateAssignments(data.parameters, scope, assignments);
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [updateNodeData],
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
    const parameters = resolveAgentParameters(DEFAULT_AGENT_KEY, {});
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 200 },
      data: {
        slug,
        kind: "agent",
        displayName: humanizeSlug(slug),
        isEnabled: true,
        agentKey: DEFAULT_AGENT_KEY,
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
        agentKey: null,
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

  const handleAddStateNode = useCallback(() => {
    const slug = `state-${Date.now()}`;
    const parameters: AgentParameters = {
      state: [
        { target: "state.has_all_details", expression: "input.output_parsed.has_all_details" },
        { target: "state.infos_manquantes", expression: "input.output_text" },
      ],
    };
    const newNode: FlowNode = {
      id: slug,
      position: { x: 360, y: 220 },
      data: {
        slug,
        kind: "state",
        displayName: humanizeSlug(slug),
        label: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
        parameters,
        parametersText: stringifyAgentParameters(parameters),
        parametersError: null,
        metadata: {},
      },
      draggable: true,
      style: buildNodeStyle("state"),
    };
    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(slug);
    setSelectedEdgeId(null);
  }, [setNodes]);

  const handleWorkflowChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = Number(event.target.value);
      const workflowId = Number.isFinite(value) ? value : null;
      setSelectedWorkflowId(workflowId);
      setSelectedVersionId(null);
      if (workflowId) {
        void loadVersions(workflowId, null);
      } else {
        setVersions([]);
        setNodes([]);
        setEdges([]);
      }
    },
    [loadVersions, setEdges, setNodes],
  );

  const handleVersionChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = Number(event.target.value);
      const versionId = Number.isFinite(value) ? value : null;
      setSelectedVersionId(versionId);
      if (selectedWorkflowId && versionId) {
        void loadVersionDetail(selectedWorkflowId, versionId);
      }
    },
    [loadVersionDetail, selectedWorkflowId],
  );

  const handlePublishToggle = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPublishOnSave(event.target.checked);
  }, []);

  const handleCreateWorkflow = useCallback(async () => {
    const proposed = window.prompt("Nom du nouveau workflow ?");
    if (!proposed) {
      return;
    }
    const displayName = proposed.trim();
    if (!displayName) {
      return;
    }
    const slug = slugifyWorkflowName(displayName);
    const payload = {
      slug,
      display_name: displayName,
      description: null,
      graph: null,
    };
    const candidates = makeApiEndpointCandidates(backendUrl, "/api/workflows");
    let lastError: Error | null = null;
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(`Échec de la création (${response.status})`);
        }
        const data: WorkflowVersionResponse = await response.json();
        await loadWorkflows({ selectWorkflowId: data.workflow_id, selectVersionId: data.id });
        setSaveState("saved");
        setSaveMessage(`Workflow "${displayName}" créé avec succès.`);
        setTimeout(() => setSaveState("idle"), 1500);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Impossible de créer le workflow.");
      }
    }
    setSaveState("error");
    setSaveMessage(lastError?.message ?? "Impossible de créer le workflow.");
  }, [authHeader, loadWorkflows]);

  const handlePromoteVersion = useCallback(async () => {
    if (!selectedWorkflowId || !selectedVersionId) {
      return;
    }
    const endpoint = `/api/workflows/${selectedWorkflowId}/production`;
    const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
    let lastError: Error | null = null;
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({ version_id: selectedVersionId }),
        });
        if (!response.ok) {
          throw new Error(`Échec de la mise en production (${response.status})`);
        }
        await loadWorkflows({
          selectWorkflowId: selectedWorkflowId,
          selectVersionId: selectedVersionId,
        });
        setSaveState("saved");
        setSaveMessage("Version définie comme production.");
        setTimeout(() => setSaveState("idle"), 1500);
        return;
      } catch (error) {
        lastError =
          error instanceof Error
            ? error
            : new Error("Impossible de définir la version en production.");
      }
    }
    setSaveState("error");
    setSaveMessage(
      lastError?.message ?? "Impossible de définir la version en production."
    );
  }, [authHeader, loadWorkflows, selectedVersionId, selectedWorkflowId]);

  const handleSave = useCallback(async () => {
    setSaveMessage(null);
    if (!selectedWorkflowId) {
      setSaveState("error");
      setSaveMessage("Sélectionnez un workflow avant d'enregistrer une version.");
      return;
    }

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
          agent_key: node.data.kind === "agent" ? node.data.agentKey : null,
          is_enabled: node.data.isEnabled,
          parameters: prepareNodeParametersForSave(node.data.kind, node.data.parameters),
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

      const endpoint = `/api/workflows/${selectedWorkflowId}/versions`;
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
      setSaveState("saving");
      for (const url of candidates) {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            graph: graphPayload,
            mark_as_active: publishOnSave,
          }),
        });
        if (!response.ok) {
          throw new Error(`Échec de l'enregistrement (${response.status})`);
        }
        const data: WorkflowVersionResponse = await response.json();
        await loadVersions(selectedWorkflowId, data.id);
        setSaveState("saved");
        setSaveMessage(
          publishOnSave
            ? "Nouvelle version enregistrée et définie en production."
            : "Nouvelle version enregistrée avec succès."
        );
        setTimeout(() => setSaveState("idle"), 1500);
        return;
      }
      throw new Error("Impossible de contacter le serveur pour enregistrer la version.");
    } catch (error) {
      setSaveState("error");
      setSaveMessage(
        error instanceof Error ? error.message : "Impossible d'enregistrer le workflow."
      );
    }
  }, [authHeader, edges, loadVersions, nodes, publishOnSave, selectedWorkflowId]);

  const disableSave = useMemo(
    () =>
      !selectedWorkflowId ||
      nodes.some(
        (node) =>
          node.data.parametersError ||
          (node.data.kind === "agent" && (!node.data.agentKey || node.data.agentKey.trim() === "")),
      ),
    [nodes, selectedWorkflowId],
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
            <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Bibliothèque de workflows</h1>
            <p style={{ color: "#475569" }}>
              Ajoutez des agents, connectez-les entre eux et ajustez leurs paramètres pour piloter le
              workflow ChatKit.
            </p>
          </header>

          <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label htmlFor="workflow-select" style={{ fontWeight: 600, color: "#0f172a" }}>
              Workflow
            </label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <select
                id="workflow-select"
                value={selectedWorkflowId ? String(selectedWorkflowId) : ""}
                onChange={handleWorkflowChange}
                disabled={loading}
                style={{ flexGrow: 1, minWidth: "12rem" }}
              >
                {workflows.length === 0 ? (
                  <option value="">Aucun workflow disponible</option>
                ) : (
                  workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.display_name}
                      {workflow.active_version_number
                        ? ` (prod : v${workflow.active_version_number})`
                        : ""}
                    </option>
                  ))
                )}
              </select>
              <button type="button" className="btn" onClick={handleCreateWorkflow} disabled={loading}>
                Nouveau workflow
              </button>
            </div>
            {selectedWorkflow?.description && (
              <p style={{ color: "#475569", margin: 0 }}>{selectedWorkflow.description}</p>
            )}
          </section>

          {workflows.length === 0 ? (
            <div style={{ color: "#475569" }}>
              <p style={{ margin: "0.5rem 0" }}>
                Aucun workflow n'est encore disponible. Créez-en un pour commencer.
              </p>
            </div>
          ) : (
            <>
              <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label htmlFor="version-select" style={{ fontWeight: 600, color: "#0f172a" }}>
                  Version
                </label>
                <select
                  id="version-select"
                  value={selectedVersionId ? String(selectedVersionId) : ""}
                  onChange={handleVersionChange}
                  disabled={loading || versions.length === 0}
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {`v${version.version}${version.name ? ` – ${version.name}` : ""}${
                        version.is_active ? " (production)" : ""
                      }`}
                    </option>
                  ))}
                </select>
                {selectedVersionSummary && (
                  <p style={{ color: "#475569", margin: 0 }}>
                    Dernière mise à jour : {formatDateTime(selectedVersionSummary.updated_at)}
                  </p>
                )}
                {selectedVersionSummary && !selectedVersionSummary.is_active && (
                  <button
                    type="button"
                    className="btn"
                    onClick={handlePromoteVersion}
                    disabled={loading}
                  >
                    Définir comme version de production
                  </button>
                )}
              </section>

              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={handleAddAgentNode}
                  disabled={loading}
                >
                  Ajouter un agent
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleAddConditionNode}
                  disabled={loading}
                >
                  Ajouter un bloc conditionnel
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleAddStateNode}
                  disabled={loading}
                >
                  Ajouter un bloc état
                </button>
              </div>

              {selectedNode ? (
                <NodeInspector
                  node={selectedNode}
                  onToggle={handleToggleNode}
                  onDisplayNameChange={handleDisplayNameChange}
                  onAgentKeyChange={handleAgentKeyChange}
                  onAgentMessageChange={handleAgentMessageChange}
                  onAgentModelChange={handleAgentModelChange}
                  onAgentReasoningChange={handleAgentReasoningChange}
                  onAgentTemperatureChange={handleAgentTemperatureChange}
                  onAgentTopPChange={handleAgentTopPChange}
                  onAgentResponseFormatKindChange={handleAgentResponseFormatKindChange}
                  onAgentResponseFormatNameChange={handleAgentResponseFormatNameChange}
                  onAgentResponseFormatSchemaChange={handleAgentResponseFormatSchemaChange}
                  onAgentWebSearchChange={handleAgentWebSearchChange}
                  onStateAssignmentsChange={handleStateAssignmentsChange}
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
              )}

              <footer style={{ marginTop: "auto" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={publishOnSave}
                    onChange={handlePublishToggle}
                    disabled={loading}
                  />
                  <span>Publier cette version immédiatement</span>
                </label>
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
            </>
          )}
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
  onAgentTemperatureChange: (nodeId: string, value: string) => void;
  onAgentTopPChange: (nodeId: string, value: string) => void;
  onAgentKeyChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatKindChange: (nodeId: string, kind: "text" | "json_schema") => void;
  onAgentResponseFormatNameChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatSchemaChange: (nodeId: string, schema: unknown) => void;
  onAgentWebSearchChange: (nodeId: string, config: WebSearchConfig | null) => void;
  onStateAssignmentsChange: (
    nodeId: string,
    scope: StateAssignmentScope,
    assignments: StateAssignment[],
  ) => void;
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
  onAgentTemperatureChange,
  onAgentTopPChange,
  onAgentKeyChange,
  onAgentResponseFormatKindChange,
  onAgentResponseFormatNameChange,
  onAgentResponseFormatSchemaChange,
  onAgentWebSearchChange,
  onStateAssignmentsChange,
  onParametersChange,
  onRemove,
}: NodeInspectorProps) => {
  const { kind, displayName, isEnabled, parameters, parametersText, parametersError, agentKey } =
    node.data;
  const isFixed = kind === "start" || kind === "end";
  const agentMessage = getAgentMessage(parameters);
  const agentModel = getAgentModel(parameters);
  const reasoningEffort = getAgentReasoningEffort(parameters);
  const responseFormat = getAgentResponseFormat(parameters);
  const temperature = getAgentTemperature(parameters);
  const topP = getAgentTopP(parameters);
  const webSearchConfig = getAgentWebSearchConfig(parameters);
  const webSearchEnabled = Boolean(webSearchConfig);
  const globalAssignments = useMemo(
    () => getStateAssignments(parameters, "globals"),
    [parameters],
  );
  const stateAssignments = useMemo(
    () => getStateAssignments(parameters, "state"),
    [parameters],
  );
  const [schemaText, setSchemaText] = useState(() =>
    responseFormat.kind === "json_schema"
      ? JSON.stringify(responseFormat.schema ?? {}, null, 2)
      : DEFAULT_JSON_SCHEMA_TEXT,
  );
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const schemaSignature =
    responseFormat.kind === "json_schema"
      ? JSON.stringify(responseFormat.schema ?? {})
      : "";
  useEffect(() => {
    if (responseFormat.kind === "json_schema") {
      setSchemaText(JSON.stringify(responseFormat.schema ?? {}, null, 2));
    } else {
      setSchemaText(DEFAULT_JSON_SCHEMA_TEXT);
    }
    setSchemaError(null);
  }, [node.id, responseFormat.kind, schemaSignature]);
  const supportsReasoning = supportsReasoningModel(agentModel);
  const temperatureValue = typeof temperature === "number" ? String(temperature) : "";
  const topPValue = typeof topP === "number" ? String(topP) : "";
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
            <span>Agent ChatKit</span>
            <select
              value={agentKey ?? ""}
              onChange={(event) => onAgentKeyChange(node.id, event.target.value)}
            >
              <option value="">Sélectionnez un agent…</option>
              {AGENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small style={{ color: "#475569" }}>
              Choisissez l'agent exécuté lorsque ce nœud est atteint.
            </small>
          </label>

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

          {supportsReasoning ? (
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
          ) : (
            <>
              <label style={fieldStyle}>
                <span>Température</span>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.01"
                  value={temperatureValue}
                  placeholder="Ex. 0.7"
                  onChange={(event) => onAgentTemperatureChange(node.id, event.target.value)}
                />
                <small style={{ color: "#475569" }}>
                  Ajuste la créativité des réponses pour les modèles sans raisonnement.
                </small>
              </label>
              <label style={fieldStyle}>
                <span>Top-p</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={topPValue}
                  placeholder="Ex. 0.9"
                  onChange={(event) => onAgentTopPChange(node.id, event.target.value)}
                />
                <small style={{ color: "#475569" }}>
                  Détermine la diversité lexicale en limitant la probabilité cumulée.
                </small>
              </label>
            </>
          )}

          <label style={fieldStyle}>
            <span>Type de sortie</span>
            <select
              value={responseFormat.kind}
              onChange={(event) =>
                onAgentResponseFormatKindChange(
                  node.id,
                  event.target.value as "text" | "json_schema",
                )
              }
            >
              <option value="text">Texte libre</option>
              <option value="json_schema">Schéma JSON</option>
            </select>
            <small style={{ color: "#475569" }}>
              Choisissez le format attendu pour la réponse de l'agent.
            </small>
          </label>

          {responseFormat.kind === "json_schema" && (
            <>
              <label style={fieldStyle}>
                <span>Nom du schéma JSON</span>
                <input
                  type="text"
                  value={responseFormat.name}
                  onChange={(event) => onAgentResponseFormatNameChange(node.id, event.target.value)}
                />
              </label>

              <label style={fieldStyle}>
                <span>Définition du schéma JSON</span>
                <textarea
                  value={schemaText}
                  rows={8}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSchemaText(value);
                    try {
                      const parsed = JSON.parse(value);
                      setSchemaError(null);
                      onAgentResponseFormatSchemaChange(node.id, parsed);
                    } catch (error) {
                      setSchemaError(
                        error instanceof Error ? error.message : "Schéma JSON invalide",
                      );
                    }
                  }}
                  style={schemaError ? { borderColor: "#b91c1c" } : undefined}
                />
                {schemaError ? (
                  <span style={{ color: "#b91c1c", fontSize: "0.85rem" }}>{schemaError}</span>
                ) : (
                  <small style={{ color: "#475569" }}>
                    Fournissez un schéma JSON valide (Draft 2020-12) pour contraindre la sortie.
                  </small>
                )}
              </label>
            </>
          )}

          <div
            style={{
              border: "1px solid rgba(15, 23, 42, 0.12)",
              borderRadius: "0.75rem",
              padding: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <strong style={{ fontSize: "0.95rem" }}>Outils</strong>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={webSearchEnabled}
                onChange={(event) =>
                  onAgentWebSearchChange(
                    node.id,
                    event.target.checked
                      ? webSearchConfig ?? { ...DEFAULT_WEB_SEARCH_CONFIG }
                      : null,
                  )
                }
              />
              Activer la recherche web
            </label>
            {webSearchEnabled && (
              <>
                <label style={fieldStyle}>
                  <span>Portée de la recherche</span>
                  <select
                    value={webSearchConfig?.search_context_size ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      const nextConfig: WebSearchConfig = { ...(webSearchConfig ?? {}) };
                      if (value) {
                        nextConfig.search_context_size = value;
                      } else {
                        delete nextConfig.search_context_size;
                      }
                      onAgentWebSearchChange(node.id, nextConfig);
                    }}
                  >
                    <option value="">(par défaut)</option>
                    <option value="small">Petit contexte</option>
                    <option value="medium">Contexte moyen</option>
                    <option value="large">Grand contexte</option>
                  </select>
                </label>

                <div style={{ display: "grid", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 600 }}>Localisation utilisateur</span>
                  {Object.entries(WEB_SEARCH_LOCATION_LABELS).map(([key, label]) => {
                    const typedKey = key as keyof typeof WEB_SEARCH_LOCATION_LABELS;
                    const currentValue =
                      (webSearchConfig?.user_location?.[typedKey] as string | undefined) ?? "";
                    return (
                      <label key={key} style={fieldStyle}>
                        <span>{label}</span>
                        <input
                          type="text"
                          value={currentValue}
                          onChange={(event) => {
                            const value = event.target.value;
                            const nextLocation = {
                              ...(webSearchConfig?.user_location ?? {}),
                            } as Record<string, string>;
                            if (value.trim()) {
                              nextLocation[typedKey] = value;
                            } else {
                              delete nextLocation[typedKey];
                            }
                            const nextConfig: WebSearchConfig = { ...(webSearchConfig ?? {}) };
                            if (Object.keys(nextLocation).length > 0) {
                              nextConfig.user_location = nextLocation;
                            } else {
                              delete nextConfig.user_location;
                            }
                            onAgentWebSearchChange(node.id, nextConfig);
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {kind === "state" && (
        <>
          <StateAssignmentsPanel
            title="Variables globales"
            description="Définissez des variables disponibles pour l'ensemble du workflow."
            assignments={globalAssignments}
            onChange={(next) => onStateAssignmentsChange(node.id, "globals", next)}
            expressionPlaceholder="Ex. input.output_parsed"
            targetPlaceholder="global.nom_variable"
            addLabel="Ajouter une variable globale"
            emptyLabel="Aucune variable globale n'est définie pour ce nœud."
          />
          <StateAssignmentsPanel
            title="Variables d'état"
            description="Affectez des valeurs aux variables d'état du workflow."
            assignments={stateAssignments}
            onChange={(next) => onStateAssignmentsChange(node.id, "state", next)}
            expressionPlaceholder="Ex. input.output_text"
            targetPlaceholder="state.nom_variable"
            addLabel="Ajouter une variable d'état"
            emptyLabel="Aucune variable d'état n'est configurée pour ce nœud."
          />
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


type StateAssignmentsPanelProps = {
  title: string;
  description: string;
  assignments: StateAssignment[];
  onChange: (assignments: StateAssignment[]) => void;
  expressionPlaceholder?: string;
  targetPlaceholder?: string;
  addLabel: string;
  emptyLabel: string;
};

const StateAssignmentsPanel = ({
  title,
  description,
  assignments,
  onChange,
  expressionPlaceholder,
  targetPlaceholder,
  addLabel,
  emptyLabel,
}: StateAssignmentsPanelProps) => {
  const handleAssignmentChange = (
    index: number,
    field: keyof StateAssignment,
    value: string,
  ) => {
    const next = assignments.map((assignment, currentIndex) =>
      currentIndex === index ? { ...assignment, [field]: value } : assignment,
    );
    onChange(next);
  };

  const handleRemoveAssignment = (index: number) => {
    onChange(assignments.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleAddAssignment = () => {
    onChange([...assignments, { expression: "", target: "" }]);
  };

  return (
    <section
      aria-label={title}
      style={{
        marginTop: "1rem",
        border: "1px solid rgba(15, 23, 42, 0.12)",
        borderRadius: "0.75rem",
        padding: "0.75rem",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <header>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>{title}</h3>
        <p style={{ margin: "0.25rem 0 0", color: "#475569", fontSize: "0.95rem" }}>{description}</p>
      </header>

      {assignments.length === 0 ? (
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>{emptyLabel}</p>
      ) : (
        assignments.map((assignment, index) => (
          <div
            key={`${title}-${index}`}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.35)",
              borderRadius: "0.65rem",
              padding: "0.75rem",
              display: "grid",
              gap: "0.75rem",
            }}
          >
            <label style={fieldStyle}>
              <span>Affecter la valeur</span>
              <input
                type="text"
                value={assignment.expression}
                placeholder={expressionPlaceholder}
                onChange={(event) =>
                  handleAssignmentChange(index, "expression", event.target.value)
                }
              />
              <small style={{ color: "#64748b" }}>
                Utilisez le langage Common Expression Language pour créer une expression
                personnalisée.{" "}
                <a href="https://opensource.google/projects/cel" target="_blank" rel="noreferrer">
                  En savoir plus
                </a>
                .
              </small>
            </label>

            <label style={fieldStyle}>
              <span>Vers la variable</span>
              <input
                type="text"
                value={assignment.target}
                placeholder={targetPlaceholder}
                onChange={(event) => handleAssignmentChange(index, "target", event.target.value)}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn danger"
                onClick={() => handleRemoveAssignment(index)}
              >
                Supprimer cette affectation
              </button>
            </div>
          </div>
        ))
      )}

      <div>
        <button type="button" className="btn" onClick={handleAddAssignment}>
          {addLabel}
        </button>
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

const STATE_ASSIGNMENT_SCOPES: StateAssignmentScope[] = ["globals", "state"];

const prepareNodeParametersForSave = (kind: NodeKind, parameters: AgentParameters): AgentParameters => {
  if (kind !== "state") {
    return parameters;
  }

  const preservedEntries = Object.entries(parameters ?? {}).filter(
    ([key]) => key !== "state" && key !== "globals",
  );

  const sanitized: Record<string, unknown> = Object.fromEntries(preservedEntries);

  for (const scope of STATE_ASSIGNMENT_SCOPES) {
    const assignments = getStateAssignments(parameters, scope)
      .map((assignment) => ({
        target: assignment.target.trim(),
        expression: assignment.expression.trim(),
      }))
      .filter((assignment) => assignment.target || assignment.expression);
    if (assignments.length > 0) {
      sanitized[scope] = assignments;
    }
  }

  return Object.keys(sanitized).length === 0 ? {} : (sanitized as AgentParameters);
};

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
    case "state":
      return "État";
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

const slugifyWorkflowName = (label: string): string => {
  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug) {
    return slug;
  }
  return `workflow-${Date.now()}`;
};

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

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

export default WorkflowBuilderPage;
