import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  workflowsApi,
  type WorkflowSummary,
} from "../utils/backend";

// Query keys for cache management
export const workflowsKeys = {
  all: ["workflows"] as const,
  lists: () => [...workflowsKeys.all, "list"] as const,
  list: (token: string | null) => [...workflowsKeys.lists(), token] as const,
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
 * Hook to set the chatkit workflow
 */
export const useSetChatkitWorkflow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, workflowId }: { token: string | null; workflowId: number }) =>
      workflowsApi.setChatkitWorkflow(token, workflowId),
    onSuccess: () => {
      // Invalidate workflows list to refetch
      queryClient.invalidateQueries({ queryKey: workflowsKeys.lists() });
    },
  });
};
