import { useEffect, useState } from "react";
import { workflowsApi, type WorkflowVersionResponse } from "../utils/backend";

export type WorkflowCapabilities = {
  hasVoiceAgent: boolean;
  hasOutboundCall: boolean;
  loading: boolean;
  error: string | null;
};

/**
 * Hook to detect workflow capabilities by analyzing its active version graph.
 * Checks for voice_agent and outbound_call nodes to enable appropriate WebSocket connections.
 */
export function useWorkflowCapabilities(
  token: string | null,
  workflowId: number | null,
  versionId: number | null
): WorkflowCapabilities {
  const [capabilities, setCapabilities] = useState<WorkflowCapabilities>({
    hasVoiceAgent: false,
    hasOutboundCall: false,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!token || !workflowId || !versionId) {
      setCapabilities({
        hasVoiceAgent: false,
        hasOutboundCall: false,
        loading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;

    const fetchCapabilities = async () => {
      setCapabilities((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const version: WorkflowVersionResponse = await workflowsApi.getVersion(
          token,
          workflowId,
          versionId
        );

        if (cancelled) return;

        // Analyze graph nodes to detect capabilities
        const nodes = version.graph?.nodes || [];
        const normalizeKind = (kind: unknown) =>
          typeof kind === "string" ? kind.trim().replace(/[-\s]+/g, "_") : "";

        const hasVoiceAgent = nodes.some((node) => normalizeKind(node.kind) === "voice_agent");
        const hasOutboundCall = nodes.some((node) => normalizeKind(node.kind) === "outbound_call");

        setCapabilities({
          hasVoiceAgent,
          hasOutboundCall,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;

        console.error("[useWorkflowCapabilities] Failed to fetch workflow version:", error);
        setCapabilities({
          hasVoiceAgent: false,
          hasOutboundCall: false,
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load workflow capabilities",
        });
      }
    };

    fetchCapabilities();

    return () => {
      cancelled = true;
    };
  }, [token, workflowId, versionId]);

  return capabilities;
}
