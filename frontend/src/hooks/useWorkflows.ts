import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  workflowsApi,
  type WorkflowSummary,
  type WorkflowVersionSummary,
  type WorkflowVersionResponse,
  type CreateWorkflowPayload,
  type UpdateWorkflowPayload,
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
export const useWorkflowVersion = (token: string | null, versionId: number | null) => {
  return useQuery({
    queryKey: workflowsKeys.version(versionId ?? -1),
    queryFn: () => workflowsApi.getVersion(token, versionId!),
    enabled: !!token && versionId !== null,
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
