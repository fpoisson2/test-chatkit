import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import type {
  WorkflowSummary,
  WorkflowVersionSummary,
  WorkflowVersionResponse,
} from "../types";
import type { HostedWorkflowMetadata } from "../../../utils/backend";
import { ChatKit, type ChatKitControl } from "@openai/chatkit-react"Api, makeApiEndpointCandidates } from "../../../utils/backend";
import { backendUrl } from "../WorkflowBuilderUtils";

// Context types
type WorkflowContextValue = {
  // State
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  selectedWorkflowId: string | number | null;
  versions: WorkflowVersionSummary[];
  selectedVersionId: number | null;
  selectedVersionDetail: WorkflowVersionResponse | null;
  draftVersionId: number | null;
  draftVersionSummary: WorkflowVersionSummary | null;
  loading: boolean;
  loadError: string | null;
  hostedLoading: boolean;
  hostedError: string | null;

  // Refs
  workflowsRef: React.MutableRefObject<WorkflowSummary[]>;
  hostedWorkflowsRef: React.MutableRefObject<HostedWorkflowMetadata[]>;
  versionsRef: React.MutableRefObject<WorkflowVersionSummary[]>;
  selectedWorkflowIdRef: React.MutableRefObject<string | number | null>;
  selectedVersionIdRef: React.MutableRefObject<number | null>;
  draftVersionIdRef: React.MutableRefObject<number | null>;
  draftVersionSummaryRef: React.MutableRefObject<WorkflowVersionSummary | null>;

  // Methods
  setWorkflows: (workflows: WorkflowSummary[]) => void;
  setHostedWorkflows: (workflows: HostedWorkflowMetadata[]) => void;
  setVersions: (versions: WorkflowVersionSummary[]) => void;
  setSelectedWorkflowId: (id: string | number | null) => void;
  setSelectedVersionId: (id: number | null) => void;
  setSelectedVersionDetail: (detail: WorkflowVersionResponse | null) => void;
  setDraftVersionId: (id: number | null) => void;
  setDraftVersionSummary: (summary: WorkflowVersionSummary | null) => void;
  setLoading: (loading: boolean) => void;
  setLoadError: (error: string | null) => void;
  setHostedLoading: (loading: boolean) => void;
  setHostedError: (error: string | null) => void;

  loadWorkflows: (authHeader: Record<string, string>, options?: LoadWorkflowsOptions) => Promise<void>;
  loadHostedWorkflows: (token: string | null) => Promise<void>;
  loadVersions: (workflowId: string | number, authHeader: Record<string, string>, options?: LoadVersionsOptions) => Promise<void>;
  loadVersionDetail: (versionId: number, authHeader: Record<string, string>, options?: LoadVersionDetailOptions) => Promise<WorkflowVersionResponse | null>;
  selectWorkflow: (id: string | number | null) => void;
  selectVersion: (id: number | null) => void;
  createWorkflow: (data: CreateWorkflowData, authHeader: Record<string, string>) => Promise<WorkflowSummary | null>;
  deleteWorkflow: (id: string | number, authHeader: Record<string, string>) => Promise<boolean>;
  deleteHostedWorkflow: (slug: string, token: string | null) => Promise<boolean>;
  duplicateWorkflow: (id: string | number, newName: string, authHeader: Record<string, string>) => Promise<WorkflowSummary | null>;
  renameWorkflow: (id: string | number, name: string, authHeader: Record<string, string>) => Promise<boolean>;
};

type LoadWorkflowsOptions = {
  onSuccess?: (workflows: WorkflowSummary[]) => void;
  onError?: (error: string) => void;
};

type LoadVersionsOptions = {
  currentVersionId?: number | null;
  onSuccess?: (versions: WorkflowVersionSummary[], selectedVersionId: number | null) => void;
  onError?: (error: string) => void;
};

type LoadVersionDetailOptions = {
  onSuccess?: (response: WorkflowVersionResponse) => void;
  onError?: (error: string) => void;
};

type CreateWorkflowData = {
  kind: "local" | "hosted";
  name: string;
  remoteId?: string;
  token?: string;
};

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export const useWorkflowContext = () => {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error("useWorkflowContext must be used within WorkflowProvider");
  }
  return context;
};

