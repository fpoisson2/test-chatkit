import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  cleanupApi,
  type CleanupStats,
  type CleanupResult,
  type FactoryResetResult,
} from "../utils/backend";

// Query keys for cache management
export const cleanupKeys = {
  all: ["cleanup"] as const,
  stats: (token: string | null) => [...cleanupKeys.all, "stats", token] as const,
};

/**
 * Hook to fetch cleanup statistics
 */
export const useCleanupStats = (token: string | null) => {
  return useQuery({
    queryKey: cleanupKeys.stats(token),
    queryFn: () => cleanupApi.getStats(token),
    enabled: !!token,
  });
};

/**
 * Hook to delete all conversations
 */
export const useDeleteConversations = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token }: { token: string | null }) =>
      cleanupApi.deleteConversations(token),
    onSuccess: (_data, variables) => {
      // Invalidate stats to refresh counts
      queryClient.invalidateQueries({ queryKey: cleanupKeys.stats(variables.token) });
    },
  });
};

/**
 * Hook to delete workflow history (keep only active versions)
 */
export const useDeleteWorkflowHistory = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token }: { token: string | null }) =>
      cleanupApi.deleteWorkflowHistory(token),
    onSuccess: (_data, variables) => {
      // Invalidate stats to refresh counts
      queryClient.invalidateQueries({ queryKey: cleanupKeys.stats(variables.token) });
    },
  });
};

/**
 * Hook to delete all workflows
 */
export const useDeleteWorkflows = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token }: { token: string | null }) =>
      cleanupApi.deleteWorkflows(token),
    onSuccess: (_data, variables) => {
      // Invalidate stats to refresh counts
      queryClient.invalidateQueries({ queryKey: cleanupKeys.stats(variables.token) });
      // Invalidate workflows list
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
};

/**
 * Hook to delete all viewports
 */
export const useDeleteViewports = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token }: { token: string | null }) =>
      cleanupApi.deleteViewports(token),
    onSuccess: (_data, variables) => {
      // Invalidate stats to refresh counts
      queryClient.invalidateQueries({ queryKey: cleanupKeys.stats(variables.token) });
    },
  });
};

/**
 * Hook to perform factory reset
 */
export const useFactoryReset = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token }: { token: string | null }) =>
      cleanupApi.factoryReset(token),
    onSuccess: (_data, variables) => {
      // Invalidate all relevant caches
      queryClient.invalidateQueries({ queryKey: cleanupKeys.stats(variables.token) });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
};
