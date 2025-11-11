import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  modelRegistryApi,
  type AvailableModel,
  type AvailableModelPayload,
  type AvailableModelUpdatePayload
} from "../utils/backend";

// Query keys for cache management
export const modelsKeys = {
  all: ["models"] as const,
  lists: () => [...modelsKeys.all, "list"] as const,
  list: (token: string | null) => [...modelsKeys.lists(), token] as const,
  adminList: (token: string | null) => [...modelsKeys.lists(), "admin", token] as const,
};

/**
 * Hook to fetch all models (public API)
 */
export const useModels = (token: string | null) => {
  return useQuery({
    queryKey: modelsKeys.list(token),
    queryFn: () => modelRegistryApi.list(token),
    enabled: !!token,
  });
};

/**
 * Hook to fetch all models (admin API)
 */
export const useModelsAdmin = (token: string | null) => {
  return useQuery({
    queryKey: modelsKeys.adminList(token),
    queryFn: () => modelRegistryApi.listAdmin(token),
    enabled: !!token,
  });
};

/**
 * Hook to create a new model
 */
export const useCreateModel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, payload }: { token: string | null; payload: AvailableModelPayload }) =>
      modelRegistryApi.create(token, payload),
    onSuccess: (newModel, variables) => {
      // Invalidate both lists to refetch
      queryClient.invalidateQueries({ queryKey: modelsKeys.lists() });
    },
  });
};

/**
 * Hook to update a model
 */
export const useUpdateModel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      id,
      payload
    }: {
      token: string | null;
      id: number;
      payload: AvailableModelUpdatePayload
    }) => modelRegistryApi.update(token, id, payload),
    onSuccess: () => {
      // Invalidate both lists to refetch
      queryClient.invalidateQueries({ queryKey: modelsKeys.lists() });
    },
  });
};

/**
 * Hook to delete a model
 */
export const useDeleteModel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, id }: { token: string | null; id: number }) =>
      modelRegistryApi.delete(token, id),
    onSuccess: () => {
      // Invalidate both lists to refetch
      queryClient.invalidateQueries({ queryKey: modelsKeys.lists() });
    },
  });
};
