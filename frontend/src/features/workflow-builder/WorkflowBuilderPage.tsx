import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  addEdge,
  type Connection,
  type ReactFlowInstance,
  ReactFlowProvider,
  type Viewport,
  useEdgesState,
  useNodesState,
} from "reactflow";

import "reactflow/dist/style.css";

import { useAuth } from "../../auth";
import { useAppLayout } from "../../components/AppLayout";
import {
  makeApiEndpointCandidates,
  modelRegistryApi,
  widgetLibraryApi,
  vectorStoreApi,
  type AvailableModel,
  type WidgetTemplateSummary,
  type VectorStoreSummary,
} from "../../utils/backend";
import { resolveAgentParameters, resolveStateParameters } from "../../utils/agentPresets";
import {
  isPlainRecord,
  parseAgentParameters,
  getAgentFileSearchConfig,
  getAgentResponseFormat,
  setAgentContinueOnError,
  setAgentDisplayResponseInChat,
  setAgentFileSearchConfig,
  setAgentIncludeChatHistory,
  setAgentMaxOutputTokens,
  setAgentMessage,
  setAgentModel,
  setAgentReasoningEffort,
  setAgentReasoningSummary,
  setAgentReasoningVerbosity,
  setAgentResponseFormatKind,
  setAgentResponseFormatName,
  setAgentResponseFormatSchema,
  setAgentResponseWidgetSlug,
  setAgentShowSearchSources,
  setAgentStorePreference,
  setAgentTemperature,
  setAgentTopP,
  setAgentWeatherToolEnabled,
  setAgentWebSearchConfig,
  setStateAssignments,
  stringifyAgentParameters,
  createVectorStoreNodeParameters,
  getVectorStoreNodeConfig,
  setVectorStoreNodeConfig,
  setEndMessage,
  DEFAULT_END_MESSAGE,
  createWidgetNodeParameters,
  resolveWidgetNodeParameters,
  setWidgetNodeSlug,
  setWidgetNodeVariables,
} from "../../utils/workflows";
import EdgeInspector from "./components/EdgeInspector";
import NodeInspector from "./components/NodeInspector";
import type {
  AgentParameters,
  FileSearchConfig,
  FlowEdge,
  FlowEdgeData,
  FlowNode,
  FlowNodeData,
  NodeKind,
  SaveState,
  StateAssignment,
  StateAssignmentScope,
  VectorStoreNodeConfig,
  WebSearchConfig,
  WorkflowSummary,
  WorkflowVersionResponse,
  WorkflowVersionSummary,
  WidgetVariableAssignment,
} from "./types";

export const findLatestDraftVersion = (
  versions: WorkflowVersionSummary[],
): WorkflowVersionSummary | null => {
  return versions
    .filter((version) => !version.is_active)
    .reduce<WorkflowVersionSummary | null>((latest, current) => {
      if (!latest) {
        return current;
      }
      if (current.version > latest.version) {
        return current;
      }
      if (current.version < latest.version) {
        return latest;
      }
      const currentUpdatedAt = new Date(current.updated_at).getTime();
      const latestUpdatedAt = new Date(latest.updated_at).getTime();
      if (Number.isNaN(currentUpdatedAt) && Number.isNaN(latestUpdatedAt)) {
        return latest;
      }
      if (Number.isNaN(currentUpdatedAt)) {
        return latest;
      }
      if (Number.isNaN(latestUpdatedAt)) {
        return current;
      }
      return currentUpdatedAt >= latestUpdatedAt ? current : latest;
    }, null);
};

const normalizeDraftVersionName = (version: WorkflowVersionSummary): WorkflowVersionSummary => {
  if (version.is_active) {
    return version;
  }

  const rawName = version.name?.trim().toLowerCase() ?? "";
  if (!rawName || rawName === "nouvelle version") {
    return { ...version, name: "Brouillon" };
  }

  return version;
};

export const sortVersionsWithDraftFirst = (
  versions: WorkflowVersionSummary[],
): WorkflowVersionSummary[] => {
  const draft = findLatestDraftVersion(versions);
  if (!draft) {
    return versions;
  }

  const normalizedDraft = normalizeDraftVersionName(draft);
  const remaining = versions.filter((version) => version.id !== draft.id);
  return [normalizedDraft, ...remaining];
};

const toVersionSummary = (
  version: WorkflowVersionResponse,
): WorkflowVersionSummary => ({
  id: version.id,
  workflow_id: version.workflow_id,
  name: version.name,
  version: version.version,
  is_active: version.is_active,
  created_at: version.created_at,
  updated_at: version.updated_at,
});
import {
  AUTO_SAVE_DELAY_MS,
  buildGraphPayloadFrom,
  buildNodeStyle,
  connectionLineStyle,
  extractPosition,
  humanizeSlug,
  labelForKind,
  NODE_COLORS,
  slugifyWorkflowName,
  supportsReasoningModel,
  defaultEdgeOptions,
} from "./utils";
import {
  activeWorkflowBadgeStyle,
  actionMenuTriggerIconStyle,
  actionMenuTriggerLabelStyle,
  controlLabelStyle,
  getActionMenuItemStyle,
  getActionMenuStyle,
  getActionMenuTriggerStyle,
  getActionMenuWrapperStyle,
  getCreateWorkflowButtonStyle,
  getDeployButtonStyle,
  getHeaderActionAreaStyle,
  getHeaderContainerStyle,
  getHeaderGroupStyle,
  getHeaderLayoutStyle,
  getHeaderNavigationButtonStyle,
  getMobileHeaderMenuButtonStyle,
  getVersionSelectStyle,
  getWorkflowSelectStyle,
  loadingStyle,
  mobileHeaderMenuIconStyle,
} from "./styles";
import styles from "./WorkflowBuilderPage.module.css";

