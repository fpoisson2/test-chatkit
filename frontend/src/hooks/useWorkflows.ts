import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  workflowsApi,
  chatkitApi,
  type WorkflowSummary,
  type WorkflowVersionSummary,
  type WorkflowVersionResponse,
  type CreateWorkflowPayload,
  type CreateWorkflowWithGraphPayload,
  type UpdateWorkflowPayload,
  type HostedWorkflowMetadata,
} from "../utils/backend";

// Query keys for cache management
export const workflowsKeys = {
  all: ["workflows"] as const,
  lists: () => [...workflowsKeys.all, "list"] as const,
  list: (token: string | null) => [...workflowsKeys.lists(), token] as const,
  details: () => [...workflowsKeys.all, "detail"] as const,
  detail: (id: number) => [...workflowsKeys.details(), id] as const,
  versions: (workflowId: number) => [...workflowsKeys.all, "versions", workflowId] as const,
  version: (versionId: number) => [...workflowsKeys.all, "version", versionId] as const,
};

// Query keys for hosted workflows
export const hostedWorkflowsKeys = {
  all: ["hostedWorkflows"] as const,
  lists: () => [...hostedWorkflowsKeys.all, "list"] as const,
  list: (token: string | null) => [...hostedWorkflowsKeys.lists(), token] as const,
};

/**
 * Hook to fetch all workflows
 */
export const useWorkflows = (token: string | null) => {
  return useQuery({
    queryKey: workflowsKeys.list(token),
    queryFn: () => workflowsApi.list(token),
    enabled: !!token,
  });
};

/**
 * Hook to fetch versions for a workflow
 */
export const useWorkflowVersions = (token: string | null, workflowId: number | null) => {
  return useQuery({
    queryKey: workflowsKeys.versions(workflowId ?? -1),
    queryFn: () => workflowsApi.getVersions(token, workflowId!),
    enabled: !!token && workflowId !== null,
  });
};

/**
 * Hook to fetch a specific version detail
 */
export const useWorkflowVersion = (token: string | null, workflowId: number | null, versionId: number | null) => {
  return useQuery({
    queryKey: workflowsKeys.version(versionId ?? -1),
    queryFn: () => workflowsApi.getVersion(token, workflowId!, versionId!),
    enabled: !!token && workflowId !== null && versionId !== null,
  });
};

/**
 * Hook to create a new workflow
 */
export const useCreateWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, payload }: { token: string | null; payload: CreateWorkflowPayload }) =>
      workflowsApi.create(token, payload),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: workflowsKeys.lists() });

      // Snapshot previous value
      const previousWorkflows = queryClient.getQueryData<WorkflowSummary[]>(workflowsKeys.list(variables.token));

      // Optimistically update cache with temporary workflow
      const tempWorkflow: WorkflowSummary = {
        id: -1, // Temporary ID
        slug: `temp-${Date.now()}`,
        display_name: variables.payload.display_name,
        description: variables.payload.description ?? null,
        active_version_id: null,
        active_version_number: null,
        is_chatkit_default: false,
        versions_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      queryClient.setQueryData<WorkflowSummary[]>(
        workflowsKeys.list(variables.token),
        (old = []) => [...old, tempWorkflow]
      );

      return { previousWorkflows };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousWorkflows) {
        queryClient.setQueryData(workflowsKeys.list(variables.token), context.previousWorkflows);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: workflowsKeys.lists() });
    },
  });
};

/**
 * Hook to create a workflow with graph (used for duplication)
 */
export const useCreateWorkflowWithGraph = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, payload }: { token: string | null; payload: CreateWorkflowWithGraphPayload }) =>
      workflowsApi.createWithGraph(token, payload),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: workflowsKeys.lists() });

      // Snapshot previous value
      const previousWorkflows = queryClient.getQueryData<WorkflowSummary[]>(workflowsKeys.list(variables.token));

      // Optimistically update cache with temporary workflow
      const tempWorkflow: WorkflowSummary = {
        id: -Date.now(), // Temporary negative ID
        slug: variables.payload.slug,
        display_name: variables.payload.display_name,
        description: variables.payload.description ?? null,
        active_version_id: null,
        active_version_number: null,
        is_chatkit_default: false,
        versions_count: 1, // New workflow with graph has 1 version
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      queryClient.setQueryData<WorkflowSummary[]>(
        workflowsKeys.list(variables.token),
        (old = []) => [...old, tempWorkflow]
      );

      return { previousWorkflows };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousWorkflows) {
        queryClient.setQueryData(workflowsKeys.list(variables.token), context.previousWorkflows);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: workflowsKeys.lists() });
    },
  });
};

/**
 * Hook to update a workflow
 */
