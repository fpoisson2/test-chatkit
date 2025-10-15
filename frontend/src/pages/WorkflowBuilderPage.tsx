import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { useNavigate } from "react-router-dom";
import { SidebarIcon, type SidebarIconName } from "../components/SidebarIcon";
import {
  makeApiEndpointCandidates,
  modelRegistryApi,
  widgetLibraryApi,
  vectorStoreApi,
  type AvailableModel,
  type WidgetTemplate,
  type VectorStoreSummary,
} from "../utils/backend";
import { resolveAgentParameters, resolveStateParameters } from "../utils/agentPresets";
import {
  getAgentMessage,
  getAgentModel,
  getAgentReasoningEffort,
  getAgentReasoningVerbosity,
  getAgentReasoningSummary,
  getAgentFileSearchConfig,
  getAgentResponseFormat,
  getAgentTemperature,
  getAgentTopP,
  getAgentMaxOutputTokens,
  getAgentWebSearchConfig,
  getAgentIncludeChatHistory,
  getAgentDisplayResponseInChat,
  getAgentShowSearchSources,
  getAgentContinueOnError,
  getAgentStorePreference,
  isPlainRecord,
  parseAgentParameters,
  setStateAssignments,
  setAgentMessage,
  setAgentModel,
  setAgentReasoningEffort,
  setAgentReasoningVerbosity,
  setAgentReasoningSummary,
  setAgentFileSearchConfig,
  getAgentWeatherToolEnabled,
  setAgentWeatherToolEnabled,
  setAgentResponseFormatKind,
  setAgentResponseFormatName,
  setAgentResponseFormatSchema,
  setAgentResponseWidgetSlug,
  setAgentTemperature,
  setAgentTopP,
  setAgentMaxOutputTokens,
  setAgentWebSearchConfig,
  setAgentIncludeChatHistory,
  setAgentDisplayResponseInChat,
  setAgentShowSearchSources,
  setAgentContinueOnError,
  setAgentStorePreference,
  getStateAssignments,
  stringifyAgentParameters,
  type AgentParameters,
  type FileSearchConfig,
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
  workflow_is_chatkit_default: boolean;
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
  is_chatkit_default: boolean;
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

const AUTO_SAVE_DELAY_MS = 800;

const buildGraphPayloadFrom = (flowNodes: FlowNode[], flowEdges: FlowEdge[]) => ({
  nodes: flowNodes.map((node, index) => ({
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
  edges: flowEdges.map((edge, index) => ({
    source: edge.source,
    target: edge.target,
    condition: edge.data?.condition ? edge.data.condition : null,
    metadata: {
      ...edge.data?.metadata,
      label: edge.label ?? "",
      order: index + 1,
    },
  })),
});

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

const reasoningVerbosityOptions = [
  { value: "", label: "Verbosité par défaut" },
  { value: "low", label: "Verbosité faible" },
  { value: "medium", label: "Verbosité moyenne" },
  { value: "high", label: "Verbosité élevée" },
];

const reasoningSummaryOptions = [
  { value: "none", label: "Pas de résumé" },
  { value: "auto", label: "Résumé automatique" },
  { value: "detailed", label: "Résumé détaillé" },
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
  const { token, logout, user } = useAuth();
  const navigate = useNavigate();
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
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [vectorStores, setVectorStores] = useState<VectorStoreSummary[]>([]);
  const [vectorStoresLoading, setVectorStoresLoading] = useState(false);
  const [vectorStoresError, setVectorStoresError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [availableModelsLoading, setAvailableModelsLoading] = useState(false);
  const [availableModelsError, setAvailableModelsError] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<WidgetTemplate[]>([]);
  const [widgetsLoading, setWidgetsLoading] = useState(false);
  const [widgetsError, setWidgetsError] = useState<string | null>(null);
  const [isNavigationOpen, setNavigationOpen] = useState(false);
  const [isActionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const isHydratingRef = useRef(false);

  const authHeader = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);
  const isAuthenticated = Boolean(user);
  const isAdmin = Boolean(user?.is_admin);
  const closeNavigation = useCallback(() => setNavigationOpen(false), []);
  const toggleNavigation = useCallback(() => setNavigationOpen((prev) => !prev), []);

  useEffect(() => {
    if (!isActionMenuOpen) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (!actionMenuRef.current) {
        return;
      }
      if (!actionMenuRef.current.contains(event.target as Node)) {
        setActionMenuOpen(false);
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isActionMenuOpen]);

  const navigationItems = useMemo(
    () => {
      const items: Array<{
        key: string;
        label: string;
        icon: SidebarIconName;
        action: () => void;
      }> = [
        {
          key: "home",
          label: "Accueil",
          icon: "home",
          action: () => {
            navigate("/");
            closeNavigation();
          },
        },
      ];

      if (isAdmin) {
        items.push(
          {
            key: "admin",
            label: "Administration",
            icon: "admin",
            action: () => {
              navigate("/admin");
              closeNavigation();
            },
          },
          {
            key: "workflows",
            label: "Workflows",
            icon: "workflow",
            action: () => {
              navigate("/admin/workflows");
              closeNavigation();
            },
          },
        );
      }

      if (isAuthenticated) {
        items.push(
          {
            key: "voice",
            label: "Mode voix",
            icon: "voice",
            action: () => {
              navigate("/voice");
              closeNavigation();
            },
          },
          {
            key: "logout",
            label: "Déconnexion",
            icon: "logout",
            action: () => {
              closeNavigation();
              logout();
            },
          },
        );
      } else {
        items.push({
          key: "login",
          label: "Connexion",
          icon: "login",
          action: () => {
            navigate("/login");
            closeNavigation();
          },
        });
      }

      return items;
    },
    [
      closeNavigation,
      isAdmin,
      isAuthenticated,
      logout,
      navigate,
    ],
  );

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflows],
  );

  const selectedVersionSummary = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? null,
    [selectedVersionId, versions],
  );

  const isReasoningModel = useCallback(
    (model: string): boolean => {
      const trimmed = model.trim();
      if (!trimmed) {
        return true;
      }
      const match = availableModels.find((item) => item.name === trimmed);
      if (match) {
        return match.supports_reasoning;
      }
      return supportsReasoningModel(trimmed);
    },
    [availableModels],
  );

  useEffect(() => {
    let isMounted = true;
    if (!token) {
      setVectorStores([]);
      setVectorStoresLoading(false);
      setVectorStoresError(null);
      return () => {
        isMounted = false;
      };
    }

    setVectorStoresLoading(true);
    setVectorStoresError(null);
    vectorStoreApi
      .listStores(token)
      .then((stores) => {
        if (isMounted) {
          setVectorStores(stores);
        }
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Impossible de charger les vector stores.";
        setVectorStoresError(message);
        setVectorStores([]);
      })
      .finally(() => {
        if (isMounted) {
          setVectorStoresLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    let isMounted = true;
    if (!token) {
      setAvailableModels([]);
      setAvailableModelsLoading(false);
      setAvailableModelsError(null);
      return () => {
        isMounted = false;
      };
    }

    setAvailableModelsLoading(true);
    setAvailableModelsError(null);
    modelRegistryApi
      .list(token)
      .then((models) => {
        if (!isMounted) {
          return;
        }
        setAvailableModels(models);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Impossible de charger les modèles autorisés.";
        setAvailableModelsError(message);
        setAvailableModels([]);
      })
      .finally(() => {
        if (isMounted) {
          setAvailableModelsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    let isMounted = true;
    if (!token) {
      setWidgets([]);
      setWidgetsLoading(false);
      setWidgetsError(null);
      return () => {
        isMounted = false;
      };
    }

    setWidgetsLoading(true);
    setWidgetsError(null);
    widgetLibraryApi
      .listWidgets(token)
      .then((items) => {
        if (!isMounted) {
          return;
        }
        setWidgets(items);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Impossible de charger la bibliothèque de widgets.";
        setWidgetsError(message);
        setWidgets([]);
      })
      .finally(() => {
        if (isMounted) {
          setWidgetsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

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
          const nextSnapshot = JSON.stringify(buildGraphPayloadFrom(flowNodes, flowEdges));
          isHydratingRef.current = true;
          lastSavedSnapshotRef.current = nextSnapshot;
          setHasPendingChanges(false);
          setNodes(flowNodes);
          setEdges(flowEdges);
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          setSaveState("idle");
          setSaveMessage(null);
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
    [authHeader, setEdges, setHasPendingChanges, setNodes],
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
            isHydratingRef.current = true;
            lastSavedSnapshotRef.current = JSON.stringify(buildGraphPayloadFrom([], []));
            setHasPendingChanges(false);
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
    [authHeader, loadVersionDetail, selectedVersionId, setEdges, setHasPendingChanges, setNodes],
  );

  const loadWorkflows = useCallback(
    async (
      options: {
        selectWorkflowId?: number | null;
        selectVersionId?: number | null;
        excludeWorkflowId?: number | null;
      } = {},
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
            isHydratingRef.current = true;
            lastSavedSnapshotRef.current = JSON.stringify(buildGraphPayloadFrom([], []));
            setHasPendingChanges(false);
            setLoading(false);
            return;
          }
          const availableIds = new Set(data.map((workflow) => workflow.id));
          const excluded = options.excludeWorkflowId ?? null;
          const chatkitWorkflow = data.find(
            (workflow) =>
              workflow.is_chatkit_default &&
              workflow.id !== excluded &&
              availableIds.has(workflow.id),
          );
          let nextWorkflowId = options.selectWorkflowId ?? null;
          if (
            nextWorkflowId &&
            (!availableIds.has(nextWorkflowId) || (excluded != null && nextWorkflowId === excluded))
          ) {
            nextWorkflowId = null;
          }
          if (
            nextWorkflowId == null &&
            selectedWorkflowId &&
            availableIds.has(selectedWorkflowId) &&
            (excluded == null || selectedWorkflowId !== excluded)
          ) {
            nextWorkflowId = selectedWorkflowId;
          }
          if (nextWorkflowId == null) {
            const fallback = chatkitWorkflow ?? data.find((workflow) => workflow.id !== excluded);
            nextWorkflowId = fallback?.id ?? data[0]?.id ?? null;
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
    [authHeader, loadVersions, selectedWorkflowId, setEdges, setHasPendingChanges, setNodes],
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

  const handleClearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
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
        if (!isReasoningModel(value)) {
          nextParameters = setAgentReasoningEffort(nextParameters, "");
          nextParameters = setAgentReasoningVerbosity(nextParameters, "");
          nextParameters = setAgentReasoningSummary(nextParameters, "");
        }
        return {
          ...data,
          parameters: nextParameters,
          parametersText: stringifyAgentParameters(nextParameters),
          parametersError: null,
        } satisfies FlowNodeData;
      });
    },
    [isReasoningModel, updateNodeData],
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
    [updateNodeData],
  );

  const handleAgentReasoningVerbosityChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentReasoningVerbosity(data.parameters, value);
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

  const handleAgentReasoningSummaryChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentReasoningSummary(data.parameters, value);
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
    [updateNodeData],
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
    [updateNodeData],
  );

  const handleAgentMaxOutputTokensChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentMaxOutputTokens(data.parameters, value);
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

  const handleAgentIncludeChatHistoryChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentIncludeChatHistory(data.parameters, value);
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

  const handleAgentDisplayResponseInChatChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentDisplayResponseInChat(data.parameters, value);
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

  const handleAgentShowSearchSourcesChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentShowSearchSources(data.parameters, value);
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

  const handleAgentContinueOnErrorChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentContinueOnError(data.parameters, value);
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

  const handleAgentStorePreferenceChange = useCallback(
    (nodeId: string, value: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentStorePreference(data.parameters, value);
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

  const handleAgentResponseFormatKindChange = useCallback(
    (nodeId: string, kind: "text" | "json_schema" | "widget") => {
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

  const handleAgentResponseWidgetSlugChange = useCallback(
    (nodeId: string, slug: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentResponseWidgetSlug(data.parameters, slug);
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

  const handleAgentFileSearchChange = useCallback(
    (nodeId: string, config: FileSearchConfig | null) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentFileSearchConfig(data.parameters, config);
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

  const handleAgentWeatherToolChange = useCallback(
    (nodeId: string, enabled: boolean) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "agent") {
          return data;
        }
        const nextParameters = setAgentWeatherToolEnabled(data.parameters, enabled);
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
    const parameters = resolveAgentParameters(null, {});
    const newNode: FlowNode = {
      id: slug,
      position: { x: 300, y: 200 },
      data: {
        slug,
        kind: "agent",
        displayName: humanizeSlug(slug),
        isEnabled: true,
        agentKey: null,
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
        lastSavedSnapshotRef.current = null;
        setHasPendingChanges(false);
      }
    },
    [loadVersions, setEdges, setHasPendingChanges, setNodes],
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

  const handleDeleteWorkflow = useCallback(async () => {
    if (!selectedWorkflowId) {
      return;
    }
    const current = workflows.find((workflow) => workflow.id === selectedWorkflowId);
    if (!current) {
      return;
    }
    if (current.is_chatkit_default) {
      setSaveState("error");
      setSaveMessage(
        "Sélectionnez un autre workflow pour ChatKit avant de supprimer celui-ci.",
      );
      return;
    }
    const confirmed = window.confirm(
      `Supprimer le workflow "${current.display_name}" ? Cette action est irréversible.`,
    );
    if (!confirmed) {
      return;
    }
    setActionMenuOpen(false);
    const endpoint = `/api/workflows/${selectedWorkflowId}`;
    const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
    let lastError: Error | null = null;
    setSaveState("saving");
    setSaveMessage("Suppression en cours…");
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
        });
        if (response.status === 204) {
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          await loadWorkflows({ excludeWorkflowId: current.id });
          setSaveState("saved");
          setSaveMessage(`Workflow "${current.display_name}" supprimé.`);
          setTimeout(() => setSaveState("idle"), 1500);
          return;
        }
        if (response.status === 400) {
          let message = "Impossible de supprimer le workflow.";
          try {
            const detail = (await response.json()) as { detail?: unknown };
            if (detail && typeof detail.detail === "string") {
              message = detail.detail;
            }
          } catch (parseError) {
            console.error(parseError);
          }
          throw new Error(message);
        }
        if (response.status === 404) {
          throw new Error("Le workflow n'existe plus.");
        }
        throw new Error(`Impossible de supprimer le workflow (${response.status}).`);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError = error instanceof Error ? error : new Error("Impossible de supprimer le workflow.");
      }
    }
    setSaveState("error");
    setSaveMessage(lastError?.message ?? "Impossible de supprimer le workflow.");
  }, [
    authHeader,
    loadWorkflows,
    selectedWorkflowId,
    setSelectedEdgeId,
    setSelectedNodeId,
    workflows,
  ]);

  const handleSelectChatkitWorkflow = useCallback(async () => {
    if (!selectedWorkflowId) {
      return;
    }
    const current = workflows.find((workflow) => workflow.id === selectedWorkflowId);
    if (!current || current.is_chatkit_default) {
      return;
    }
    if (!current.active_version_id) {
      setSaveState("error");
      setSaveMessage(
        "Publiez une version de production avant d'utiliser ce workflow avec ChatKit.",
      );
      return;
    }

    setActionMenuOpen(false);
    const endpoint = "/api/workflows/chatkit";
    const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
    let lastError: Error | null = null;
    setSaveState("saving");
    setSaveMessage("Mise à jour du workflow ChatKit…");
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({ workflow_id: current.id }),
        });
        if (!response.ok) {
          if (response.status === 400 || response.status === 404) {
            try {
              const detail = (await response.json()) as { detail?: unknown };
              const message =
                detail && typeof detail.detail === "string"
                  ? detail.detail
                  : "Impossible de sélectionner le workflow pour ChatKit.";
              throw new Error(message);
            } catch (error) {
              if (error instanceof Error && error.name === "SyntaxError") {
                throw new Error("Impossible de sélectionner le workflow pour ChatKit.");
              }
              throw error;
            }
          }
          throw new Error(
            `Impossible de sélectionner le workflow pour ChatKit (${response.status}).`,
          );
        }
        await loadWorkflows({
          selectWorkflowId: current.id,
          selectVersionId: selectedVersionId ?? null,
        });
        setSaveState("saved");
        setSaveMessage(`Workflow "${current.display_name}" sélectionné pour ChatKit.`);
        setTimeout(() => setSaveState("idle"), 1500);
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError = error instanceof Error ? error : new Error("Impossible de sélectionner le workflow pour ChatKit.");
      }
    }
    setSaveState("error");
    setSaveMessage(
      lastError?.message ?? "Impossible de sélectionner le workflow pour ChatKit.",
    );
  }, [
    authHeader,
    loadWorkflows,
    selectedVersionId,
    selectedWorkflowId,
    workflows,
  ]);

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

  const buildGraphPayload = useCallback(
    () => buildGraphPayloadFrom(nodes, edges),
    [edges, nodes],
  );

  const graphSnapshot = useMemo(() => JSON.stringify(buildGraphPayload()), [buildGraphPayload]);

  useEffect(() => {
    if (!selectedWorkflowId) {
      lastSavedSnapshotRef.current = null;
      setHasPendingChanges(false);
      return;
    }

    if (isHydratingRef.current) {
      isHydratingRef.current = false;
      return;
    }

    if (!lastSavedSnapshotRef.current) {
      lastSavedSnapshotRef.current = graphSnapshot;
      setHasPendingChanges(false);
      return;
    }

    setHasPendingChanges(graphSnapshot !== lastSavedSnapshotRef.current);
  }, [graphSnapshot, selectedWorkflowId]);

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
      const graphPayload = buildGraphPayload();
      const graphSnapshot = JSON.stringify(graphPayload);

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
            mark_as_active: false,
          }),
        });
        if (!response.ok) {
          throw new Error(`Échec de l'enregistrement (${response.status})`);
        }
        const data: WorkflowVersionResponse = await response.json();
        const currentWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId);
        if (currentWorkflow?.is_chatkit_default) {
          const updateCandidates = makeApiEndpointCandidates(
            backendUrl,
            "/api/workflows/current",
          );
          let updateError: Error | null = null;
          for (const updateUrl of updateCandidates) {
            try {
              const updateResponse = await fetch(updateUrl, {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  ...authHeader,
                },
                body: JSON.stringify({ graph: graphPayload }),
              });
              if (!updateResponse.ok) {
                throw new Error(
                  `Échec de la mise à jour du workflow ChatKit (${updateResponse.status})`,
                );
              }
              updateError = null;
              break;
            } catch (error) {
              if (error instanceof Error && error.name === "AbortError") {
                continue;
              }
              updateError =
                error instanceof Error
                  ? error
                  : new Error("Impossible de mettre à jour le workflow ChatKit.");
            }
          }
          if (updateError) {
            throw updateError;
          }
        }
        await loadVersions(selectedWorkflowId, data.id);
        setSaveState("saved");
        lastSavedSnapshotRef.current = graphSnapshot;
        setHasPendingChanges(false);
        setSaveMessage("Modifications enregistrées automatiquement.");
        setTimeout(() => setSaveState("idle"), 1500);
        return;
      }
      throw new Error("Impossible de contacter le serveur pour enregistrer la version.");
    } catch (error) {
      setSaveState("error");
      setHasPendingChanges(true);
      setSaveMessage(
        error instanceof Error ? error.message : "Impossible d'enregistrer le workflow."
      );
    }
  }, [
    authHeader,
    buildGraphPayload,
    loadVersions,
    selectedWorkflowId,
    workflows,
  ]);

  const handleDuplicateWorkflow = useCallback(async () => {
    if (!selectedWorkflow) {
      return;
    }

    const baseName = selectedWorkflow.display_name?.trim() || "Workflow sans nom";
    const proposed = window.prompt("Nom du duplicata ?", `${baseName} (copie)`);
    if (!proposed) {
      return;
    }

    const displayName = proposed.trim();
    if (!displayName) {
      return;
    }

    const payload = {
      slug: slugifyWorkflowName(displayName),
      display_name: displayName,
      description: selectedWorkflow.description,
      graph: buildGraphPayload(),
    };

    const candidates = makeApiEndpointCandidates(backendUrl, "/api/workflows");
    let lastError: Error | null = null;
    setSaveState("saving");
    setSaveMessage("Duplication en cours…");
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
          throw new Error(`Échec de la duplication (${response.status})`);
        }

        const data: WorkflowVersionResponse = await response.json();
        setActionMenuOpen(false);
        await loadWorkflows({ selectWorkflowId: data.workflow_id, selectVersionId: data.id });
        setSaveState("saved");
        setSaveMessage(`Workflow dupliqué sous "${displayName}".`);
        setTimeout(() => setSaveState("idle"), 1500);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Impossible de dupliquer le workflow.");
      }
    }

    setSaveState("error");
    setSaveMessage(lastError?.message ?? "Impossible de dupliquer le workflow.");
  }, [authHeader, buildGraphPayload, loadWorkflows, selectedWorkflow]);

  const handleRenameWorkflow = useCallback(() => {
    setActionMenuOpen(false);
    setSaveState("error");
    setSaveMessage("Le renommage de workflow sera bientôt disponible.");
    setTimeout(() => setSaveState("idle"), 1500);
  }, []);

  const disableSave = useMemo(() => {
    if (!selectedWorkflowId) {
      return true;
    }

    if (nodes.some((node) => node.data.parametersError)) {
      return true;
    }

    const availableVectorStoreSlugs = new Set(vectorStores.map((store) => store.slug));
    const availableWidgetSlugs = new Set(widgets.map((widget) => widget.slug));

    return nodes.some((node) => {
      if (node.data.kind !== "agent" || !node.data.isEnabled) {
        return false;
      }

      const fileSearchConfig = getAgentFileSearchConfig(node.data.parameters);
      if (fileSearchConfig) {
        const slug = fileSearchConfig.vector_store_slug?.trim() ?? "";
        if (!slug) {
          return true;
        }

        if (!vectorStoresError && vectorStores.length > 0 && !availableVectorStoreSlugs.has(slug)) {
          return true;
        }
      }

      const responseFormat = getAgentResponseFormat(node.data.parameters);
      if (responseFormat.kind === "widget") {
        const slug = responseFormat.slug.trim();
        if (!slug) {
          return true;
        }
        if (!widgetsError && widgets.length > 0 && !availableWidgetSlugs.has(slug)) {
          return true;
        }
      }

      return false;
    });
  }, [
    nodes,
    selectedWorkflowId,
    vectorStores,
    vectorStoresError,
    widgets,
    widgetsError,
  ]);

  useEffect(() => {
    if (
      !hasPendingChanges ||
      disableSave ||
      saveState === "saving" ||
      loading ||
      !selectedWorkflowId
    ) {
      if (autoSaveTimeoutRef.current !== null) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      return;
    }

    if (autoSaveTimeoutRef.current !== null) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = window.setTimeout(() => {
      autoSaveTimeoutRef.current = null;
      void handleSave();
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (autoSaveTimeoutRef.current !== null) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    };
  }, [
    disableSave,
    handleSave,
    hasPendingChanges,
    loading,
    saveState,
    selectedWorkflowId,
  ]);

  const blockLibraryItems = useMemo(
    () => [
      {
        key: "agent",
        label: "Agent",
        shortLabel: "A",
        color: NODE_COLORS.agent,
        onClick: handleAddAgentNode,
      },
      {
        key: "condition",
        label: "Condition",
        shortLabel: "C",
        color: NODE_COLORS.condition,
        onClick: handleAddConditionNode,
      },
      {
        key: "state",
        label: "Bloc état",
        shortLabel: "É",
        color: NODE_COLORS.state,
        onClick: handleAddStateNode,
      },
    ],
    [handleAddAgentNode, handleAddConditionNode, handleAddStateNode],
  );

  const showPropertiesPanel = Boolean(selectedNode || selectedEdge);
  const selectedElementLabel = selectedNode
    ? selectedNode.data.displayName.trim() || labelForKind(selectedNode.data.kind)
    : selectedEdge
      ? `${selectedEdge.source} → ${selectedEdge.target}`
      : "";
  const toastStyles = useMemo(() => {
    switch (saveState) {
      case "error":
        return { background: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca" } as const;
      case "saving":
        return { background: "#e0f2fe", color: "#0369a1", border: "1px solid #bae6fd" } as const;
      case "saved":
        return { background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" } as const;
      default:
        return { background: "#f1f5f9", color: "#0f172a", border: "1px solid #cbd5f5" } as const;
    }
  }, [saveState]);


  return (
    <ReactFlowProvider>
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          background: "#f1f5f9",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1.5rem",
            padding: "1rem 1.5rem",
            background: "#fff",
            borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
            boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
            zIndex: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button
              type="button"
              onClick={toggleNavigation}
              aria-expanded={isNavigationOpen}
              aria-controls="workflow-navigation-panel"
              aria-label={
                isNavigationOpen ? "Fermer la navigation générale" : "Ouvrir la navigation générale"
              }
              style={{
                width: "2.75rem",
                height: "2.75rem",
                borderRadius: "0.75rem",
                border: "1px solid rgba(15, 23, 42, 0.18)",
                background: "#f8fafc",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M3 5h14M3 10h14M3 15h14" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "1rem",
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", minWidth: "240px" }}>
              <span style={controlLabelStyle}>Workflow</span>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <select
                  id="workflow-select"
                  value={selectedWorkflowId ? String(selectedWorkflowId) : ""}
                  onChange={handleWorkflowChange}
                  disabled={loading || workflows.length === 0}
                  style={{
                    flexGrow: 1,
                    minWidth: "180px",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.75rem",
                    border: "1px solid rgba(15, 23, 42, 0.15)",
                    background: "#fff",
                    color: "#0f172a",
                  }}
                >
                  {workflows.length === 0 ? (
                    <option value="">Aucun workflow disponible</option>
                  ) : (
                    <>
                      <option value="" disabled>
                        Sélectionnez un workflow
                      </option>
                      {workflows.map((workflow) => (
                        <option key={workflow.id} value={workflow.id}>
                          {workflow.display_name}
                          {workflow.active_version_number
                            ? ` · prod v${workflow.active_version_number}`
                            : ""}
                          {workflow.is_chatkit_default ? " · 🟢 Actif" : ""}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <button
                  type="button"
                  onClick={handleCreateWorkflow}
                  disabled={loading}
                  style={{
                    padding: "0.5rem 0.9rem",
                    borderRadius: "0.75rem",
                    border: "1px solid rgba(15, 23, 42, 0.15)",
                    background: "#fff",
                    color: "#0f172a",
                    fontWeight: 600,
                    cursor: loading ? "not-allowed" : "pointer",
                    opacity: loading ? 0.5 : 1,
                  }}
                >
                  Nouveau
                </button>
              </div>
              {selectedWorkflow?.description ? (
                <small style={{ color: "#475569" }}>{selectedWorkflow.description}</small>
              ) : null}
              {selectedWorkflow && !selectedWorkflow.active_version_id ? (
                <span style={{ color: "#b45309", fontSize: "0.75rem" }}>
                  Publiez une version de production pour l'utiliser avec ChatKit.
                </span>
              ) : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", minWidth: "220px" }}>
              <span style={controlLabelStyle}>Révision</span>
              <select
                id="version-select"
                value={selectedVersionId ? String(selectedVersionId) : ""}
                onChange={handleVersionChange}
                disabled={loading || versions.length === 0}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.75rem",
                  border: "1px solid rgba(15, 23, 42, 0.15)",
                  background: "#fff",
                  color: "#0f172a",
                }}
              >
                {versions.length === 0 ? (
                  <option value="">Aucune version disponible</option>
                ) : (
                  versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {`v${version.version}${version.name ? ` · ${version.name}` : ""}`}
                    </option>
                  ))
                )}
              </select>
              {selectedVersionSummary?.is_active ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    fontSize: "0.75rem",
                    color: "#047857",
                    fontWeight: 600,
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: "0.65rem" }}>
                    ●
                  </span>
                  Production
                </span>
              ) : null}
              {selectedVersionSummary ? (
                <small style={{ color: "#475569" }}>
                  Dernière mise à jour : {formatDateTime(selectedVersionSummary.updated_at)}
                </small>
              ) : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={handlePromoteVersion}
                disabled={
                  loading || !selectedWorkflowId || !selectedVersionId || selectedVersionSummary?.is_active
                }
                style={{
                  padding: "0.55rem 1.1rem",
                  borderRadius: "0.75rem",
                  border: "1px solid rgba(15, 23, 42, 0.15)",
                  background: "#fff",
                  color: "#0f172a",
                  fontWeight: 600,
                  cursor:
                    loading || !selectedWorkflowId || !selectedVersionId || selectedVersionSummary?.is_active
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    loading || !selectedWorkflowId || !selectedVersionId || selectedVersionSummary?.is_active
                      ? 0.5
                      : 1,
                }}
              >
                Déployer
              </button>
              <div ref={actionMenuRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setActionMenuOpen((prev) => !prev)}
                  aria-haspopup="true"
                  aria-expanded={isActionMenuOpen}
                  style={{
                    width: "2.5rem",
                    height: "2.5rem",
                    borderRadius: "0.75rem",
                    border: "1px solid rgba(15, 23, 42, 0.15)",
                    background: "#fff",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: "1.5rem", lineHeight: 1, color: "#0f172a" }}>…</span>
                </button>
                {isActionMenuOpen ? (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 0.5rem)",
                      right: 0,
                      background: "#fff",
                      borderRadius: "0.75rem",
                      border: "1px solid rgba(15, 23, 42, 0.1)",
                      boxShadow: "0 20px 40px rgba(15, 23, 42, 0.12)",
                      padding: "0.5rem",
                      minWidth: "220px",
                      zIndex: 30,
                    }}
                  >
                    <button
                      type="button"
                      onClick={handleRenameWorkflow}
                      disabled={!selectedWorkflowId}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "0.6rem 0.75rem",
                        borderRadius: "0.6rem",
                        border: "none",
                        background: "transparent",
                        color: "#0f172a",
                        fontWeight: 500,
                        cursor: !selectedWorkflowId ? "not-allowed" : "pointer",
                        opacity: !selectedWorkflowId ? 0.5 : 1,
                      }}
                    >
                      Renommer
                    </button>
                    <button
                      type="button"
                      onClick={handleSelectChatkitWorkflow}
                      disabled={
                        loading ||
                        !selectedWorkflowId ||
                        selectedWorkflow?.is_chatkit_default ||
                        !selectedWorkflow?.active_version_id
                      }
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "0.6rem 0.75rem",
                        borderRadius: "0.6rem",
                        border: "none",
                        background: "transparent",
                        color: "#0f172a",
                        fontWeight: 500,
                        cursor:
                          loading ||
                          !selectedWorkflowId ||
                          selectedWorkflow?.is_chatkit_default ||
                          !selectedWorkflow?.active_version_id
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          loading ||
                          !selectedWorkflowId ||
                          selectedWorkflow?.is_chatkit_default ||
                          !selectedWorkflow?.active_version_id
                            ? 0.5
                            : 1,
                      }}
                    >
                      Définir pour ChatKit
                    </button>
                    <button
                      type="button"
                      onClick={handleDuplicateWorkflow}
                      disabled={loading || !selectedWorkflowId}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "0.6rem 0.75rem",
                        borderRadius: "0.6rem",
                        border: "none",
                        background: "transparent",
                        color: "#0f172a",
                        fontWeight: 500,
                        cursor: loading || !selectedWorkflowId ? "not-allowed" : "pointer",
                        opacity: loading || !selectedWorkflowId ? 0.5 : 1,
                      }}
                    >
                      Dupliquer
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteWorkflow}
                      disabled={loading || !selectedWorkflowId || selectedWorkflow?.is_chatkit_default}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "0.6rem 0.75rem",
                        borderRadius: "0.6rem",
                        border: "none",
                        background: "transparent",
                        color: "#b91c1c",
                        fontWeight: 500,
                        cursor:
                          loading || !selectedWorkflowId || selectedWorkflow?.is_chatkit_default
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          loading || !selectedWorkflowId || selectedWorkflow?.is_chatkit_default ? 0.5 : 1,
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>
        <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, padding: "1.5rem" }}>
            <div
              style={{
                height: "100%",
                borderRadius: "1.25rem",
                border: "1px solid rgba(15, 23, 42, 0.08)",
                background: "#fff",
                overflow: "hidden",
                boxShadow: "0 20px 40px rgba(15, 23, 42, 0.06)",
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
                  onPaneClick={handleClearSelection}
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
            </div>
          </div>
          <aside
            aria-label="Bibliothèque de blocs"
            style={{
              position: "absolute",
              top: "1.5rem",
              left: "1.5rem",
              width: "280px",
              maxWidth: "calc(100% - 3rem)",
              maxHeight: "calc(100% - 3rem)",
              padding: "1.25rem",
              borderRadius: "1rem",
              border: "1px solid rgba(15, 23, 42, 0.1)",
              background: "#fff",
              boxShadow: "0 16px 32px rgba(15, 23, 42, 0.08)",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              zIndex: 20,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#0f172a" }}>Bibliothèque de blocs</h2>
              <p style={{ margin: "0.25rem 0 0", color: "#475569" }}>
                Ajoutez des blocs pour construire votre workflow.
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {blockLibraryItems.map((item) => {
                const disabled = loading || !selectedWorkflowId;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => item.onClick()}
                    disabled={disabled}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.75rem",
                      borderRadius: "0.9rem",
                      border: "1px solid rgba(15, 23, 42, 0.12)",
                      background: "#fff",
                      boxShadow: "0 8px 18px rgba(15, 23, 42, 0.08)",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.5 : 1,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: "2.35rem",
                        height: "2.35rem",
                        borderRadius: "0.75rem",
                        background: item.color,
                        color: "#fff",
                        display: "grid",
                        placeItems: "center",
                        fontWeight: 700,
                        fontSize: "1.1rem",
                      }}
                    >
                      {item.shortLabel}
                    </span>
                    <span style={{ fontWeight: 600, color: "#0f172a" }}>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </aside>
          {showPropertiesPanel ? (
            <aside
              aria-label="Propriétés du bloc sélectionné"
              style={{
                position: "absolute",
                top: "1.5rem",
                right: "1.5rem",
                width: "360px",
                maxWidth: "calc(100% - 3rem)",
                maxHeight: "calc(100% - 3rem)",
                borderRadius: "1rem",
                border: "1px solid rgba(15, 23, 42, 0.1)",
                background: "#fff",
                boxShadow: "0 16px 32px rgba(15, 23, 42, 0.1)",
                display: "flex",
                flexDirection: "column",
                zIndex: 25,
              }}
            >
              <header
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "1rem 1.25rem",
                  borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
                  gap: "0.75rem",
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: "0.75rem", letterSpacing: "0.08em", color: "#64748b" }}>
                    Propriétés du bloc
                  </p>
                  <h2 style={{ margin: "0.25rem 0 0", fontSize: "1.25rem", color: "#0f172a" }}>
                    {selectedElementLabel || "Bloc"}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  aria-label="Fermer le panneau de propriétés"
                  style={{
                    width: "2.25rem",
                    height: "2.25rem",
                    borderRadius: "0.6rem",
                    border: "1px solid rgba(15, 23, 42, 0.12)",
                    background: "#f8fafc",
                    color: "#0f172a",
                    fontSize: "1.25rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </header>
              <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem" }}>
                {selectedNode ? (
                  <NodeInspector
                    node={selectedNode}
                    onToggle={handleToggleNode}
                    onDisplayNameChange={handleDisplayNameChange}
                    onAgentMessageChange={handleAgentMessageChange}
                    onAgentModelChange={handleAgentModelChange}
                    onAgentReasoningChange={handleAgentReasoningChange}
                    onAgentReasoningVerbosityChange={handleAgentReasoningVerbosityChange}
                    onAgentReasoningSummaryChange={handleAgentReasoningSummaryChange}
                    onAgentTemperatureChange={handleAgentTemperatureChange}
                    onAgentTopPChange={handleAgentTopPChange}
                    onAgentMaxOutputTokensChange={handleAgentMaxOutputTokensChange}
                    onAgentResponseFormatKindChange={handleAgentResponseFormatKindChange}
                    onAgentResponseFormatNameChange={handleAgentResponseFormatNameChange}
                    onAgentResponseFormatSchemaChange={handleAgentResponseFormatSchemaChange}
                    onAgentResponseWidgetSlugChange={handleAgentResponseWidgetSlugChange}
                    onAgentIncludeChatHistoryChange={handleAgentIncludeChatHistoryChange}
                    onAgentDisplayResponseInChatChange={handleAgentDisplayResponseInChatChange}
                    onAgentShowSearchSourcesChange={handleAgentShowSearchSourcesChange}
                    onAgentContinueOnErrorChange={handleAgentContinueOnErrorChange}
                    onAgentStorePreferenceChange={handleAgentStorePreferenceChange}
                    onAgentWebSearchChange={handleAgentWebSearchChange}
                    onAgentFileSearchChange={handleAgentFileSearchChange}
                    availableModels={availableModels}
                    availableModelsLoading={availableModelsLoading}
                    availableModelsError={availableModelsError}
                    isReasoningModel={isReasoningModel}
                    onAgentWeatherToolChange={handleAgentWeatherToolChange}
                    vectorStores={vectorStores}
                    vectorStoresLoading={vectorStoresLoading}
                    vectorStoresError={vectorStoresError}
                    widgets={widgets}
                    widgetsLoading={widgetsLoading}
                    widgetsError={widgetsError}
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
                ) : null}
              </div>
            </aside>
          ) : null}
          {saveMessage ? (
            <div
              style={{
                position: "absolute",
                bottom: "1.5rem",
                left: "50%",
                transform: "translateX(-50%)",
                padding: "0.65rem 1.25rem",
                borderRadius: "9999px",
                boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)",
                zIndex: 30,
                ...toastStyles,
              }}
              role={saveState === "error" ? "alert" : "status"}
            >
              {saveMessage}
            </div>
          ) : null}
          {isNavigationOpen ? (
            <div
              id="workflow-navigation-panel"
              role="dialog"
              aria-modal="true"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "stretch",
                justifyContent: "flex-start",
                background: "rgba(15, 23, 42, 0.45)",
                backdropFilter: "blur(2px)",
                zIndex: 40,
              }}
            >
              <aside
                className="chatkit-sidebar chatkit-sidebar--open"
                style={{
                  position: "relative",
                  transform: "none",
                  boxShadow: "0 24px 48px rgba(15, 23, 42, 0.18)",
                }}
              >
                <header className="chatkit-sidebar__header">
                  <div className="chatkit-sidebar__topline">
                    <div className="chatkit-sidebar__brand">
                      <SidebarIcon name="logo" className="chatkit-sidebar__logo" />
                      <span className="chatkit-sidebar__brand-text">ChatKit Demo</span>
                    </div>
                    <button
                      type="button"
                      className="chatkit-sidebar__dismiss"
                      onClick={closeNavigation}
                      aria-label="Fermer la navigation"
                    >
                      ×
                    </button>
                  </div>
                </header>
                <nav className="chatkit-sidebar__nav" aria-label="Navigation générale">
                  <ul className="chatkit-sidebar__list">
                    {navigationItems.map((item) => (
                      <li key={item.key} className="chatkit-sidebar__item">
                        <button type="button" onClick={item.action} aria-label={item.label}>
                          <SidebarIcon name={item.icon} className="chatkit-sidebar__icon" />
                          <span className="chatkit-sidebar__label">{item.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              </aside>
              <button
                type="button"
                onClick={closeNavigation}
                aria-label="Fermer le panneau de navigation"
                style={{ flexGrow: 1, background: "transparent", border: "none", cursor: "pointer" }}
              />
            </div>
          ) : null}
        </div>
      </div>
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
  onAgentReasoningVerbosityChange: (nodeId: string, value: string) => void;
  onAgentReasoningSummaryChange: (nodeId: string, value: string) => void;
  onAgentTemperatureChange: (nodeId: string, value: string) => void;
  onAgentTopPChange: (nodeId: string, value: string) => void;
  onAgentMaxOutputTokensChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatKindChange: (nodeId: string, kind: "text" | "json_schema" | "widget") => void;
  onAgentResponseFormatNameChange: (nodeId: string, value: string) => void;
  onAgentResponseFormatSchemaChange: (nodeId: string, schema: unknown) => void;
  onAgentResponseWidgetSlugChange: (nodeId: string, slug: string) => void;
  onAgentIncludeChatHistoryChange: (nodeId: string, value: boolean) => void;
  onAgentDisplayResponseInChatChange: (nodeId: string, value: boolean) => void;
  onAgentShowSearchSourcesChange: (nodeId: string, value: boolean) => void;
  onAgentContinueOnErrorChange: (nodeId: string, value: boolean) => void;
  onAgentStorePreferenceChange: (nodeId: string, value: boolean) => void;
  onAgentWebSearchChange: (nodeId: string, config: WebSearchConfig | null) => void;
  onAgentFileSearchChange: (nodeId: string, config: FileSearchConfig | null) => void;
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  isReasoningModel: (model: string) => boolean;
  onAgentWeatherToolChange: (nodeId: string, enabled: boolean) => void;
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  widgets: WidgetTemplate[];
  widgetsLoading: boolean;
  widgetsError: string | null;
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
  onAgentReasoningVerbosityChange,
  onAgentReasoningSummaryChange,
  onAgentTemperatureChange,
  onAgentTopPChange,
  onAgentMaxOutputTokensChange,
  onAgentResponseFormatKindChange,
  onAgentResponseFormatNameChange,
  onAgentResponseFormatSchemaChange,
  onAgentResponseWidgetSlugChange,
  onAgentIncludeChatHistoryChange,
  onAgentDisplayResponseInChatChange,
  onAgentShowSearchSourcesChange,
  onAgentContinueOnErrorChange,
  onAgentStorePreferenceChange,
  onAgentWebSearchChange,
  onAgentFileSearchChange,
  availableModels,
  availableModelsLoading,
  availableModelsError,
  isReasoningModel,
  onAgentWeatherToolChange,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
  widgets,
  widgetsLoading,
  widgetsError,
  onStateAssignmentsChange,
  onParametersChange,
  onRemove,
}: NodeInspectorProps) => {
  const { kind, displayName, isEnabled, parameters, parametersText, parametersError } =
    node.data;
  const isFixed = kind === "start" || kind === "end";
  const agentMessage = getAgentMessage(parameters);
  const agentModel = getAgentModel(parameters);
  const reasoningEffort = getAgentReasoningEffort(parameters);
  const responseFormat = getAgentResponseFormat(parameters);
  const temperature = getAgentTemperature(parameters);
  const topP = getAgentTopP(parameters);
  const reasoningVerbosity = getAgentReasoningVerbosity(parameters);
  const rawReasoningSummary = getAgentReasoningSummary(parameters);
  const reasoningSummaryValue = rawReasoningSummary.trim() ? rawReasoningSummary : "none";
  const maxOutputTokens = getAgentMaxOutputTokens(parameters);
  const maxOutputTokensValue =
    typeof maxOutputTokens === "number" ? String(maxOutputTokens) : "";
  const includeChatHistory = getAgentIncludeChatHistory(parameters);
  const displayResponseInChat = getAgentDisplayResponseInChat(parameters);
  const showSearchSources = getAgentShowSearchSources(parameters);
  const continueOnError = getAgentContinueOnError(parameters);
  const storeResponses = getAgentStorePreference(parameters);
  const webSearchConfig = getAgentWebSearchConfig(parameters);
  const webSearchEnabled = Boolean(webSearchConfig);
  const fileSearchConfig = getAgentFileSearchConfig(parameters);
  const fileSearchEnabled = Boolean(fileSearchConfig);
  const weatherFunctionEnabled = getAgentWeatherToolEnabled(parameters);
  const selectedVectorStoreSlug = fileSearchConfig?.vector_store_slug ?? "";
  const trimmedVectorStoreSlug = selectedVectorStoreSlug.trim();
  const selectedVectorStoreExists =
    trimmedVectorStoreSlug.length > 0 && vectorStores.some((store) => store.slug === trimmedVectorStoreSlug);
  const fileSearchMissingVectorStore =
    fileSearchEnabled &&
    (!trimmedVectorStoreSlug || (!vectorStoresError && vectorStores.length > 0 && !selectedVectorStoreExists));
  const responseWidgetSlug = responseFormat.kind === "widget" ? responseFormat.slug : "";
  const trimmedWidgetSlug = responseWidgetSlug.trim();
  const selectedWidget = useMemo(() => {
    if (responseFormat.kind !== "widget") {
      return null;
    }
    if (!trimmedWidgetSlug) {
      return null;
    }
    return widgets.find((widget) => widget.slug === trimmedWidgetSlug) ?? null;
  }, [responseFormat.kind, trimmedWidgetSlug, widgets]);
  const selectedWidgetExists =
    responseFormat.kind === "widget" && trimmedWidgetSlug.length > 0 && Boolean(selectedWidget);
  let fileSearchValidationMessage: string | null = null;
  if (fileSearchMissingVectorStore && !vectorStoresLoading) {
    if (!vectorStoresError && vectorStores.length === 0) {
      fileSearchValidationMessage =
        "Créez un vector store avant d'activer la recherche documentaire.";
    } else if (trimmedVectorStoreSlug && !selectedVectorStoreExists) {
      fileSearchValidationMessage =
        "Le vector store sélectionné n'est plus disponible. Choisissez-en un autre.";
    } else {
      fileSearchValidationMessage =
        "Sélectionnez un vector store pour activer la recherche documentaire.";
    }
  }
  let widgetValidationMessage: string | null = null;
  if (responseFormat.kind === "widget" && !widgetsLoading && !widgetsError && widgets.length > 0) {
    if (!trimmedWidgetSlug) {
      widgetValidationMessage = "Sélectionnez un widget de sortie.";
    } else if (!selectedWidgetExists) {
      widgetValidationMessage = "Le widget sélectionné n'est plus disponible. Choisissez-en un autre.";
    }
  }
  const matchedModel = availableModels.find((model) => model.name === agentModel);
  const selectedModelOption = matchedModel ? matchedModel.name : "";
  const supportsReasoning = isReasoningModel(agentModel);
  const temperatureValue = typeof temperature === "number" ? String(temperature) : "";
  const topPValue = typeof topP === "number" ? String(topP) : "";
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
            <select
              value={selectedModelOption}
              onChange={(event) => onAgentModelChange(node.id, event.target.value)}
              disabled={availableModelsLoading}
            >
              <option value="">Modèle personnalisé ou non listé</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.name}>
                  {model.display_name?.trim()
                    ? `${model.display_name} (${model.name})`
                    : model.name}
                  {model.supports_reasoning ? " – raisonnement" : ""}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={agentModel}
              placeholder="Ex. gpt-4.1-mini"
              onChange={(event) => onAgentModelChange(node.id, event.target.value)}
            />
            {availableModelsLoading ? (
              <small style={{ color: "#475569" }}>Chargement des modèles autorisés…</small>
            ) : availableModelsError ? (
              <span style={{ color: "#b91c1c", fontSize: "0.85rem" }}>{availableModelsError}</span>
            ) : matchedModel?.description ? (
              <small style={{ color: "#475569" }}>{matchedModel.description}</small>
            ) : null}
            <small style={{ color: "#475569" }}>
              Sélectionnez un modèle autorisé ou saisissez une valeur personnalisée dans le champ texte.
            </small>
          </label>

          {supportsReasoning ? (
            <>
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

              <label style={fieldStyle}>
                <span>Verbosité du raisonnement</span>
                <select
                  value={reasoningVerbosity}
                  onChange={(event) => onAgentReasoningVerbosityChange(node.id, event.target.value)}
                >
                  {reasoningVerbosityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small style={{ color: "#475569" }}>
                  Contrôle la quantité de texte générée pendant les étapes de raisonnement.
                </small>
              </label>

              <label style={fieldStyle}>
                <span>Résumé des étapes</span>
                <select
                  value={reasoningSummaryValue}
                  onChange={(event) => onAgentReasoningSummaryChange(node.id, event.target.value)}
                >
                  {reasoningSummaryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small style={{ color: "#475569" }}>
                  Détermine si l'agent doit générer un résumé automatique de son raisonnement.
                </small>
              </label>
            </>
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
            <span>Nombre maximal de tokens générés</span>
            <input
              type="number"
              min="1"
              step="1"
              value={maxOutputTokensValue}
              placeholder="Laisser vide pour la valeur par défaut"
              onChange={(event) => onAgentMaxOutputTokensChange(node.id, event.target.value)}
            />
            <small style={{ color: "#475569" }}>
              Limite la longueur maximale des réponses produites par cet agent.
            </small>
          </label>

          <div style={{ display: "grid", gap: "0.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={includeChatHistory}
                onChange={(event) =>
                  onAgentIncludeChatHistoryChange(node.id, event.target.checked)
                }
              />
              Inclure l'historique du chat
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={displayResponseInChat}
                onChange={(event) =>
                  onAgentDisplayResponseInChatChange(node.id, event.target.checked)
                }
              />
              Afficher la réponse dans le chat
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={showSearchSources}
                onChange={(event) =>
                  onAgentShowSearchSourcesChange(node.id, event.target.checked)
                }
              />
              Afficher les sources de recherche
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={continueOnError}
                onChange={(event) =>
                  onAgentContinueOnErrorChange(node.id, event.target.checked)
                }
              />
              Continuer l'exécution en cas d'erreur
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={storeResponses}
                onChange={(event) =>
                  onAgentStorePreferenceChange(node.id, event.target.checked)
                }
              />
              Enregistrer la réponse dans l'historique de conversation
            </label>
          </div>

          <label style={fieldStyle}>
            <span>Type de sortie</span>
            <select
              value={responseFormat.kind}
              onChange={(event) => {
                const nextKind = event.target.value as "text" | "json_schema" | "widget";
                onAgentResponseFormatKindChange(node.id, nextKind);
              }}
            >
              <option value="text">Texte libre</option>
              <option value="json_schema">Schéma JSON</option>
              <option value="widget">Widget de la bibliothèque</option>
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

          {responseFormat.kind === "widget" && (
            <label style={fieldStyle}>
              <span>Widget de sortie</span>
              {widgetsLoading ? (
                <p style={{ color: "#475569", margin: 0 }}>Chargement de la bibliothèque de widgets…</p>
              ) : widgetsError ? (
                <p style={{ color: "#b91c1c", margin: 0 }}>{widgetsError}</p>
              ) : widgets.length === 0 ? (
                <>
                  <select value="" disabled>
                    <option value="">Aucun widget disponible</option>
                  </select>
                  <p style={{ color: "#b45309", margin: "0.25rem 0 0" }}>
                    Créez un widget dans la bibliothèque dédiée pour l'afficher dans le chat.
                  </p>
                </>
              ) : (
                <>
                  <select
                    value={responseWidgetSlug}
                    onChange={(event) => onAgentResponseWidgetSlugChange(node.id, event.target.value)}
                  >
                    <option value="">Sélectionnez un widget</option>
                    {widgets.map((widget) => (
                      <option key={widget.slug} value={widget.slug}>
                        {widget.title?.trim()
                          ? `${widget.title} (${widget.slug})`
                          : widget.slug}
                      </option>
                    ))}
                  </select>
                  {widgetValidationMessage ? (
                    <p style={{ color: "#b91c1c", margin: "0.25rem 0 0" }}>{widgetValidationMessage}</p>
                  ) : (
                    <small style={{ color: "#475569" }}>
                      Le widget sélectionné sera affiché dans ChatKit lorsque l'agent répondra.
                    </small>
                  )}
                </>
              )}
            </label>
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
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={fileSearchEnabled}
                onChange={(event) => {
                  if (event.target.checked) {
                    const preferredSlug =
                      (fileSearchConfig?.vector_store_slug?.trim() ?? "") ||
                      vectorStores[0]?.slug ||
                      "";
                    onAgentFileSearchChange(node.id, {
                      vector_store_slug: preferredSlug,
                    });
                  } else {
                    onAgentFileSearchChange(node.id, null);
                  }
                }}
              />
              Activer la recherche documentaire
            </label>
            {vectorStoresError ? (
              <p style={{ color: "#b91c1c", margin: 0 }}>{vectorStoresError}</p>
            ) : null}
            {fileSearchEnabled && (
              <>
                {vectorStoresLoading ? (
                  <p style={{ color: "#475569", margin: 0 }}>Chargement des vector stores…</p>
                ) : vectorStores.length === 0 ? (
                  <p style={{ color: "#475569", margin: 0 }}>
                    Aucun vector store disponible. Créez-en un depuis l'onglet « Vector stores JSON
                    ».
                  </p>
                ) : (
                  <label style={fieldStyle}>
                    <span>Vector store à interroger</span>
                    <select
                      value={selectedVectorStoreSlug}
                      onChange={(event) =>
                        onAgentFileSearchChange(node.id, {
                          vector_store_slug: event.target.value,
                        })
                      }
                    >
                      <option value="">Sélectionnez un vector store…</option>
                      {vectorStores.map((store) => (
                        <option key={store.slug} value={store.slug}>
                          {store.title?.trim()
                            ? `${store.title} (${store.slug})`
                            : store.slug}
                        </option>
                      ))}
                    </select>
                    <small style={{ color: "#475569" }}>
                      Le document complet du résultat sera transmis à l'agent.
                    </small>
                    {fileSearchValidationMessage && (
                      <p style={{ color: "#b91c1c", margin: 0 }}>{fileSearchValidationMessage}</p>
                    )}
                  </label>
                )}
              </>
            )}
            <div
              style={{
                border: "1px solid rgba(148, 163, 184, 0.35)",
                borderRadius: "0.65rem",
                padding: "0.75rem",
                display: "grid",
                gap: "0.5rem",
                backgroundColor: "rgba(226, 232, 240, 0.25)",
              }}
            >
              <strong style={{ fontSize: "0.9rem" }}>Function tool</strong>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={weatherFunctionEnabled}
                  onChange={(event) =>
                    onAgentWeatherToolChange(node.id, event.target.checked)
                  }
                />
                Autoriser la fonction météo Python
              </label>
              <small style={{ color: "#475569" }}>
                Ajoute l'outil <code>fetch_weather</code> pour récupérer la météo via le
                backend.
              </small>
            </div>
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

const controlLabelStyle: CSSProperties = {
  fontSize: "0.75rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: "#64748b",
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
