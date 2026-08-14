/**
 * Context providing real-time active workflow sessions data to the builder canvas.
 * Uses the existing WebSocket monitor endpoint, filtered by the current workflow.
 */
import React, { createContext, useContext, useMemo } from "react";
import { useWorkflowMonitorWebSocket } from "../../../hooks/useWorkflowMonitorWebSocket";

export interface ActiveSessionUser {
  id: number;
  email: string;
  displayName: string | null;
  threadId: string;
}

export type SessionsByStep = Record<string, ActiveSessionUser[]>;

interface ActiveSessionsContextValue {
  sessionsByStep: SessionsByStep;
  isConnected: boolean;
}

const EMPTY: ActiveSessionsContextValue = {
  sessionsByStep: {},
  isConnected: false,
};

const ActiveSessionsContext = createContext<ActiveSessionsContextValue>(EMPTY);

interface ActiveSessionsProviderProps {
  token: string | null;
  workflowId: number | null;
  workflowSlug: string | null;
  enabled: boolean;
  children: React.ReactNode;
}

export const ActiveSessionsProvider: React.FC<ActiveSessionsProviderProps> = ({
  token,
  workflowId,
  workflowSlug,
  enabled,
  children,
}) => {
  const { sessions, isConnected } = useWorkflowMonitorWebSocket({
    token,
    enabled: enabled && workflowId != null,
    workflowSlug,
  });

  const value = useMemo<ActiveSessionsContextValue>(() => {
    if (!workflowId || !enabled) return EMPTY;

    const byStep: SessionsByStep = {};
    for (const session of sessions) {
      if (session.workflow.id !== workflowId) continue;
      const slug = session.current_step.slug;
      if (!slug || slug === "unknown") continue;
      if (!byStep[slug]) byStep[slug] = [];
      byStep[slug].push({
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.display_name ?? null,
        threadId: session.thread_id,
      });
    }
    return { sessionsByStep: byStep, isConnected };
  }, [sessions, workflowId, enabled, isConnected]);

  return (
    <ActiveSessionsContext.Provider value={value}>
      {children}
    </ActiveSessionsContext.Provider>
  );
};

export const useActiveSessions = () => useContext(ActiveSessionsContext);