export const useUpdateWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      id,
      payload
    }: {
      token: string | null;
      id: number;
      payload: UpdateWorkflowPayload
    }) => workflowsApi.update(token, id, payload),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: workflowsKeys.lists() });

      // Snapshot previous value
      const previousWorkflows = queryClient.getQueryData<WorkflowSummary[]>(workflowsKeys.list(variables.token));

      // Optimistically update cache
      queryClient.setQueryData<WorkflowSummary[]>(
        workflowsKeys.list(variables.token),
        (old = []) =>
          old.map((workflow) =>
            workflow.id === variables.id
              ? { ...workflow, ...variables.payload, updated_at: new Date().toISOString() }
              : workflow
          )
      );

      return { previousWorkflows };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousWorkflows) {
        queryClient.setQueryData(workflowsKeys.list(variables.token), context.previousWorkflows);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: workflowsKeys.lists() });
    },
  });
};

/**
 * Hook to delete a workflow
 */
export const useDeleteWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, id }: { token: string | null; id: number }) =>
      workflowsApi.delete(token, id),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: workflowsKeys.lists() });

      // Snapshot previous value
      const previousWorkflows = queryClient.getQueryData<WorkflowSummary[]>(workflowsKeys.list(variables.token));

      // Optimistically remove from cache
      queryClient.setQueryData<WorkflowSummary[]>(
        workflowsKeys.list(variables.token),
        (old = []) => old.filter((workflow) => workflow.id !== variables.id)
      );

      return { previousWorkflows };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousWorkflows) {
        queryClient.setQueryData(workflowsKeys.list(variables.token), context.previousWorkflows);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: workflowsKeys.lists() });
    },
  });
};

/**
 * Hook to duplicate a workflow
 */
export const useDuplicateWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      id,
      newName
    }: {
      token: string | null;
      id: number;
      newName: string
    }) => workflowsApi.duplicate(token, id, newName),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: workflowsKeys.lists() });

      // Snapshot previous value
      const previousWorkflows = queryClient.getQueryData<WorkflowSummary[]>(workflowsKeys.list(variables.token));

      // Find the original workflow to duplicate
      const originalWorkflow = previousWorkflows?.find((w) => w.id === variables.id);

      if (originalWorkflow) {
        // Optimistically add duplicated workflow
        const tempWorkflow: WorkflowSummary = {
          ...originalWorkflow,
          id: -Date.now(), // Temporary negative ID
          slug: `temp-${Date.now()}`,
          display_name: variables.newName,
          is_chatkit_default: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        queryClient.setQueryData<WorkflowSummary[]>(
          workflowsKeys.list(variables.token),
          (old = []) => [...old, tempWorkflow]
        );
      }

      return { previousWorkflows };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousWorkflows) {
        queryClient.setQueryData(workflowsKeys.list(variables.token), context.previousWorkflows);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: workflowsKeys.lists() });
    },
  });
};

/**
 * Hook to set the chatkit workflow
 */
export const useSetChatkitWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, workflowId }: { token: string | null; workflowId: number }) =>
      workflowsApi.setChatkitWorkflow(token, workflowId),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: workflowsKeys.lists() });

      // Snapshot previous value
      const previousWorkflows = queryClient.getQueryData<WorkflowSummary[]>(workflowsKeys.list(variables.token));

      // Optimistically update cache - set new default and unset old one
      queryClient.setQueryData<WorkflowSummary[]>(
        workflowsKeys.list(variables.token),
        (old = []) =>
          old.map((workflow) => ({
            ...workflow,
            is_chatkit_default: workflow.id === variables.workflowId,
          }))
      );

      return { previousWorkflows };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousWorkflows) {
        queryClient.setQueryData(workflowsKeys.list(variables.token), context.previousWorkflows);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: workflowsKeys.lists() });
    },
  });
};

// ============================================================================
// HOSTED WORKFLOWS HOOKS
// ============================================================================

/**
 * Hook to fetch all hosted workflows
 */
export const useHostedWorkflows = (token: string | null) => {
  return useQuery({
    queryKey: hostedWorkflowsKeys.list(token),
    queryFn: () => chatkitApi.getHostedWorkflows(token, { cache: false }),
    enabled: !!token,
  });
};

/**
 * Hook to create a hosted workflow
 */
export const useCreateHostedWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      payload,
    }: {
      token: string | null;
      payload: {
        slug: string;
        workflow_id: string;
        label: string;
        description?: string;
      };
    }) => chatkitApi.createHostedWorkflow(token, payload),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: hostedWorkflowsKeys.lists() });

      // Snapshot previous value
      const previousHosted = queryClient.getQueryData<HostedWorkflowMetadata[] | null>(
        hostedWorkflowsKeys.list(variables.token)
      );

      // Optimistically update cache with temporary hosted workflow
      const tempHosted: HostedWorkflowMetadata = {
        slug: variables.payload.slug,
        workflowId: variables.payload.workflow_id,
        label: variables.payload.label,
        description: variables.payload.description || null,
      };

      queryClient.setQueryData<HostedWorkflowMetadata[] | null>(
        hostedWorkflowsKeys.list(variables.token),
        (old) => (old ? [...old, tempHosted] : [tempHosted])
      );

      // Invalidate cache to ensure it's refetched
      chatkitApi.invalidateHostedWorkflowCache();

      return { previousHosted };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousHosted !== undefined) {
        queryClient.setQueryData(hostedWorkflowsKeys.list(variables.token), context.previousHosted);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: hostedWorkflowsKeys.lists() });
    },
  });
};

