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
  const [useWebSocket, setUseWebSocket] = useState(false); // Toggle WebSocket/Polling
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
      // Nettoyer le polling si on utilise WebSocket
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }

    // Fetch initial
    void fetchActiveSessions();

    // Setup polling
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

  const handleViewWorkflow = useCallback((session: ActiveWorkflowSession) => {
    setSelectedWorkflow(session.workflow);
    // Récupérer toutes les sessions pour ce workflow
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

  // Détecter les sessions bloquées (> 1h sans activité)
  const isStuckSession = (session: ActiveWorkflowSession) => {
    const lastActivity = new Date(session.last_activity);
    const diffMs = new Date().getTime() - lastActivity.getTime();
    return diffMs > 3600000; // 1 heure
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
          <button
            className="btn btn-sm btn-subtle"
            type="button"
            onClick={() => handleViewWorkflow(session)}
          >
            Voir workflow
          </button>
        ),
      },
    ],
    [handleViewWorkflow],
  );

  const stuckSessionsCount = sessions.filter(isStuckSession).length;
  const displayError = error || wsError;

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
              {/* Indicateur de connexion WebSocket */}
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

              {/* Indicateur de dernière mise à jour */}
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

              {/* Toggle WebSocket */}
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

              {/* Toggle auto-refresh */}
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

              {/* Bouton refresh manuel */}
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
          ) : sessions.length === 0 ? (
            <p className="admin-card__subtitle">
              Aucune session de workflow active pour le moment.
            </p>
          ) : (
            <div>
              <div className="admin-card__subtitle mb-4" style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                <span>
                  {sessions.length} session{sessions.length > 1 ? "s" : ""} active{sessions.length > 1 ? "s" : ""}
                </span>
                {stuckSessionsCount > 0 && (
                  <span style={{ color: "#f59e0b" }}>
                    ⚠️ {stuckSessionsCount} session{stuckSessionsCount > 1 ? "s" : ""} inactive{stuckSessionsCount > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <ResponsiveTable
                columns={sessionColumns}
                data={sessions}
                keyExtractor={(session) => session.thread_id}
                mobileCardView={true}
              />
            </div>
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
