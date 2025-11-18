import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useAuth } from "../auth";
import { adminApi, isUnauthorizedError } from "../utils/backend";
import {
  ResponsiveTable,
  type Column,
  LoadingSpinner,
  FeedbackMessages,
  FormSection,
} from "../components";
import { WorkflowVisualizationModal } from "../components/admin/WorkflowVisualizationModal";
import { ActionsMenu } from "../components/admin/ActionsMenu";
import { useWorkflowMonitorWebSocket } from "../hooks/useWorkflowMonitorWebSocket";

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

interface ActiveWorkflowSessionsResponse {
  sessions: ActiveWorkflowSession[];
  total_count: number;
}

const AUTO_REFRESH_INTERVAL = 30000; // 30 secondes

export const AdminWorkflowMonitorPage = () => {
  const { token, logout } = useAuth();
  const [sessions, setSessions] = useState<ActiveWorkflowSession[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowInfo | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<ActiveWorkflowSession[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [useWebSocket, setUseWebSocket] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Filtres
  const [filterWorkflowId, setFilterWorkflowId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // WebSocket connection
  const {
    sessions: wsSessions,
    isConnected: wsConnected,
    error: wsError,
    reconnect: wsReconnect,
  } = useWorkflowMonitorWebSocket({
    token,
    enabled: useWebSocket && autoRefresh,
    onUpdate: (newSessions) => {
      setSessions(newSessions);
      setLastUpdated(new Date());
    },
    onError: (err) => {
      setError(err);
    },
  });

  // Utiliser les sessions du WebSocket si connecté
  useEffect(() => {
    if (useWebSocket && wsConnected && wsSessions.length > 0) {
      setSessions(wsSessions);
      setLoading(false);
    }
  }, [useWebSocket, wsConnected, wsSessions]);

  const fetchActiveSessions = useCallback(async (isBackgroundRefresh = false) => {
    if (!token) {
      return;
    }

    if (!isBackgroundRefresh) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }

    setError(null);

    try {
      const data = await adminApi.getActiveWorkflowSessions(token);
      setSessions(data.sessions);
      setLastUpdated(new Date());
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur inattendue est survenue",
      );
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [logout, token]);

  // Auto-refresh avec polling (uniquement si WebSocket désactivé)
  useEffect(() => {
    if (useWebSocket) {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }

    void fetchActiveSessions();

    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(() => {
        void fetchActiveSessions(true);
      }, AUTO_REFRESH_INTERVAL);
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [fetchActiveSessions, autoRefresh, useWebSocket]);

  // Filtrer les sessions
  const filteredSessions = useMemo(() => {
    let result = [...sessions];

    // Filtre par workflow
    if (filterWorkflowId !== null) {
      result = result.filter((s) => s.workflow.id === filterWorkflowId);
    }

    // Filtre par statut
    if (filterStatus !== null) {
      result = result.filter((s) => s.status === filterStatus);
    }

    // Recherche par email
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter((s) =>
        s.user.email.toLowerCase().includes(term)
      );
    }

    return result;
  }, [sessions, filterWorkflowId, filterStatus, searchTerm]);

  // Liste unique des workflows
  const uniqueWorkflows = useMemo(() => {
    const workflowMap = new Map<number, WorkflowInfo>();
    sessions.forEach((session) => {
      if (!workflowMap.has(session.workflow.id)) {
        workflowMap.set(session.workflow.id, session.workflow);
      }
    });
    return Array.from(workflowMap.values()).sort((a, b) =>
      a.display_name.localeCompare(b.display_name)
    );
  }, [sessions]);

  const handleViewWorkflow = useCallback((session: ActiveWorkflowSession) => {
    setSelectedWorkflow(session.workflow);
    setSessions((currentSessions) => {
      const filtered = currentSessions.filter(
        (s) => s.workflow.id === session.workflow.id
      );
      setSelectedSessions(filtered);
      return currentSessions;
    });
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedWorkflow(null);
    setSelectedSessions([]);
  }, []);

  const toggleAutoRefresh = useCallback(() => {
    setAutoRefresh((prev) => !prev);
  }, []);

  const toggleWebSocket = useCallback(() => {
    setUseWebSocket((prev) => !prev);
  }, []);

  const handleManualRefresh = useCallback(() => {
    if (useWebSocket) {
      wsReconnect();
    } else {
      void fetchActiveSessions(false);
    }
  }, [useWebSocket, wsReconnect, fetchActiveSessions]);

  const clearFilters = useCallback(() => {
    setFilterWorkflowId(null);
    setFilterStatus(null);
    setSearchTerm("");
  }, []);

  const handleViewThread = useCallback((threadId: string) => {
    // Ouvrir le thread dans un nouvel onglet
    window.open(`/chat/${threadId}`, "_blank");
  }, []);

  const handleCopyThreadId = useCallback((threadId: string) => {
    navigator.clipboard.writeText(threadId).then(() => {
      // Afficher une notification de succès (optionnel)
      console.log("Thread ID copié:", threadId);
    }).catch((err) => {
      console.error("Erreur lors de la copie:", err);
    });
  }, []);

  const handleViewSessionDetails = useCallback((session: ActiveWorkflowSession) => {
    // Créer une chaîne formatée avec les détails
    const details = `
Thread ID: ${session.thread_id}
Utilisateur: ${session.user.email}
Workflow: ${session.workflow.display_name}
Étape actuelle: ${session.current_step.display_name}
Progression: ${session.step_history.length} étapes complétées
Démarré: ${formatDateTime(session.started_at)}
Dernière activité: ${formatDateTime(session.last_activity)}
Statut: ${session.status}

Historique:
${session.step_history.map((step, i) => `${i + 1}. ${step.display_name}`).join("\n")}
    `.trim();

    // Afficher dans la console pour le moment (pourrait être un modal plus tard)
    console.log("Détails de la session:", details);
    alert(details);
  }, []);

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  };

  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 60) {
      return `Il y a ${diffSecs}s`;
    }
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) {
      return `Il y a ${diffMins} min`;
    }
    const diffHours = Math.floor(diffMins / 60);
    return `Il y a ${diffHours}h`;
  };

  const formatDuration = (startDate: string) => {
    const start = new Date(startDate);
    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) {
      return `${diffMins} min`;
    }
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return `${diffHours}h ${diffMins % 60}min`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}j ${diffHours % 24}h`;
  };

  const isStuckSession = (session: ActiveWorkflowSession) => {
    const lastActivity = new Date(session.last_activity);
    const diffMs = new Date().getTime() - lastActivity.getTime();
    return diffMs > 3600000;
  };

  const sessionColumns = useMemo<Column<ActiveWorkflowSession>[]>(
    () => [
      {
        key: "user",
        label: "Utilisateur",
        render: (session) => (
          <div>
            <div className="font-medium">{session.user.email}</div>
            {session.user.is_admin && (
              <span className="text-xs text-muted">Admin</span>
            )}
          </div>
        ),
      },
      {
        key: "workflow",
        label: "Workflow",
        render: (session) => (
          <div>
            <div className="font-medium">{session.workflow.display_name}</div>
            <div className="text-xs text-muted">{session.workflow.slug}</div>
          </div>
        ),
      },
      {
        key: "current_step",
        label: "Étape actuelle",
        render: (session) => (
          <div>
            <div className="font-medium">{session.current_step.display_name}</div>
            <div className="text-xs text-muted">{session.current_step.slug}</div>
          </div>
        ),
      },
      {
        key: "progress",
        label: "Progression",
        render: (session) => `${session.step_history.length} étapes`,
      },
      {
        key: "duration",
        label: "Durée",
        render: (session) => formatDuration(session.started_at),
      },
      {
        key: "last_activity",
        label: "Dernière activité",
        render: (session) => (
          <div>
            <div>{formatDateTime(session.last_activity)}</div>
            {isStuckSession(session) && (
              <span className="text-xs" style={{ color: "#f59e0b" }}>
                ⚠️ Inactive
              </span>
            )}
          </div>
        ),
      },
      {
        key: "status",
        label: "Statut",
        render: (session) => {
          const statusLabels = {
            active: "Actif",
            waiting_user: "En attente",
            paused: "En pause",
          };
          return (
            <span className={`status-badge status-${session.status}`}>
              {statusLabels[session.status]}
            </span>
          );
        },
      },
      {
        key: "actions",
        label: "Actions",
        render: (session) => (
          <ActionsMenu
            actions={[
              {
                label: "Voir le workflow",
                icon: "📊",
                onClick: () => handleViewWorkflow(session),
              },
              {
                label: "Voir la conversation",
                icon: "💬",
                onClick: () => handleViewThread(session.thread_id),
              },
              {
                label: "Copier le thread ID",
                icon: "📋",
                onClick: () => handleCopyThreadId(session.thread_id),
              },
              {
                label: "Afficher les détails",
                icon: "ℹ️",
                onClick: () => handleViewSessionDetails(session),
              },
            ]}
          />
        ),
      },
    ],
    [handleViewWorkflow, handleViewThread, handleCopyThreadId, handleViewSessionDetails],
  );

  const stuckSessionsCount = filteredSessions.filter(isStuckSession).length;
  const displayError = error || wsError;
  const hasActiveFilters = filterWorkflowId !== null || filterStatus !== null || searchTerm.trim() !== "";

  return (
    <>
      <FeedbackMessages
        error={displayError}
        onDismissError={() => {
          setError(null);
        }}
      />

      <div className="admin-grid">
        <FormSection
          title="Workflows en cours"
          subtitle="Visualisez tous les workflows actifs et la position de chaque utilisateur."
          headerAction={
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {useWebSocket && (
                <div
                  style={{
                    fontSize: "11px",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    background: wsConnected ? "#10b981" : "#ef4444",
                    color: "white",
                    fontWeight: 500,
                  }}
                  title={wsConnected ? "WebSocket connecté" : "WebSocket déconnecté"}
                >
                  {wsConnected ? "● Live" : "○ Offline"}
                </div>
              )}

              {lastUpdated && (
                <div style={{ fontSize: "12px", color: "#6b7280", marginRight: "8px" }}>
                  {isRefreshing ? (
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span className="spinner-small" />
                      Actualisation...
                    </span>
                  ) : (
                    <span title={formatDateTime(lastUpdated.toISOString())}>
                      {formatRelativeTime(lastUpdated)}
                    </span>
                  )}
                </div>
              )}

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  userSelect: "none",
                }}
                title={useWebSocket ? "Utilise WebSocket temps réel" : "Utilise le polling"}
              >
                <input
                  type="checkbox"
                  checked={useWebSocket}
                  onChange={toggleWebSocket}
                  style={{ cursor: "pointer" }}
                />
                WebSocket
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  userSelect: "none",
                }}
                title={autoRefresh ? "Désactiver l'actualisation automatique" : "Activer l'actualisation automatique"}
              >
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={toggleAutoRefresh}
                  style={{ cursor: "pointer" }}
                />
                Auto
              </label>

              <button
                type="button"
                className="management-header__icon-button"
                aria-label="Actualiser"
                title="Actualiser maintenant"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                  style={{
                    animation: isRefreshing ? "spin 1s linear infinite" : undefined,
                  }}
                >
                  <path
                    d="M4 10a6 6 0 1112 0M10 4v6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M7 7l3-3 3 3"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          }
        >
          {isLoading ? (
            <LoadingSpinner text="Chargement des sessions actives…" />
          ) : (
            <>
              {/* Filtres */}
              <div style={{
                marginBottom: "16px",
                padding: "12px",
                background: "#f9fafb",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
              }}>
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                  {/* Filtre par workflow */}
                  <div style={{ flex: "1 1 200px", minWidth: "200px" }}>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 500, marginBottom: "4px" }}>
                      Workflow
                    </label>
                    <select
                      className="input"
                      value={filterWorkflowId || ""}
                      onChange={(e) => setFilterWorkflowId(e.target.value ? Number(e.target.value) : null)}
                      style={{ width: "100%", fontSize: "14px" }}
                    >
                      <option value="">Tous les workflows</option>
                      {uniqueWorkflows.map((wf) => (
                        <option key={wf.id} value={wf.id}>
                          {wf.display_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Filtre par statut */}
                  <div style={{ flex: "1 1 150px", minWidth: "150px" }}>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 500, marginBottom: "4px" }}>
                      Statut
                    </label>
                    <select
                      className="input"
                      value={filterStatus || ""}
                      onChange={(e) => setFilterStatus(e.target.value || null)}
                      style={{ width: "100%", fontSize: "14px" }}
                    >
                      <option value="">Tous les statuts</option>
                      <option value="active">Actif</option>
                      <option value="waiting_user">En attente</option>
                      <option value="paused">En pause</option>
                    </select>
                  </div>

                  {/* Recherche par email */}
                  <div style={{ flex: "2 1 250px", minWidth: "250px" }}>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 500, marginBottom: "4px" }}>
                      Recherche utilisateur
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Rechercher par email..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ width: "100%", fontSize: "14px" }}
                    />
                  </div>

                  {/* Bouton réinitialiser */}
                  {hasActiveFilters && (
                    <div style={{ display: "flex", alignItems: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={clearFilters}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        ✕ Réinitialiser
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {sessions.length === 0 ? (
                <p className="admin-card__subtitle">
                  Aucune session de workflow active pour le moment.
                </p>
              ) : (
                <div>
                  <div className="admin-card__subtitle mb-4" style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                    <span>
                      {filteredSessions.length} session{filteredSessions.length > 1 ? "s" : ""} active{filteredSessions.length > 1 ? "s" : ""}
                      {hasActiveFilters && ` (sur ${sessions.length} total)`}
                    </span>
                    {stuckSessionsCount > 0 && (
                      <span style={{ color: "#f59e0b" }}>
                        ⚠️ {stuckSessionsCount} session{stuckSessionsCount > 1 ? "s" : ""} inactive{stuckSessionsCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {filteredSessions.length === 0 ? (
                    <p className="admin-card__subtitle">
                      Aucune session ne correspond aux filtres sélectionnés.
                    </p>
                  ) : (
                    <ResponsiveTable
                      columns={sessionColumns}
                      data={filteredSessions}
                      keyExtractor={(session) => session.thread_id}
                      mobileCardView={true}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </FormSection>
      </div>

      {selectedWorkflow && (
        <WorkflowVisualizationModal
          workflow={selectedWorkflow}
          sessions={selectedSessions}
          onClose={handleCloseModal}
        />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .spinner-small {
          display: inline-block;
          width: 12px;
          height: 12px;
          border: 2px solid #e5e7eb;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
      `}</style>
    </>
  );
};