const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? "").trim();

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQueryList = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    setMatches(mediaQueryList.matches);
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handleChange);
      return () => mediaQueryList.removeEventListener("change", handleChange);
    }
    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList.removeListener(handleChange);
  }, [query]);

  return matches;
};

const WorkflowBuilderPage = () => {
  const { token, logout, user } = useAuth();
  const { openSidebar } = useAppLayout();
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
  const [widgets, setWidgets] = useState<WidgetTemplateSummary[]>([]);
  const [widgetsLoading, setWidgetsLoading] = useState(false);
  const [widgetsError, setWidgetsError] = useState<string | null>(null);
  const [isActionMenuOpen, setActionMenuOpen] = useState(false);
  const [isDeployModalOpen, setDeployModalOpen] = useState(false);
  const [deployToProduction, setDeployToProduction] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const isHydratingRef = useRef(false);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const pendingViewportRestoreRef = useRef(false);

  const authHeader = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);
  const isMobileLayout = useMediaQuery("(max-width: 768px)");
  const [isBlockLibraryOpen, setBlockLibraryOpen] = useState<boolean>(() => !isMobileLayout);
  const blockLibraryToggleRef = useRef<HTMLButtonElement | null>(null);
  const propertiesPanelToggleRef = useRef<HTMLButtonElement | null>(null);
  const propertiesPanelCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isPropertiesPanelOpen, setPropertiesPanelOpen] = useState(false);
  const [isMobileHeaderMenuOpen, setMobileHeaderMenuOpen] = useState(false);
  const mobileHeaderMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousSelectedElementRef = useRef<string | null>(null);
  const isAuthenticated = Boolean(user);
  const isAdmin = Boolean(user?.is_admin);
  const blockLibraryId = "workflow-builder-block-library";
  const propertiesPanelId = "workflow-builder-properties-panel";
  const propertiesPanelTitleId = `${propertiesPanelId}-title`;
  const headerMenuId = "workflow-builder-header-menu";
  const headerMenuTitleId = `${headerMenuId}-title`;
  const toggleBlockLibrary = useCallback(() => {
    setBlockLibraryOpen((prev) => !prev);
  }, []);
  const closeBlockLibrary = useCallback(
    (options: { focusToggle?: boolean } = {}) => {
      setBlockLibraryOpen(false);
      if (options.focusToggle && blockLibraryToggleRef.current) {
        blockLibraryToggleRef.current.focus();
      }
    },
    [blockLibraryToggleRef],
  );

  useEffect(() => {
    setBlockLibraryOpen(!isMobileLayout);
  }, [isMobileLayout]);

  useEffect(() => {
    if (!isMobileLayout || !isBlockLibraryOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBlockLibrary({ focusToggle: true });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeBlockLibrary, isBlockLibraryOpen, isMobileLayout]);

  const closeMobileHeaderMenu = useCallback(
    (options: { focusToggle?: boolean } = {}) => {
      setMobileHeaderMenuOpen(false);
      setActionMenuOpen(false);
      if (options.focusToggle && mobileHeaderMenuButtonRef.current) {
        mobileHeaderMenuButtonRef.current.focus();
      }
    },
    [],
  );
  const handleToggleMobileHeaderMenu = useCallback(() => {
    setMobileHeaderMenuOpen((prev) => {
      if (prev) {
        setActionMenuOpen(false);
      }
      return !prev;
    });
  }, []);

  const handleMobileHeaderMenuButtonPointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );

  const handleMobileHeaderMenuButtonTouchStart = useCallback(
    (event: TouchEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );

  const handleMobileHeaderMenuButtonClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      handleToggleMobileHeaderMenu();
    },
    [handleToggleMobileHeaderMenu],
  );

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

  useEffect(() => {
    if (!isMobileLayout) {
      setMobileHeaderMenuOpen(false);
    }
  }, [isMobileLayout]);

  useEffect(() => {
    if (!isMobileLayout || !isMobileHeaderMenuOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileHeaderMenu({ focusToggle: true });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileHeaderMenu, isMobileHeaderMenuOpen, isMobileLayout]);

  useEffect(() => {
    if (!isMobileHeaderMenuOpen) {
      setActionMenuOpen(false);
    }
  }, [isMobileHeaderMenuOpen]);

  const renderWorkflowDescription = (className?: string) =>
    selectedWorkflow?.description ? (
      <div className={className} style={{ color: "#475569", fontSize: "0.95rem" }}>
        {selectedWorkflow.description}
      </div>
    ) : null;

  const renderWorkflowPublicationReminder = (className?: string) =>
    selectedWorkflow && !selectedWorkflow.active_version_id ? (
      <div className={className} style={{ color: "#b45309", fontSize: "0.85rem", fontWeight: 600 }}>
        Publiez une version pour l'utiliser avec ChatKit.
      </div>
    ) : null;

  const renderHeaderControls = () => (
    <>
      <div style={getHeaderLayoutStyle(isMobileLayout)}>
        <div style={getHeaderGroupStyle(isMobileLayout)}>
          <label htmlFor="workflow-select" style={controlLabelStyle}>
            Workflow
          </label>
          <select
            id="workflow-select"
            value={selectedWorkflowId ? String(selectedWorkflowId) : ""}
            onChange={handleWorkflowChange}
            disabled={loading || workflows.length === 0}
            title={selectedWorkflow?.description ?? undefined}
            style={getWorkflowSelectStyle(isMobileLayout, {
              disabled: loading || workflows.length === 0,
            })}
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
          {selectedWorkflow?.is_chatkit_default ? (
            <span style={activeWorkflowBadgeStyle}>
              🟢 Actif
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleCreateWorkflow}
            disabled={loading}
            style={getCreateWorkflowButtonStyle(isMobileLayout, { disabled: loading })}
          >
            Nouveau
          </button>
        </div>
        <div style={getHeaderGroupStyle(isMobileLayout)}>
          <label htmlFor="version-select" style={controlLabelStyle}>
            Révision
          </label>
          <select
            id="version-select"
            value={selectedVersionId ? String(selectedVersionId) : ""}
            onChange={handleVersionChange}
            disabled={loading || versions.length === 0}
            style={getVersionSelectStyle(isMobileLayout, {
              disabled: loading || versions.length === 0,
            })}
          >
            {versions.length === 0 ? (
              <option value="">Aucune version disponible</option>
            ) : (
              versions.map((version) => {
                const isDraft = latestDraftVersion?.id === version.id;
                const label = isDraft
                  ? `Brouillon (v${version.version})`
                  : [
                      `v${version.version}`,
                      ...(version.name ? [version.name] : []),
                      ...(version.is_active ? ["Production"] : []),
                    ].join(" · ");
                return (
                  <option key={version.id} value={version.id}>
                    {label}
                  </option>
                );
              })
            )}
          </select>
        </div>
      </div>
      <div style={getHeaderActionAreaStyle(isMobileLayout)}>
        <button
          type="button"
          onClick={handleOpenDeployModal}
          disabled={loading || !selectedWorkflowId || versions.length === 0 || isDeploying}
          style={getDeployButtonStyle(isMobileLayout, {
            disabled: loading || !selectedWorkflowId || versions.length === 0 || isDeploying,
          })}
        >
          Déployer
        </button>
        <div ref={actionMenuRef} style={getActionMenuWrapperStyle(isMobileLayout)}>
          <button
            type="button"
            onClick={() => setActionMenuOpen((prev) => !prev)}
            aria-haspopup="true"
            aria-expanded={isActionMenuOpen}
            aria-label="Afficher les actions supplémentaires"
            style={getActionMenuTriggerStyle(isMobileLayout)}
          >
            {isMobileLayout ? (
              <>
                <span style={actionMenuTriggerLabelStyle}>Actions</span>
                <span aria-hidden="true" style={actionMenuTriggerIconStyle}>
                  …
                </span>
              </>
            ) : (
              <span aria-hidden="true" style={actionMenuTriggerIconStyle}>
                …
              </span>
            )}
          </button>
          {isActionMenuOpen ? (
            <div style={getActionMenuStyle(isMobileLayout)}>
              <button
                type="button"
                onClick={handleRenameWorkflow}
                disabled={!selectedWorkflowId}
                style={getActionMenuItemStyle(isMobileLayout, {
                  disabled: !selectedWorkflowId,
                })}
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
                style={getActionMenuItemStyle(isMobileLayout, {
                  disabled:
                    loading ||
                    !selectedWorkflowId ||
                    selectedWorkflow?.is_chatkit_default ||
                    !selectedWorkflow?.active_version_id,
                })}
              >
                Définir pour ChatKit
              </button>
              <button
                type="button"
                onClick={handleDuplicateWorkflow}
                disabled={loading || !selectedWorkflowId}
                style={getActionMenuItemStyle(isMobileLayout, {
                  disabled: loading || !selectedWorkflowId,
                })}
              >
                Dupliquer
              </button>
              <button
                type="button"
                onClick={handleDeleteWorkflow}
                disabled={loading || !selectedWorkflowId || selectedWorkflow?.is_chatkit_default}
                style={getActionMenuItemStyle(isMobileLayout, {
                  disabled: loading || !selectedWorkflowId || selectedWorkflow?.is_chatkit_default,
                  danger: true,
                })}
              >
                Supprimer
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );

  const restoreViewport = useCallback(() => {
    const instance = reactFlowInstanceRef.current;
    if (!instance) {
      pendingViewportRestoreRef.current = true;
      return;
    }

    pendingViewportRestoreRef.current = false;
    requestAnimationFrame(() => {
      const flow = reactFlowInstanceRef.current;
      if (!flow) {
        return;
      }
      const savedViewport = viewportRef.current;
      if (savedViewport) {
        flow.setViewport(savedViewport, { duration: 0 });
      } else {
        flow.fitView({ padding: 0.2, duration: 0 });
      }
    });
  }, []);



  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflows],
  );

  const latestDraftVersion = useMemo(
    () => findLatestDraftVersion(versions),
    [versions],
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
      .listWorkflowWidgets(token)
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
                  : node.kind === "json_vector_store"
                    ? setVectorStoreNodeConfig(
                        {},
                        getVectorStoreNodeConfig(node.parameters),
                      )
                    : node.kind === "widget"
                      ? resolveWidgetNodeParameters(node.parameters)
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
          pendingViewportRestoreRef.current = true;
          restoreViewport();
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
    [authHeader, restoreViewport, setEdges, setHasPendingChanges, setNodes],
  );

  const loadVersions = useCallback(
    async (
      workflowId: number,
      preferredVersionId: number | null = null,
      options: { skipGraphReload?: boolean } = {},
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
          const normalizedVersions = sortVersionsWithDraftFirst(data);
          setVersions(normalizedVersions);
          if (normalizedVersions.length === 0) {
            setSelectedVersionId(null);
            setNodes([]);
            setEdges([]);
            isHydratingRef.current = true;
            lastSavedSnapshotRef.current = JSON.stringify(buildGraphPayloadFrom([], []));
            setHasPendingChanges(false);
            setLoading(false);
            viewportRef.current = null;
            pendingViewportRestoreRef.current = true;
            restoreViewport();
            return true;
          }
          const availableIds = new Set(normalizedVersions.map((version) => version.id));
          let nextVersionId: number | null = null;
          if (preferredVersionId && availableIds.has(preferredVersionId)) {
            nextVersionId = preferredVersionId;
          } else if (selectedVersionId && availableIds.has(selectedVersionId)) {
            nextVersionId = selectedVersionId;
          } else {
            const draft = findLatestDraftVersion(normalizedVersions);
            if (draft) {
              nextVersionId = draft.id;
            } else {
              const active = normalizedVersions.find((version) => version.is_active);
              nextVersionId = active?.id ?? normalizedVersions[0]?.id ?? null;
            }
          }
          setSelectedVersionId(nextVersionId);
          if (nextVersionId != null) {
            if (!options.skipGraphReload) {
              await loadVersionDetail(workflowId, nextVersionId);
            } else {
              setLoading(false);
            }
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
    [
      authHeader,
      loadVersionDetail,
      restoreViewport,
      selectedVersionId,
      setEdges,
      setHasPendingChanges,
      setNodes,
    ],
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
            viewportRef.current = null;
            pendingViewportRestoreRef.current = true;
            restoreViewport();
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
    [
      authHeader,
      loadVersions,
      restoreViewport,
      selectedWorkflowId,
      setEdges,
      setHasPendingChanges,
      setNodes,
    ],
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

  const handleClosePropertiesPanel = useCallback(() => {
    if (isMobileLayout) {
      setPropertiesPanelOpen(false);
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          propertiesPanelToggleRef.current?.focus();
        }, 0);
      } else {
        propertiesPanelToggleRef.current?.focus();
      }
      return;
    }
    handleClearSelection();
  }, [handleClearSelection, isMobileLayout]);

  const handleOpenPropertiesPanel = useCallback(() => {
    if (!selectedNode && !selectedEdge) {
      return;
    }
    setPropertiesPanelOpen(true);
  }, [selectedEdge, selectedNode]);

  const selectedElementKey = selectedNodeId ?? selectedEdgeId ?? null;

  useEffect(() => {
    if (selectedElementKey) {
      if (previousSelectedElementRef.current !== selectedElementKey) {
        setPropertiesPanelOpen(true);
      }
    } else {
      setPropertiesPanelOpen(false);
    }
    previousSelectedElementRef.current = selectedElementKey;
  }, [selectedElementKey]);

  useEffect(() => {
    if (!isMobileLayout) {
      if (selectedElementKey) {
        setPropertiesPanelOpen(true);
      }
    }
  }, [isMobileLayout, selectedElementKey]);

  useEffect(() => {
    if (!isMobileLayout || !isPropertiesPanelOpen) {
      return;
    }
    propertiesPanelCloseButtonRef.current?.focus();
  }, [isMobileLayout, isPropertiesPanelOpen]);

  useEffect(() => {
    if (!isMobileLayout || !isPropertiesPanelOpen) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClosePropertiesPanel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClosePropertiesPanel, isMobileLayout, isPropertiesPanelOpen]);

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

  const handleWidgetNodeSlugChange = useCallback(
    (nodeId: string, slug: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeSlug(data.parameters, slug);
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

  const handleWidgetNodeVariablesChange = useCallback(
    (nodeId: string, assignments: WidgetVariableAssignment[]) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "widget") {
          return data;
        }
        const nextParameters = setWidgetNodeVariables(data.parameters, assignments);
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

  const handleVectorStoreNodeConfigChange = useCallback(
    (nodeId: string, updates: Partial<VectorStoreNodeConfig>) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "json_vector_store") {
          return data;
        }
        const nextParameters = setVectorStoreNodeConfig(data.parameters, updates);
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

  const handleEndMessageChange = useCallback(
    (nodeId: string, value: string) => {
      updateNodeData(nodeId, (data) => {
        if (data.kind !== "end") {
          return data;
        }
        const nextParameters = setEndMessage(data.parameters, value);
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
      if (!nodeToRemove || nodeToRemove.data.kind === "start") {
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

  const handleAddVectorStoreNode = useCallback(() => {
    const slug = `json-vector-store-${Date.now()}`;
    const fallbackSlug = vectorStores[0]?.slug?.trim() ?? "";
    const parameters = createVectorStoreNodeParameters({ vector_store_slug: fallbackSlug });
    const newNode: FlowNode = {
      id: slug,
      position: { x: 420, y: 320 },
      data: {
        slug,
        kind: "json_vector_store",
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
      style: buildNodeStyle("json_vector_store"),
    };
    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(slug);
    setSelectedEdgeId(null);
  }, [setNodes, vectorStores]);

  const handleAddWidgetNode = useCallback(() => {
    const slug = `widget-${Date.now()}`;
    const parameters = createWidgetNodeParameters();
    const newNode: FlowNode = {
      id: slug,
      position: { x: 520, y: 200 },
      data: {
        slug,
        kind: "widget",
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
      style: buildNodeStyle("widget"),
    } satisfies FlowNode;
    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(slug);
    setSelectedEdgeId(null);
  }, [setNodes]);

  const handleAddEndNode = useCallback(() => {
    const slug = `end-${Date.now()}`;
    const parameters = setEndMessage({}, DEFAULT_END_MESSAGE);
    const newNode: FlowNode = {
      id: slug,
      position: { x: 640, y: 120 },
      data: {
        slug,
        kind: "end",
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
      style: buildNodeStyle("end"),
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

  const buildGraphPayload = useCallback(
    () => buildGraphPayloadFrom(nodes, edges),
    [edges, nodes],
  );

  const graphSnapshot = useMemo(() => JSON.stringify(buildGraphPayload()), [buildGraphPayload]);

  useEffect(() => {
    if (!selectedVersionSummary || !selectedVersionSummary.is_active) {
      return;
    }

    if (!latestDraftVersion) {
      return;
    }

    if (latestDraftVersion.id === selectedVersionId) {
      return;
    }

    if (lastSavedSnapshotRef.current === graphSnapshot) {
      return;
    }

    setSelectedVersionId(latestDraftVersion.id);
    setVersions((current) => {
      if (current.some((version) => version.id === latestDraftVersion.id)) {
        return sortVersionsWithDraftFirst(current);
      }
      return current;
    });
    setHasPendingChanges(true);
  }, [
    graphSnapshot,
    latestDraftVersion,
    selectedVersionId,
    selectedVersionSummary,
    setHasPendingChanges,
  ]);

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

    const pending = graphSnapshot !== lastSavedSnapshotRef.current;
    setHasPendingChanges(pending);
  }, [graphSnapshot, selectedWorkflowId]);

  const handleOpenDeployModal = useCallback(() => {
    setSaveMessage(null);
    setDeployToProduction(false);
    setDeployModalOpen(true);
  }, []);

  const handleCloseDeployModal = useCallback(() => {
    if (isDeploying) {
      return;
    }
    setDeployModalOpen(false);
  }, [isDeploying]);

  const handleConfirmDeploy = useCallback(async () => {
    if (!selectedWorkflowId) {
      return;
    }

    const graphPayload = buildGraphPayload();
    const graphSnapshot = JSON.stringify(graphPayload);
    const endpoint = `/api/workflows/${selectedWorkflowId}/versions`;
    const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
    let lastError: Error | null = null;
    setIsDeploying(true);
    setSaveState("saving");
    setSaveMessage("Création de la nouvelle version…");
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({
            graph: graphPayload,
            mark_as_active: deployToProduction,
          }),
        });
        if (!response.ok) {
          throw new Error(`Échec de la publication (${response.status})`);
        }
        const data: WorkflowVersionResponse = await response.json();

        if (selectedWorkflow?.is_chatkit_default) {
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
        await loadWorkflows({ selectWorkflowId: selectedWorkflowId, selectVersionId: data.id });
        lastSavedSnapshotRef.current = graphSnapshot;
        setHasPendingChanges(false);
        setSaveState("saved");
        setSaveMessage(
          deployToProduction
            ? "Version déployée en production."
            : "Nouvelle version publiée."
        );
        setTimeout(() => setSaveState("idle"), 1500);
        setDeployModalOpen(false);
        setIsDeploying(false);
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError =
          error instanceof Error ? error : new Error("Impossible de publier le workflow.");
      }
    }

    setIsDeploying(false);
    setSaveState("error");
    setSaveMessage(lastError?.message ?? "Impossible de publier le workflow.");
  }, [
    authHeader,
    buildGraphPayload,
    deployToProduction,
    loadVersions,
    loadWorkflows,
    selectedWorkflow,
    selectedWorkflowId,
  ]);

  useEffect(() => {
    if (!isDeployModalOpen) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleCloseDeployModal();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [handleCloseDeployModal, isDeployModalOpen]);

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
      const currentWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId);
      const draftVersion =
        selectedVersionSummary && !selectedVersionSummary.is_active
          ? selectedVersionSummary
          : latestDraftVersion ?? null;

      const endpoint = draftVersion
        ? `/api/workflows/${selectedWorkflowId}/versions/${draftVersion.id}`
        : `/api/workflows/${selectedWorkflowId}/versions`;
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
      setSaveState("saving");
      for (const url of candidates) {
        const response = await fetch(url, {
          method: draftVersion ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify(
            draftVersion
              ? { graph: graphPayload }
              : { graph: graphPayload, mark_as_active: false },
          ),
        });
        if (!response.ok) {
          throw new Error(`Échec de l'enregistrement (${response.status})`);
        }

        let savedVersionId = draftVersion?.id ?? null;
        let responseData: WorkflowVersionResponse | null = null;
        try {
          responseData = (await response.json()) as WorkflowVersionResponse;
        } catch (error) {
          responseData = null;
        }
        if (responseData?.id) {
          savedVersionId = responseData.id;
        } else if (!savedVersionId) {
          throw new Error("Réponse invalide du serveur lors de l'enregistrement.");
        }

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

        let savedVersionSummary: WorkflowVersionSummary | null = null;
        if (responseData) {
          savedVersionSummary = toVersionSummary(responseData);
        } else if (draftVersion) {
          savedVersionSummary = {
            ...draftVersion,
            updated_at: new Date().toISOString(),
          };
        }

        if (savedVersionSummary) {
          setVersions((current) => {
            const withoutSaved = current.filter(
              (version) => version.id !== savedVersionSummary.id,
            );
            return sortVersionsWithDraftFirst([...withoutSaved, savedVersionSummary]);
          });
          setSelectedVersionId(savedVersionSummary.id);
        }

        if (savedVersionId != null) {
          await loadVersions(selectedWorkflowId, savedVersionId, { skipGraphReload: true });
        } else {
          await loadVersions(selectedWorkflowId, null, { skipGraphReload: true });
        }
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
    latestDraftVersion,
    loadVersions,
    selectedVersionSummary,
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
      if (!node.data.isEnabled) {
        return false;
      }

      if (node.data.kind === "agent") {
        const fileSearchConfig = getAgentFileSearchConfig(node.data.parameters);
        if (fileSearchConfig) {
          const slug = fileSearchConfig.vector_store_slug?.trim() ?? "";
          if (!slug) {
            return true;
          }

          if (
            !vectorStoresError &&
            vectorStores.length > 0 &&
            !availableVectorStoreSlugs.has(slug)
          ) {
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
      }

      if (node.data.kind === "json_vector_store") {
        const config = getVectorStoreNodeConfig(node.data.parameters);
        const slug = config.vector_store_slug.trim();
        if (!slug) {
          return true;
        }
        if (!vectorStoresError && vectorStores.length > 0 && !availableVectorStoreSlugs.has(slug)) {
          return true;
        }
        return false;
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
      {
        key: "json-vector-store",
        label: "Stockage JSON",
        shortLabel: "VS",
        color: NODE_COLORS.json_vector_store,
        onClick: handleAddVectorStoreNode,
      },
      {
        key: "widget",
        label: "Bloc widget",
        shortLabel: "W",
        color: NODE_COLORS.widget,
        onClick: handleAddWidgetNode,
      },
      {
        key: "end",
        label: "Fin",
        shortLabel: "F",
        color: NODE_COLORS.end,
        onClick: handleAddEndNode,
      },
    ],
    [
      handleAddAgentNode,
      handleAddConditionNode,
      handleAddStateNode,
      handleAddVectorStoreNode,
      handleAddWidgetNode,
      handleAddEndNode,
    ],
  );

  const getBlockLibraryButtonStyle = (disabled: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.5rem 0",
    border: "none",
    background: "transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    width: "100%",
    textAlign: "left",
  });

  const renderBlockLibraryButtons = () => {
    const primaryTextColor = isMobileLayout ? "#f8fafc" : "#0f172a";
    const secondaryTextColor = isMobileLayout ? "rgba(248, 250, 252, 0.8)" : "#475569";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {blockLibraryItems.map((item) => {
          const disabled = loading || !selectedWorkflowId;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => item.onClick()}
              disabled={disabled}
            style={getBlockLibraryButtonStyle(disabled)}
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
                fontSize: "1.05rem",
              }}
            >
              {item.shortLabel}
            </span>
            <div style={{ textAlign: "left", color: primaryTextColor }}>
              <strong style={{ fontSize: "1rem" }}>{item.label}</strong>
            </div>
            </button>
          );
        })}
      </div>
    );
  };

  const hasSelectedElement = Boolean(selectedNode || selectedEdge);
  const showPropertiesPanel = hasSelectedElement && (!isMobileLayout || isPropertiesPanelOpen);
  const selectedElementLabel = selectedNode
    ? selectedNode.data.displayName.trim() || labelForKind(selectedNode.data.kind)
    : selectedEdge
      ? `${selectedEdge.source} → ${selectedEdge.target}`
      : "";
  const propertiesPanelElement = (
    <aside
      id={propertiesPanelId}
      aria-label="Propriétés du bloc sélectionné"
      aria-labelledby={propertiesPanelTitleId}
      className={isMobileLayout ? styles.propertiesPanelMobile : styles.propertiesPanel}
      role={isMobileLayout ? "dialog" : undefined}
      aria-modal={isMobileLayout ? true : undefined}
      onClick={isMobileLayout ? (event) => event.stopPropagation() : undefined}
    >
      <header className={styles.propertiesPanelHeader}>
        <div className={styles.propertiesPanelHeaderMeta}>
          <p className={styles.propertiesPanelOverline}>Propriétés du bloc</p>
          <h2 id={propertiesPanelTitleId} className={styles.propertiesPanelTitle}>
            {selectedElementLabel || "Bloc"}
          </h2>
        </div>
        <button
          type="button"
          ref={propertiesPanelCloseButtonRef}
          onClick={handleClosePropertiesPanel}
          aria-label="Fermer le panneau de propriétés"
          className={styles.propertiesPanelCloseButton}
        >
          ×
        </button>
      </header>
      <div className={styles.propertiesPanelBody}>
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
            onWidgetNodeSlugChange={handleWidgetNodeSlugChange}
            onWidgetNodeVariablesChange={handleWidgetNodeVariablesChange}
            onAgentIncludeChatHistoryChange={handleAgentIncludeChatHistoryChange}
            onAgentDisplayResponseInChatChange={handleAgentDisplayResponseInChatChange}
            onAgentShowSearchSourcesChange={handleAgentShowSearchSourcesChange}
            onAgentContinueOnErrorChange={handleAgentContinueOnErrorChange}
            onAgentStorePreferenceChange={handleAgentStorePreferenceChange}
            onAgentWebSearchChange={handleAgentWebSearchChange}
            onAgentFileSearchChange={handleAgentFileSearchChange}
            onVectorStoreNodeConfigChange={handleVectorStoreNodeConfigChange}
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
            onEndMessageChange={handleEndMessageChange}
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
  );
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

  useEffect(() => {
    viewportRef.current = null;
    pendingViewportRestoreRef.current = true;
  }, [selectedWorkflowId]);

  const headerStyle = useMemo(() => {
    const baseStyle = getHeaderContainerStyle(isMobileLayout);
    if (isMobileLayout) {
      return { ...baseStyle, position: "absolute", top: 0, left: 0, right: 0 };
    }
    return baseStyle;
  }, [isMobileLayout]);

  const workspaceWrapperStyle = useMemo<CSSProperties>(() => {
    if (isMobileLayout) {
      return { position: "absolute", inset: 0, overflow: "hidden" };
    }
    return { position: "relative", flex: 1, overflow: "hidden" };
  }, [isMobileLayout]);

  return (
    <ReactFlowProvider>
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          background: isMobileLayout ? "transparent" : "#f1f5f9",
          overflow: "hidden",
        }}
      >
        <header style={headerStyle}>
          <button
            type="button"
            onClick={openSidebar}
            aria-label="Ouvrir la navigation générale"
            style={getHeaderNavigationButtonStyle(isMobileLayout)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          {isMobileLayout ? (
            <button
              type="button"
              ref={mobileHeaderMenuButtonRef}
              onPointerDown={handleMobileHeaderMenuButtonPointerDown}
              onTouchStart={handleMobileHeaderMenuButtonTouchStart}
              onClick={handleMobileHeaderMenuButtonClick}
              aria-haspopup="dialog"
              aria-controls={headerMenuId}
              aria-expanded={isMobileHeaderMenuOpen}
              style={getMobileHeaderMenuButtonStyle({ active: isMobileHeaderMenuOpen })}
            >
              <span>Workflow</span>
              <span aria-hidden="true" style={mobileHeaderMenuIconStyle}>
                {isMobileHeaderMenuOpen ? "▴" : "▾"}
              </span>
            </button>
          ) : (
            renderHeaderControls()
          )}
        </header>

        {isMobileLayout && isMobileHeaderMenuOpen ? (
          <div
            className={styles.mobileHeaderOverlay}
            role="presentation"
            onClick={() => closeMobileHeaderMenu({ focusToggle: true })}
          >
            <div
              id={headerMenuId}
              role="dialog"
              aria-modal="true"
              aria-labelledby={headerMenuTitleId}
              className={styles.mobileHeaderModal}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.mobileHeaderModalHeader}>
                <h2 id={headerMenuTitleId} className={styles.mobileHeaderModalTitle}>
                  Paramètres du workflow
                </h2>
                <button
                  type="button"
                  onClick={() => closeMobileHeaderMenu({ focusToggle: true })}
                  aria-label="Fermer le menu du workflow"
                  className={styles.mobileHeaderModalClose}
                >
                  ×
                </button>
              </div>
              <div className={styles.mobileHeaderModalContent}>
                {renderWorkflowDescription(styles.mobileHeaderModalInfo)}
                {renderWorkflowPublicationReminder(styles.mobileHeaderModalInfoWarning)}
                {renderHeaderControls()}
              </div>
            </div>
          </div>
        ) : null}

        <div style={workspaceWrapperStyle}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              padding: isMobileLayout ? "0" : "1.5rem",
              display: "flex",
              flexDirection: "column",
              gap: isMobileLayout ? "0" : "1rem",
            }}
          >
            {!isMobileLayout ? renderWorkflowDescription() : null}
            {!isMobileLayout ? renderWorkflowPublicationReminder() : null}
            <div
              style={{
                flex: 1,
                borderRadius: isMobileLayout ? 0 : "1.25rem",
                border: isMobileLayout ? "none" : "1px solid rgba(15, 23, 42, 0.08)",
                background: "#fff",
                overflow: "hidden",
                boxShadow: isMobileLayout ? "none" : "0 20px 40px rgba(15, 23, 42, 0.06)",
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
                  style={{ background: isMobileLayout ? "transparent" : "#f8fafc", height: "100%" }}
                  onInit={(instance) => {
                    reactFlowInstanceRef.current = instance;
                    if (pendingViewportRestoreRef.current) {
                      restoreViewport();
                    }
                  }}
                  onMoveEnd={(_, viewport) => {
                    viewportRef.current = viewport;
                  }}
                >
                  <Background gap={18} size={1} />
                  {!isMobileLayout ? (
                    <MiniMap
                      nodeStrokeColor={(node) => NODE_COLORS[(node.data as FlowNodeData).kind]}
                      nodeColor={(node) => NODE_COLORS[(node.data as FlowNodeData).kind]}
                    />
                  ) : null}
                  <Controls />
                </ReactFlow>
              )}
            </div>
          </div>
          {isMobileLayout ? (
            <>
              {isBlockLibraryOpen ? (
                <div
                  className={styles.mobileOverlay}
                  role="presentation"
                  onClick={(event) => {
                    if (event.target === event.currentTarget) {
                      closeBlockLibrary({ focusToggle: true });
                    }
                  }}
                >
                  <aside
                    id={blockLibraryId}
                    aria-label="Bibliothèque de blocs"
                    className={`${styles.blockLibrary} ${styles.blockLibraryMobile}`}
                    role="dialog"
                    aria-modal="true"
                  >
                    {renderBlockLibraryButtons()}
                  </aside>
                </div>
              ) : null}
              <button
                type="button"
                ref={blockLibraryToggleRef}
                className={styles.mobileToggleButton}
                onClick={toggleBlockLibrary}
                aria-controls={blockLibraryId}
                aria-expanded={isBlockLibraryOpen}
              >
                <span aria-hidden="true">{isBlockLibraryOpen ? "×" : "+"}</span>
                <span className={styles.srOnly}>
                  {isBlockLibraryOpen ? "Fermer la bibliothèque de blocs" : "Ouvrir la bibliothèque de blocs"}
                </span>
              </button>
            </>
          ) : (
            <aside
              id={blockLibraryId}
              aria-label="Bibliothèque de blocs"
              className={styles.blockLibrary}
            >
              {renderBlockLibraryButtons()}
            </aside>
          )}
          {isMobileLayout && hasSelectedElement ? (
            <button
              type="button"
              ref={propertiesPanelToggleRef}
              className={styles.propertiesToggleButton}
              onClick={isPropertiesPanelOpen ? handleClosePropertiesPanel : handleOpenPropertiesPanel}
              aria-controls={propertiesPanelId}
              aria-expanded={isPropertiesPanelOpen}
            >
              {isPropertiesPanelOpen ? "Masquer les propriétés" : "Propriétés du bloc"}
            </button>
          ) : null}
          {showPropertiesPanel ? (
            isMobileLayout ? (
              <div
                className={styles.propertiesPanelOverlay}
                role="presentation"
                onClick={handleClosePropertiesPanel}
              >
                {propertiesPanelElement}
              </div>
            ) : (
              propertiesPanelElement
            )
          ) : null}
        </div>
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
          {isDeployModalOpen ? (
            <div
              role="presentation"
              onClick={handleCloseDeployModal}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1.5rem",
                zIndex: 30,
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="deploy-dialog-title"
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: "100%",
                  maxWidth: "460px",
                  background: "#fff",
                  borderRadius: "1rem",
                  boxShadow: "0 30px 70px rgba(15, 23, 42, 0.25)",
                  padding: "1.75rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1.25rem",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <h2
                    id="deploy-dialog-title"
                    style={{ fontSize: "1.35rem", fontWeight: 700, color: "#0f172a", margin: 0 }}
                  >
                    Publish changes?
                  </h2>
                  <p style={{ margin: 0, color: "#475569", lineHeight: 1.45 }}>
                    Create a new version of the workflow with your latest changes.
                  </p>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontWeight: 600,
                      color: "#0f172a",
                    }}
                  >
                    <span style={{ padding: "0.25rem 0.5rem", background: "#e2e8f0", borderRadius: "999px" }}>
                      Draft
                    </span>
                    <span aria-hidden="true">→</span>
                    <span style={{ padding: "0.25rem 0.5rem", background: "#dcfce7", borderRadius: "999px" }}>
                      New version
                    </span>
                  </div>
                </div>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    fontWeight: 600,
                    color: "#0f172a",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={deployToProduction}
                    onChange={(event) => setDeployToProduction(event.target.checked)}
                    disabled={isDeploying}
                    style={{ width: "1.2rem", height: "1.2rem" }}
                  />
                  Deploy to production
                </label>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
                  <button
                    type="button"
                    onClick={handleCloseDeployModal}
                    disabled={isDeploying}
                    style={{
                      padding: "0.6rem 1.2rem",
                      borderRadius: "0.75rem",
                      border: "1px solid rgba(15, 23, 42, 0.15)",
                      background: "#fff",
                      color: "#0f172a",
                      fontWeight: 600,
                      cursor: isDeploying ? "not-allowed" : "pointer",
                      opacity: isDeploying ? 0.5 : 1,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDeploy}
                    disabled={isDeploying}
                    style={{
                      padding: "0.6rem 1.2rem",
                      borderRadius: "0.75rem",
                      border: "none",
                      background: "#2563eb",
                      color: "#fff",
                      fontWeight: 700,
                      cursor: isDeploying ? "not-allowed" : "pointer",
                      opacity: isDeploying ? 0.7 : 1,
                    }}
                  >
                    Publish
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </ReactFlowProvider>
  );
};

export default WorkflowBuilderPage;