type WorkflowProviderProps = {
  children: ReactNode;
};

export const WorkflowProvider = ({ children }: WorkflowProviderProps) => {
  // State
  const [workflows, setWorkflowsState] = useState<WorkflowSummary[]>([]);
  const [hostedWorkflows, setHostedWorkflowsState] = useState<HostedWorkflowMetadata[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowIdState] = useState<string | number | null>(null);
  const [versions, setVersionsState] = useState<WorkflowVersionSummary[]>([]);
  const [selectedVersionId, setSelectedVersionIdState] = useState<number | null>(null);
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<WorkflowVersionResponse | null>(null);
  const [draftVersionId, setDraftVersionIdState] = useState<number | null>(null);
  const [draftVersionSummary, setDraftVersionSummaryState] = useState<WorkflowVersionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hostedLoading, setHostedLoading] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);

  // Refs for synchronization
  const workflowsRef = useRef<WorkflowSummary[]>([]);
  const hostedWorkflowsRef = useRef<HostedWorkflowMetadata[]>([]);
  const versionsRef = useRef<WorkflowVersionSummary[]>([]);
  const selectedWorkflowIdRef = useRef<string | number | null>(null);
  const selectedVersionIdRef = useRef<number | null>(null);
  const draftVersionIdRef = useRef<number | null>(null);
  const draftVersionSummaryRef = useRef<WorkflowVersionSummary | null>(null);

  // Sync refs with state
  workflowsRef.current = workflows;
  hostedWorkflowsRef.current = hostedWorkflows;
  versionsRef.current = versions;
  selectedWorkflowIdRef.current = selectedWorkflowId;
  selectedVersionIdRef.current = selectedVersionId;
  draftVersionIdRef.current = draftVersionId;
  draftVersionSummaryRef.current = draftVersionSummary;

  // Enhanced setters that also update refs
  const setWorkflows = useCallback((newWorkflows: WorkflowSummary[]) => {
    setWorkflowsState(newWorkflows);
  }, []);

  const setHostedWorkflows = useCallback((newHostedWorkflows: HostedWorkflowMetadata[]) => {
    setHostedWorkflowsState(newHostedWorkflows);
  }, []);

  const setVersions = useCallback((newVersions: WorkflowVersionSummary[]) => {
    setVersionsState(newVersions);
  }, []);

  const setSelectedWorkflowId = useCallback((id: string | number | null) => {
    setSelectedWorkflowIdState(id);
  }, []);

  const setSelectedVersionId = useCallback((id: number | null) => {
    setSelectedVersionIdState(id);
  }, []);

  const setDraftVersionId = useCallback((id: number | null) => {
    setDraftVersionIdState(id);
  }, []);

  const setDraftVersionSummary = useCallback((summary: WorkflowVersionSummary | null) => {
    setDraftVersionSummaryState(summary);
  }, []);

  // Load workflows
  const loadWorkflows = useCallback(
    async (authHeader: Record<string, string>, options?: LoadWorkflowsOptions) => {
      setLoading(true);
      setLoadError(null);

      const endpoint = "/api/workflows";
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);

      let lastError: string | null = null;

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: authHeader,
          });

          if (response.status === 401) {
            setLoadError("Unauthorized");
            options?.onError?.("Unauthorized");
            setLoading(false);
            return;
          }

          if (!response.ok) {
            lastError = `HTTP ${response.status}`;
            continue;
          }

          const data = (await response.json()) as WorkflowSummary[];
          setWorkflows(data);
          setLoading(false);
          options?.onSuccess?.(data);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Unknown error";
          continue;
        }
      }

      setLoadError(lastError ?? "Failed to load workflows");
      setLoading(false);
      options?.onError?.(lastError ?? "Failed to load workflows");
    },
    [setWorkflows],
  );

  // Load hosted workflows
  const loadHostedWorkflows = useCallback(async (token: string | null) => {
    if (!token) {
      return;
    }

    setHostedLoading(true);
    setHostedError(null);

    try {
      const data = await chatkitApi.getHostedWorkflows(token, { cache: false });
      setHostedWorkflows(data);
      setHostedLoading(false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to load hosted workflows";
      setHostedError(errorMessage);
      setHostedLoading(false);
    }
  }, [setHostedWorkflows]);

  // Load versions for a workflow
  const loadVersions = useCallback(
    async (workflowId: string | number, authHeader: Record<string, string>, options?: LoadVersionsOptions) => {
      const endpoint = `/api/workflows/${workflowId}/versions`;
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);

      let lastError: string | null = null;

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: authHeader,
          });

          if (!response.ok) {
            lastError = `HTTP ${response.status}`;
            continue;
          }

          const data = (await response.json()) as WorkflowVersionSummary[];
          setVersions(data);

          // Find draft version
          const draft = data.find((v) => !v.is_active) ?? null;
          setDraftVersionId(draft?.id ?? null);
          setDraftVersionSummary(draft);

          // Determine which version to select
          let versionIdToSelect: number | null = null;

          if (options?.currentVersionId && data.some((v) => v.id === options.currentVersionId)) {
            versionIdToSelect = options.currentVersionId;
          } else if (draft) {
            versionIdToSelect = draft.id;
          } else if (data.length > 0) {
            versionIdToSelect = data[0].id;
          }

          options?.onSuccess?.(data, versionIdToSelect);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Unknown error";
          continue;
        }
      }

      const errorMessage = lastError ?? "Failed to load versions";
      options?.onError?.(errorMessage);
    },
    [setVersions, setDraftVersionId, setDraftVersionSummary],
  );

  // Load version detail
  const loadVersionDetail = useCallback(
    async (versionId: number, authHeader: Record<string, string>, options?: LoadVersionDetailOptions) => {
      const endpoint = `/api/workflow_versions/${versionId}`;
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);

      let lastError: string | null = null;

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: authHeader,
          });

          if (!response.ok) {
            lastError = `HTTP ${response.status}`;
            continue;
          }

          const data = (await response.json()) as WorkflowVersionResponse;
          setSelectedVersionDetail(data);
          setSelectedVersionId(versionId);
          options?.onSuccess?.(data);
          return data;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Unknown error";
          continue;
        }
      }

      const errorMessage = lastError ?? "Failed to load version detail";
      options?.onError?.(errorMessage);
      return null;
    },
    [setSelectedVersionDetail, setSelectedVersionId],
  );

  // Select workflow
  const selectWorkflow = useCallback((id: string | number | null) => {
    setSelectedWorkflowId(id);
  }, [setSelectedWorkflowId]);

  // Select version
  const selectVersion = useCallback((id: number | null) => {
    setSelectedVersionId(id);
  }, [setSelectedVersionId]);

  // Create workflow
  const createWorkflow = useCallback(
    async (data: CreateWorkflowData, authHeader: Record<string, string>) => {
      if (data.kind === "hosted") {
        if (!data.token || !data.remoteId) {
          return null;
        }

        try {
          const result = await chatkitApi.createHostedWorkflow(data.token, {
            slug: data.remoteId,
            label: data.name,
          });

          // Reload hosted workflows
          await loadHostedWorkflows(data.token);

          return null; // Hosted workflows don't return WorkflowSummary
        } catch (error) {
          throw error;
        }
      } else {
        // Local workflow
        const endpoint = "/api/workflows";
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
              body: JSON.stringify({
                display_name: data.name,
              }),
            });

            if (!response.ok) {
              lastError = new Error(`HTTP ${response.status}`);
              continue;
            }

            const workflow = (await response.json()) as WorkflowSummary;

            // Reload workflows
            await loadWorkflows(authHeader);

            return workflow;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error("Unknown error");
            continue;
          }
        }

        throw lastError ?? new Error("Failed to create workflow");
      }
    },
    [loadWorkflows, loadHostedWorkflows],
  );

  // Delete workflow
  const deleteWorkflow = useCallback(
    async (id: string | number, authHeader: Record<string, string>) => {
      const endpoint = `/api/workflows/${id}`;
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);

      let lastError: Error | null = null;

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "DELETE",
            headers: authHeader,
          });

          if (!response.ok) {
            lastError = new Error(`HTTP ${response.status}`);
            continue;
          }

          // Reload workflows
          await loadWorkflows(authHeader);

          return true;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Unknown error");
          continue;
        }
      }

      throw lastError ?? new Error("Failed to delete workflow");
    },
    [loadWorkflows],
  );

  // Delete hosted workflow
  const deleteHostedWorkflow = useCallback(
    async (slug: string, token: string | null) => {
      if (!token) {
        return false;
      }

      try {
        await chatkitApi.deleteHostedWorkflow(token, slug);

        // Reload hosted workflows
        await loadHostedWorkflows(token);

        return true;
      } catch (error) {
        throw error;
      }
    },
    [loadHostedWorkflows],
  );

  // Duplicate workflow
  const duplicateWorkflow = useCallback(
    async (id: string | number, newName: string, authHeader: Record<string, string>) => {
      const endpoint = `/api/workflows/${id}/duplicate`;
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
            body: JSON.stringify({
              display_name: newName,
            }),
          });

          if (!response.ok) {
            lastError = new Error(`HTTP ${response.status}`);
            continue;
          }

          const workflow = (await response.json()) as WorkflowSummary;

          // Reload workflows
          await loadWorkflows(authHeader);

          return workflow;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Unknown error");
          continue;
        }
      }

      throw lastError ?? new Error("Failed to duplicate workflow");
    },
    [loadWorkflows],
  );

  // Rename workflow
  const renameWorkflow = useCallback(
    async (id: string | number, name: string, authHeader: Record<string, string>) => {
      const endpoint = `/api/workflows/${id}`;
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);

      let lastError: Error | null = null;

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify({
              display_name: name,
            }),
          });

          if (!response.ok) {
            lastError = new Error(`HTTP ${response.status}`);
            continue;
          }

          // Reload workflows
          await loadWorkflows(authHeader);

          return true;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Unknown error");
          continue;
        }
      }

      throw lastError ?? new Error("Failed to rename workflow");
    },
    [loadWorkflows],
  );

  const value = useMemo<WorkflowContextValue>(
    () => ({
      // State
      workflows,
      hostedWorkflows,
      selectedWorkflowId,
      versions,
      selectedVersionId,
      selectedVersionDetail,
      draftVersionId,
      draftVersionSummary,
      loading,
      loadError,
      hostedLoading,
      hostedError,

      // Refs
      workflowsRef,
      hostedWorkflowsRef,
      versionsRef,
      selectedWorkflowIdRef,
      selectedVersionIdRef,
      draftVersionIdRef,
      draftVersionSummaryRef,

      // Setters
      setWorkflows,
      setHostedWorkflows,
      setVersions,
      setSelectedWorkflowId,
      setSelectedVersionId,
      setSelectedVersionDetail,
      setDraftVersionId,
      setDraftVersionSummary,
      setLoading,
      setLoadError,
      setHostedLoading,
      setHostedError,

      // Methods
      loadWorkflows,
      loadHostedWorkflows,
      loadVersions,
      loadVersionDetail,
      selectWorkflow,
      selectVersion,
      createWorkflow,
      deleteWorkflow,
      deleteHostedWorkflow,
      duplicateWorkflow,
      renameWorkflow,
    }),
    [
      workflows,
      hostedWorkflows,
      selectedWorkflowId,
      versions,
      selectedVersionId,
      selectedVersionDetail,
      draftVersionId,
      draftVersionSummary,
      loading,
      loadError,
      hostedLoading,
      hostedError,
      setWorkflows,
      setHostedWorkflows,
      setVersions,
      setSelectedWorkflowId,
      setSelectedVersionId,
      setDraftVersionId,
      setDraftVersionSummary,
      loadWorkflows,
      loadHostedWorkflows,
      loadVersions,
      loadVersionDetail,
      selectWorkflow,
      selectVersion,
      createWorkflow,
      deleteWorkflow,
      deleteHostedWorkflow,
      duplicateWorkflow,
      renameWorkflow,
    ],
  );

  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
};
