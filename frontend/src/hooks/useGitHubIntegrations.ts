/**
 * TanStack Query hooks for GitHub integration.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  githubApi,
  GitHubIntegration,
  GitHubRepo,
  GitHubRepoSync,
  GitHubSyncTask,
  WorkflowGitHubMapping,
} from "../utils/backend";

// =============================================================================
// Query Keys
// =============================================================================

export const githubKeys = {
  all: ["github"] as const,
  integrations: () => [...githubKeys.all, "integrations"] as const,
  repos: (integrationId: number) => [...githubKeys.all, "repos", integrationId] as const,
  repoSyncs: () => [...githubKeys.all, "repoSyncs"] as const,
  repoSync: (syncId: number) => [...githubKeys.all, "repoSync", syncId] as const,
  mappings: (syncId: number) => [...githubKeys.all, "mappings", syncId] as const,
  syncTask: (taskId: string) => [...githubKeys.all, "syncTask", taskId] as const,
  scan: (syncId: number) => [...githubKeys.all, "scan", syncId] as const,
};

// =============================================================================
// Integration Hooks
// =============================================================================

export const useGitHubIntegrations = (token: string | null) => {
  return useQuery({
    queryKey: githubKeys.integrations(),
    queryFn: () => githubApi.listIntegrations(token),
    enabled: !!token,
  });
};

export const useDeleteGitHubIntegration = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ token, integrationId }: { token: string | null; integrationId: number }) =>
      githubApi.deleteIntegration(token, integrationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: githubKeys.integrations() });
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSyncs() });
    },
  });
};

// =============================================================================
// Repository Hooks
// =============================================================================

export const useGitHubRepos = (token: string | null, integrationId: number | null) => {
  return useQuery({
    queryKey: githubKeys.repos(integrationId ?? 0),
    queryFn: () => githubApi.listRepos(token, integrationId!),
    enabled: !!token && integrationId != null,
  });
};

// =============================================================================
// Repo Sync Hooks
// =============================================================================

export const useGitHubRepoSyncs = (token: string | null) => {
  return useQuery({
    queryKey: githubKeys.repoSyncs(),
    queryFn: () => githubApi.listRepoSyncs(token),
    enabled: !!token,
  });
};

export const useGitHubRepoSync = (token: string | null, syncId: number | null) => {
  return useQuery({
    queryKey: githubKeys.repoSync(syncId ?? 0),
    queryFn: () => githubApi.getRepoSync(token, syncId!),
    enabled: !!token && syncId != null,
  });
};

export const useCreateGitHubRepoSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      token,
      payload,
    }: {
      token: string | null;
      payload: {
        integration_id: number;
        repo_full_name: string;
        branch?: string;
        file_pattern: string;
        sync_direction?: string;
        auto_sync_enabled?: boolean;
      };
    }) => githubApi.createRepoSync(token, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSyncs() });
      queryClient.invalidateQueries({ queryKey: githubKeys.integrations() });
    },
  });
};

export const useUpdateGitHubRepoSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      token,
      syncId,
      payload,
    }: {
      token: string | null;
      syncId: number;
      payload: {
        branch?: string;
        file_pattern?: string;
        sync_direction?: string;
        auto_sync_enabled?: boolean;
        is_active?: boolean;
      };
    }) => githubApi.updateRepoSync(token, syncId, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSyncs() });
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSync(variables.syncId) });
    },
  });
};

export const useDeleteGitHubRepoSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ token, syncId }: { token: string | null; syncId: number }) =>
      githubApi.deleteRepoSync(token, syncId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSyncs() });
      queryClient.invalidateQueries({ queryKey: githubKeys.integrations() });
    },
  });
};

// =============================================================================
// Sync Operation Hooks
// =============================================================================

export const useTriggerGitHubSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      token,
      syncId,
      operation,
    }: {
      token: string | null;
      syncId: number;
      operation?: "pull" | "push" | "sync";
    }) => githubApi.triggerSync(token, syncId, operation),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSync(variables.syncId) });
    },
  });
};

export const useGitHubSyncTaskStatus = (
  token: string | null,
  taskId: string | null,
  options?: { refetchInterval?: number | false },
) => {
  return useQuery({
    queryKey: githubKeys.syncTask(taskId ?? ""),
    queryFn: () => githubApi.getSyncTaskStatus(token, taskId!),
    enabled: !!token && !!taskId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Keep polling while pending or running
      if (status === "pending" || status === "running") {
        return options?.refetchInterval ?? 2000;
      }
      return false;
    },
  });
};

export const useScanGitHubRepoFiles = () => {
  return useMutation({
    mutationFn: ({ token, syncId }: { token: string | null; syncId: number }) =>
      githubApi.scanRepoFiles(token, syncId),
  });
};

// =============================================================================
// Mapping Hooks
// =============================================================================

export const useGitHubMappings = (token: string | null, syncId: number | null) => {
  return useQuery({
    queryKey: githubKeys.mappings(syncId ?? 0),
    queryFn: () => githubApi.listMappings(token, syncId!),
    enabled: !!token && syncId != null,
  });
};

export const usePushWorkflowToGitHub = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      token,
      payload,
    }: {
      token: string | null;
      payload: {
        workflow_id: number;
        repo_sync_id: number;
        file_path?: string;
        commit_message?: string;
      };
    }) => githubApi.pushWorkflow(token, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: githubKeys.mappings(variables.payload.repo_sync_id) });
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSync(variables.payload.repo_sync_id) });
    },
  });
};

// =============================================================================
// Webhook Hooks
// =============================================================================

export const useCreateGitHubWebhook = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ token, syncId }: { token: string | null; syncId: number }) =>
      githubApi.createWebhook(token, syncId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSyncs() });
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSync(variables.syncId) });
    },
  });
};

export const useDeleteGitHubWebhook = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ token, syncId }: { token: string | null; syncId: number }) =>
      githubApi.deleteWebhook(token, syncId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSyncs() });
      queryClient.invalidateQueries({ queryKey: githubKeys.repoSync(variables.syncId) });
    },
  });
};
