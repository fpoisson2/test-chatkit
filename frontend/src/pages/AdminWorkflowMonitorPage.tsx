import { useCallback, useEffect, useMemo, useState } from "react";
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
import { ConfirmDialog } from "../components/admin/ConfirmDialog";
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
  current_branch_id?: string | null;
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

export const AdminWorkflowMonitorPage = () => {
  const { token, logout } = useAuth();
  const [sessions, setSessions] = useState<ActiveWorkflowSession[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowInfo | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<ActiveWorkflowSession[]>([]);

  // Filtres
  const [filterWorkflowId, setFilterWorkflowId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [lookbackHours, setLookbackHours] = useState<number | null>(null);

  // Confirmations pour actions destructives
  const [confirmAction, setConfirmAction] = useState<{
    type: "terminate" | "reset";
    session: ActiveWorkflowSession;
  } | null>(null);

  // Callbacks stables pour le WebSocket
  const handleWebSocketUpdate = useCallback((newSessions: ActiveWorkflowSession[]) => {
    setSessions(newSessions);
    setLoading(false);
  }, []);

  const handleWebSocketError = useCallback((err: string) => {
    setError(err);
  }, []);

  // WebSocket connection - always enabled
  const {
    sessions: wsSessions,
    isConnected: wsConnected,
    error: wsError,
  } = useWorkflowMonitorWebSocket({
    token,
    enabled: true,
    lookbackHours,
    onUpdate: handleWebSocketUpdate,
    onError: handleWebSocketError,
  });

  // Update sessions from WebSocket
  useEffect(() => {
    if (!wsConnected) {
      return;
    }

    setSessions(wsSessions);
    setLoading(false);
    // Clear any previous WebSocket errors when connection is established
    setError(null);
  }, [wsConnected, wsSessions]);

  useEffect(() => {
    if (wsError) {
      setLoading(false);
    }
  }, [wsError]);

  // Tri
  const [sortConfig, setSortConfig] = useState<{
    key: keyof ActiveWorkflowSession | "user_email" | "workflow_name";
    direction: "asc" | "desc";
  }>({ key: "last_activity", direction: "desc" });

  const handleSort = useCallback((key: keyof ActiveWorkflowSession | "user_email" | "workflow_name") => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  // Filtrer et trier les sessions
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

    // Tri
    result.sort((a, b) => {
      let aValue: any = a[sortConfig.key as keyof ActiveWorkflowSession];
      let bValue: any = b[sortConfig.key as keyof ActiveWorkflowSession];

      // Cas spéciaux pour les champs imbriqués
      if (sortConfig.key === "user_email") {
        aValue = a.user.email;
        bValue = b.user.email;
      } else if (sortConfig.key === "workflow_name") {
        aValue = a.workflow.display_name;
        bValue = b.workflow.display_name;
      }

      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [sessions, filterWorkflowId, filterStatus, searchTerm, sortConfig]);

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

  const clearFilters = useCallback(() => {
    setFilterWorkflowId(null);
    setFilterStatus(null);
    setSearchTerm("");
    setLookbackHours(null);
  }, []);

  const handleViewThread = useCallback((threadId: string) => {
    // Ouvrir le thread dans un nouvel onglet
    window.open(`/c/${threadId}`, "_blank");
  }, []);

  const handleCopyThreadId = useCallback((threadId: string) => {
    navigator.clipboard.writeText(threadId).catch(() => {
      // Copy failed
    });
  }, []);

  const handleViewSessionDetails = useCallback((session: ActiveWorkflowSession) => {
    // Créer une chaîne formatée avec les détails
    const details = `
Thread ID: ${session.thread_id}
Utilisateur: ${session.user.email}
Workflow: ${session.workflow.display_name}
Branche: ${session.current_branch_id && session.current_branch_id !== "main" ? session.current_branch_id : "Principale"}
Étape actuelle: ${session.current_step.display_name}
Progression: ${session.step_history.length} étapes complétées
Démarré: ${formatDateTime(session.started_at)}
Dernière activité: ${formatDateTime(session.last_activity)}
Statut: ${session.status}

Historique:
${session.step_history.map((step, i) => `${i + 1}. ${step.display_name}`).join("\n")}
    `.trim();

    alert(details);
  }, []);

  const handleTerminateSession = useCallback(async () => {
    if (!confirmAction || confirmAction.type !== "terminate" || !token) {
      return;
    }

    try {
      await adminApi.terminateWorkflowSession(token, confirmAction.session.thread_id);
      // WebSocket will automatically receive updates
      setConfirmAction(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erreur lors de la terminaison de la session"
      );
      setConfirmAction(null);
    }
  }, [confirmAction, token]);

  const handleResetSession = useCallback(async () => {
    if (!confirmAction || confirmAction.type !== "reset" || !token) {
      return;
    }

    try {
      await adminApi.resetWorkflowSession(token, confirmAction.session.thread_id);
      // WebSocket will automatically receive updates
      setConfirmAction(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erreur lors de la réinitialisation de la session"
      );
      setConfirmAction(null);
    }
  }, [confirmAction, token]);

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
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

  const renderSortIcon = (key: string) => {
    if (sortConfig.key !== key) return <span style={{ opacity: 0.3 }}>↕</span>;
    return sortConfig.direction === "asc" ? "↑" : "↓";
  };

  const sessionColumns = useMemo<Column<ActiveWorkflowSession>[]>(
    () => [
      {
        key: "user",
        label: (
          <div 
            onClick={() => handleSort("user_email")} 
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
          >
            Utilisateur {renderSortIcon("user_email")}
          </div>
        ),
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
        label: (
          <div 
            onClick={() => handleSort("workflow_name")} 
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
          >
            Workflow {renderSortIcon("workflow_name")}
          </div>
        ),
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
        key: "branch",
        label: "Branche",
        render: (session) => {
          if (!session.current_branch_id || session.current_branch_id === "main") {
            return <span className="text-xs text-muted">Principale</span>;
          }
          return <span className="font-medium">{`Branche ${session.current_branch_id}`}</span>;
        },
      },
      {
        key: "progress",
        label: "Progression",
        render: (session) => `${session.step_history.length} étapes`,
      },
      {
        key: "duration",
        label: (
          <div 
            onClick={() => handleSort("started_at")} 
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
          >
            Durée {renderSortIcon("started_at")}
          </div>
        ),
        render: (session) => formatDuration(session.started_at),
      },
      {
        key: "last_activity",
        label: (
          <div 
            onClick={() => handleSort("last_activity")} 
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
          >
            Dernière activité {renderSortIcon("last_activity")}
          </div>
        ),
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
        label: (
          <div 
            onClick={() => handleSort("status")} 
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
          >
            Statut {renderSortIcon("status")}
          </div>
        ),
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
              {
                label: "Terminer la session",
                icon: "🛑",
                onClick: () => setConfirmAction({ type: "terminate", session }),
                variant: "danger",
              },
              {
                label: "Réinitialiser le workflow",
                icon: "🔄",
                onClick: () => setConfirmAction({ type: "reset", session }),
                variant: "danger",
              },
            ]}
          />
        ),
      },
    ],
    [handleViewWorkflow, handleViewThread, handleCopyThreadId, handleViewSessionDetails, handleSort, sortConfig],
  );

  const stuckSessionsCount = filteredSessions.filter(isStuckSession).length;
  // Only display WebSocket error if not connected - if connected, any error was transient
  const displayError = error || (!wsConnected && wsError);
  const hasActiveFilters =
    filterWorkflowId !== null ||
    filterStatus !== null ||
    searchTerm.trim() !== "" ||
    lookbackHours !== null;

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
          headerAction={
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <div
                style={{
                  fontSize: "11px",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  background: wsConnected ? "#10b981" : "#ef4444",
                  color: "white",
                  fontWeight: 500,
                }}
                title={wsConnected ? "WebSocket connecté - Mises à jour en temps réel" : "WebSocket déconnecté"}
              >
                {wsConnected ? "● Live" : "○ Offline"}
              </div>
            </div>
          }
        >
          {isLoading ? (
            <LoadingSpinner text="Chargement des sessions actives…" />
          ) : (
            <>
              {/* Filtres */}
              <div className="workflow-filters">
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
                  {/* Filtre par workflow */}
                  <div style={{ flex: "1 1 140px", minWidth: "140px" }}>
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
                  <div style={{ flex: "0.8 1 100px", minWidth: "100px" }}>
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
                  <div style={{ flex: "1.5 1 180px", minWidth: "180px" }}>
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

                  {/* Fenêtre temporelle */}
                  <div style={{ flex: "1 1 140px", minWidth: "140px" }}>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 500, marginBottom: "4px" }}>
                      Fenêtre
                    </label>
                    <select
                      className="input"
                      value={lookbackHours ?? ""}
                      onChange={(e) =>
                        setLookbackHours(e.target.value ? Number(e.target.value) : null)
                      }
                      style={{ width: "100%", fontSize: "14px" }}
                    >
                      <option value="">Tout l'historique</option>
                      <option value="24">24 heures</option>
                      <option value="168">7 jours</option>
                      <option value="720">30 jours</option>
                    </select>
                  </div>

                  {/* Bouton réinitialiser */}
                  {hasActiveFilters && (
                    <div style={{ flex: "0 0 auto" }}>
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

      {confirmAction && (
        <ConfirmDialog
          title={
            confirmAction.type === "terminate"
              ? "Terminer la session"
              : "Réinitialiser le workflow"
          }
          message={
            confirmAction.type === "terminate"
              ? `Êtes-vous sûr de vouloir terminer la session de ${confirmAction.session.user.email} ? Cette action marquera le workflow comme terminé et supprimera l'état d'attente.`
              : `Êtes-vous sûr de vouloir réinitialiser le workflow de ${confirmAction.session.user.email} ? ATTENTION: Cette action est irréversible et supprimera toute la progression (${confirmAction.session.step_history.length} étapes complétées).`
          }
          confirmLabel={confirmAction.type === "terminate" ? "Terminer" : "Réinitialiser"}
          cancelLabel="Annuler"
          variant="danger"
          onConfirm={
            confirmAction.type === "terminate"
              ? handleTerminateSession
              : handleResetSession
          }
          onCancel={() => setConfirmAction(null)}
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

        .workflow-filters {
          margin-bottom: 16px;
          padding: 12px;
          background: var(--color-surface-subtle);
          border-radius: 12px;
          border: 1px solid var(--color-border-subtle);
        }
      `}</style>
    </>
  );
};