/**
 * Hook to delete a hosted workflow
 */
export const useDeleteHostedWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, slug }: { token: string | null; slug: string }) =>
      chatkitApi.deleteHostedWorkflow(token, slug),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: hostedWorkflowsKeys.lists() });

      // Snapshot previous value
      const previousHosted = queryClient.getQueryData<HostedWorkflowMetadata[] | null>(
        hostedWorkflowsKeys.list(variables.token)
      );

      // Optimistically remove from cache
      queryClient.setQueryData<HostedWorkflowMetadata[] | null>(
        hostedWorkflowsKeys.list(variables.token),
        (old) => (old ? old.filter((w) => w.slug !== variables.slug) : null)
      );

      // Invalidate cache to ensure it's refetched
      chatkitApi.invalidateHostedWorkflowCache();

      return { previousHosted };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousHosted !== undefined) {
        queryClient.setQueryData(hostedWorkflowsKeys.list(variables.token), context.previousHosted);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: hostedWorkflowsKeys.lists() });
    },
  });
};

// ============================================================================
// VERSION OPERATIONS HOOKS
// ============================================================================

/**
 * Hook to promote a workflow version
 */
export const usePromoteVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      versionId,
      isActive,
    }: {
      token: string | null;
      versionId: number;
      isActive: boolean;
    }) => workflowsApi.promoteVersion(token, versionId, isActive),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: workflowsKeys.all });

      // Snapshot previous values - we need to update the version in the versions list
      const workflowId = queryClient
        .getQueriesData<WorkflowVersionSummary[]>({ queryKey: workflowsKeys.all })
        .find(([key]) => {
          const versions = queryClient.getQueryData<WorkflowVersionSummary[]>(key);
          return versions?.some((v) => v.id === variables.versionId);
        })?.[1]
        ?.find((v) => v.id === variables.versionId)?.workflow_id;

      if (workflowId) {
        const previousVersions = queryClient.getQueryData<WorkflowVersionSummary[]>(
          workflowsKeys.versions(workflowId)
        );

        // Optimistically update version status
        queryClient.setQueryData<WorkflowVersionSummary[]>(
          workflowsKeys.versions(workflowId),
          (old = []) =>
            old.map((v) =>
              v.id === variables.versionId ? { ...v, is_active: variables.isActive } : v
            )
        );

        return { previousVersions, workflowId };
      }

      return {};
    },
    onError: (err, variables, context: any) => {
      // Rollback to previous state on error
      if (context?.previousVersions && context?.workflowId) {
        queryClient.setQueryData(
          workflowsKeys.versions(context.workflowId),
          context.previousVersions
        );
      }
    },
    onSettled: () => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: workflowsKeys.all });
    },
  });
};

/**
 * Hook to deploy a workflow version to production
 */
export const useDeployToProduction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      workflowId,
      versionId,
    }: {
      token: string | null;
      workflowId: number;
      versionId: number;
    }) => workflowsApi.deployToProduction(token, workflowId, versionId),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: workflowsKeys.lists() });
      await queryClient.cancelQueries({ queryKey: workflowsKeys.versions(variables.workflowId) });

      // Snapshot previous values
      const previousWorkflows = queryClient.getQueryData<WorkflowSummary[]>(
        workflowsKeys.list(variables.token)
      );
      const previousVersions = queryClient.getQueryData<WorkflowVersionSummary[]>(
        workflowsKeys.versions(variables.workflowId)
      );

      // Optimistically update workflow's active version
      queryClient.setQueryData<WorkflowSummary[]>(
        workflowsKeys.list(variables.token),
        (old = []) =>
          old.map((workflow) =>
            workflow.id === variables.workflowId
              ? { ...workflow, active_version_id: variables.versionId, updated_at: new Date().toISOString() }
              : workflow
          )
      );

      // Optimistically set all versions to inactive, then set the target to active
      queryClient.setQueryData<WorkflowVersionSummary[]>(
        workflowsKeys.versions(variables.workflowId),
        (old = []) =>
          old.map((v) => ({
            ...v,
            is_active: v.id === variables.versionId,
          }))
      );

      return { previousWorkflows, previousVersions };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousWorkflows) {
        queryClient.setQueryData(workflowsKeys.list(variables.token), context.previousWorkflows);
      }
      if (context?.previousVersions) {
        queryClient.setQueryData(
          workflowsKeys.versions(variables.workflowId),
          context.previousVersions
        );
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: workflowsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: workflowsKeys.versions(variables.workflowId) });
    },
  });
};
