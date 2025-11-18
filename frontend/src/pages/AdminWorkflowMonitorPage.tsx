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

export const AdminWorkflowMonitorPage = () => {
  const { token, logout } = useAuth();
  const [sessions, setSessions] = useState<ActiveWorkflowSession[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowInfo | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<ActiveWorkflowSession[]>([]);

  const fetchActiveSessions = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.getActiveWorkflowSessions(token);
      setSessions(data.sessions);
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
    }
  }, [logout, token]);

  useEffect(() => {
    void fetchActiveSessions();
  }, [fetchActiveSessions]);

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
        render: (session) => formatDateTime(session.last_activity),
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

  return (
    <>
      <FeedbackMessages
        error={error}
        onDismissError={() => setError(null)}
      />

      <div className="admin-grid">
        <FormSection
          title="Workflows en cours"
          subtitle="Visualisez tous les workflows actifs et la position de chaque utilisateur."
          headerAction={
            <button
              type="button"
              className="management-header__icon-button"
              aria-label="Actualiser"
              title="Actualiser"
              onClick={() => void fetchActiveSessions()}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M17 10a7 7 0 11-14 0 7 7 0 0114 0z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 6v4l2 2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
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
              <div className="admin-card__subtitle mb-4">
                {sessions.length} session{sessions.length > 1 ? "s" : ""} active{sessions.length > 1 ? "s" : ""}
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
    </>
  );
};
